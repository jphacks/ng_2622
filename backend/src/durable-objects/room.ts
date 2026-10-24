import { DurableObject } from "cloudflare:workers";
import { fail, ok, type Result, type RoomError } from "../domain/result";
import {
  authenticate,
  createRoomState,
  joinRoom,
  leaveRoom,
  ongoingRound,
  playAgain,
  type RoomState,
  startRound,
  summarize,
  visiblePlayers,
} from "../domain/room";
import {
  beginGrading,
  closeRound,
  type Grade,
  progressOf,
  recordGrade,
  roundResults,
} from "../domain/round";
import { MAX_PLAYERS } from "../schemas/common";
import { ClientMessage, type ServerMessage } from "../schemas/ws";

type Attachment = { playerId: string | null };

const STATE_KEY = "state";
const IDLE_TTL_MS = 2 * 60 * 60 * 1000;
const CLOSE_REPLACED = 4000;
const CLOSE_LEFT = 1000;

export class Room extends DurableObject<CloudflareBindings> {
  /** undefined: まだ読んでいない、null: 部屋が無い */
  private state: RoomState | null | undefined;

  /** そのコードの部屋がすでにあれば null */
  async create(roomId: string) {
    if (await this.load()) return null;
    const { state, host } = createRoomState(roomId);
    await this.save(state);
    return { playerId: host.id, token: host.token };
  }

  async summary() {
    const state = await this.load();
    return state ? summarize(state) : null;
  }

  /** 音声を受け取ったときに呼ぶ。本人とラウンドを確かめて採点中にし、採点するシーンを返す */
  async beginGrading(input: {
    playerId: string;
    token: string;
    round: number;
  }): Promise<Result<{ sceneId: string }>> {
    const state = await this.load();
    if (!state) return fail("room_not_found", "部屋が無い");
    const player = authenticate(state, input.playerId, input.token);
    if (!player.ok) return player;

    const result = beginGrading(state, input);
    if (!result.ok) return result;
    await this.update(state, result.value.state);
    return ok({ sceneId: result.value.sceneId });
  }

  /** 採点の結果を書き込む */
  async recordGrade(input: { playerId: string; round: number; grade: Grade }) {
    const state = await this.load();
    if (!state) return;
    const next = recordGrade(state, input);
    if (next) await this.update(state, next);
  }

  async fetch(_request: Request): Promise<Response> {
    if (!(await this.load())) {
      return Response.json(
        { error: { code: "room_not_found", message: "部屋が無い" } },
        { status: 404 },
      );
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    setAttachment(server, { playerId: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const state = await this.load();
    if (!state) {
      ws.close(1011, "room closed");
      return;
    }
    const message = parseMessage(raw);
    if (!message) {
      return this.sendError(ws, {
        code: "invalid_message",
        message: "メッセージの形が違う",
      });
    }

    const playerId = attachmentOf(ws).playerId;
    if (message.type === "join") {
      if (playerId) {
        return this.sendError(ws, {
          code: "invalid_message",
          message: "join はつないだ最初に 1 回だけ送る",
        });
      }
      return this.join(ws, state, message);
    }
    if (!playerId) {
      return this.sendError(ws, {
        code: "invalid_message",
        message: "先に join を送る",
      });
    }

    switch (message.type) {
      case "start":
        return this.start(ws, state, playerId, message.sceneId);
      case "close":
        return this.apply(ws, state, closeRound(state, { playerId }));
      case "again":
        return this.apply(ws, state, playAgain(state, { playerId }));
      case "leave":
        return this.leave(ws, state, playerId);
    }
  }

  async webSocketClose() {
    // 参加者は消さず、同じ合言葉での復帰を待つ
    const state = await this.load();
    if (!state) return;
    this.broadcastRoom(state);
    this.broadcastProgress(state);
  }

  async webSocketError() {
    await this.webSocketClose();
  }

  async alarm() {
    if (this.openSockets().length > 0) {
      await this.keepAlive();
      return;
    }
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  private async join(
    ws: WebSocket,
    state: RoomState,
    input: { name: string; color?: number; playerId?: string; token?: string },
  ) {
    const result = joinRoom(state, input);
    if (!result.ok) return this.sendError(ws, result.error);

    const { player, rejoined } = result.value;
    await this.save(result.value.state);
    if (rejoined) this.closeOtherConnections(ws, player.id);
    setAttachment(ws, { playerId: player.id });

    this.send(ws, {
      type: "welcome",
      playerId: player.id,
      token: player.token,
      isHost: player.isHost,
    });
    const next = result.value.state;
    this.broadcastRoom(next);
    const round = ongoingRound(next);
    if (round) {
      this.send(ws, {
        type: "round",
        round: round.round,
        sceneId: round.sceneId,
        startAt: round.startAt,
      });
    }
    this.broadcastProgress(next);
    const results = next.phase === "results" ? roundResults(next) : null;
    if (results) this.send(ws, { type: "results", ...results });
  }

  private async start(
    ws: WebSocket,
    state: RoomState,
    playerId: string,
    sceneId: string | undefined,
  ) {
    const result = startRound(state, { playerId, sceneId, now: Date.now() });
    if (!result.ok) return this.sendError(ws, result.error);

    const { state: next, round } = result.value;
    await this.save(next);
    this.broadcastRoom(next);
    this.broadcast({
      type: "round",
      round: round.round,
      sceneId: round.sceneId,
      startAt: round.startAt,
    });
    this.broadcastProgress(next);
  }

  private async leave(ws: WebSocket, state: RoomState, playerId: string) {
    setAttachment(ws, { playerId: null });
    ws.close(CLOSE_LEFT, "left the room");
    await this.update(state, leaveRoom(state, playerId));
  }

  /** ドメインのルールの結果を保存して配る。受け付けられなければ送った本人にだけ返す */
  private async apply(
    ws: WebSocket,
    state: RoomState,
    result: Result<RoomState>,
  ) {
    if (!result.ok) return this.sendError(ws, result.error);
    await this.update(state, result.value);
  }

  /** 状態を保存し、変わったところを全員へ送る */
  private async update(prev: RoomState, next: RoomState) {
    await this.save(next);
    this.broadcastRoom(next);
    this.broadcastProgress(next);
    if (prev.phase !== "results" && next.phase === "results") {
      const results = roundResults(next);
      if (results) this.broadcast({ type: "results", ...results });
    }
  }

  private send(ws: WebSocket, message: ServerMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // 閉じかけの接続。切断として後で扱われる
    }
  }

  private sendError(ws: WebSocket, error: RoomError) {
    this.send(ws, { type: "error", ...error });
  }

  private broadcast(message: ServerMessage) {
    for (const ws of this.openSockets()) {
      if (attachmentOf(ws).playerId) this.send(ws, message);
    }
  }

  private broadcastRoom(state: RoomState) {
    this.broadcast({
      type: "room",
      roomId: state.roomId,
      phase: state.phase,
      hostId: state.hostId,
      maxPlayers: MAX_PLAYERS,
      players: visiblePlayers(state, this.connectedPlayerIds()),
    });
  }

  private broadcastProgress(state: RoomState) {
    const round = ongoingRound(state);
    if (!round) return;
    this.broadcast({
      type: "progress",
      round: round.round,
      players: progressOf(state, this.connectedPlayerIds()),
    });
  }

  private closeOtherConnections(ws: WebSocket, playerId: string) {
    for (const other of this.openSockets()) {
      if (other !== ws && attachmentOf(other).playerId === playerId) {
        other.close(CLOSE_REPLACED, "replaced by a new connection");
      }
    }
  }

  private connectedPlayerIds() {
    const ids = new Set<string>();
    for (const ws of this.openSockets()) {
      const { playerId } = attachmentOf(ws);
      if (playerId) ids.add(playerId);
    }
    return ids;
  }

  private openSockets() {
    return this.ctx
      .getWebSockets()
      .filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private async load(): Promise<RoomState | null> {
    if (this.state === undefined) {
      this.state = (await this.ctx.storage.get<RoomState>(STATE_KEY)) ?? null;
    }
    return this.state;
  }

  private async save(state: RoomState) {
    this.state = state;
    await this.ctx.storage.put(STATE_KEY, state);
    await this.keepAlive();
  }

  private async keepAlive() {
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS);
  }
}

const parseMessage = (raw: string | ArrayBuffer) => {
  if (typeof raw !== "string") return null;
  try {
    const parsed = ClientMessage.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const attachmentOf = (ws: WebSocket): Attachment =>
  (ws.deserializeAttachment() as Attachment | null) ?? { playerId: null };

const setAttachment = (ws: WebSocket, attachment: Attachment) =>
  ws.serializeAttachment(attachment);
