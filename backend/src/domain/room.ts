import type { z } from "zod";
import {
  type ErrorCode,
  MAX_PLAYERS,
  type Player as PlayerView,
  type RoomPhase,
} from "../schemas/common";
import type { RoomSummary } from "../schemas/http";
import { createPlayer, type Player, tokenMatches } from "./player";
import { isSceneId, pickRandomSceneId } from "./scenes";

// ---------- 型 ----------

export type Round = { round: number; sceneId: string; startAt: number };

export type RoomState = {
  roomId: string;
  phase: z.infer<typeof RoomPhase>;
  hostId: string;
  players: Player[];
  current: Round | null;
};

export type RoomError = { code: z.infer<typeof ErrorCode>; message: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: RoomError };

// ---------- ドメインルール ----------

/** 成功と失敗（エラーコードと理由）を返すための補助 */
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: RoomError["code"], message: string) =>
  ({ ok: false, error: { code, message } }) as const;

/** 全員に round が届くまでの余裕 */
const START_DELAY_MS = 1500;

/** 待合の状態で部屋を作る。作った人がホストになる */
export const createRoomState = (roomId: string) => {
  const host = createPlayer(true);
  const state: RoomState = {
    roomId,
    phase: "lobby",
    hostId: host.id,
    players: [host],
    current: null,
  };
  return { state, host };
};

/** 部屋に入る前の確認用に、人数と状態だけを返す */
export const summarize = (state: RoomState): z.infer<typeof RoomSummary> => ({
  roomId: state.roomId,
  phase: state.phase,
  playerCount: state.players.length,
  maxPlayers: MAX_PLAYERS,
});

/**
 * 部屋に入る。ID と合言葉があれば復帰（ホストの最初の参加を含む）、無ければ新しく入る。
 * 新しく入れるのは待合のときだけで、5 人まで
 */
export const joinRoom = (
  state: RoomState,
  input: { name: string; playerId?: string; token?: string },
): Result<{ state: RoomState; player: Player; rejoined: boolean }> => {
  const rejoining = input.playerId !== undefined || input.token !== undefined;

  if (rejoining) {
    const found = state.players.find((p) => p.id === input.playerId);
    if (!found || !input.token || !tokenMatches(found, input.token)) {
      return fail("unauthorized", "参加者の ID と合言葉が合わない");
    }
    const player = { ...found, name: input.name };
    return ok({
      state: replacePlayer(state, player),
      player,
      rejoined: true,
    });
  }

  if (state.phase !== "lobby") {
    return fail("not_in_lobby", "ゲームが始まっているので入れない");
  }
  if (state.players.length >= MAX_PLAYERS) {
    return fail("room_full", `満員（${MAX_PLAYERS} 人まで）`);
  }
  const player = { ...createPlayer(false), name: input.name };
  return ok({
    state: { ...state, players: [...state.players, player] },
    player,
    rejoined: false,
  });
};

/** ラウンドを始める。ホストだけが待合のときにできる。シーンを省くとおまかせ */
export const startRound = (
  state: RoomState,
  input: { playerId: string; sceneId?: string; now: number },
): Result<{ state: RoomState; round: Round }> => {
  if (input.playerId !== state.hostId) {
    return fail("not_host", "スタートできるのはホストだけ");
  }
  if (state.phase !== "lobby") {
    return fail("not_in_lobby", "待合でしかスタートできない");
  }
  if (input.sceneId !== undefined && !isSceneId(input.sceneId)) {
    return fail("unknown_scene", `シーン ${input.sceneId} は無い`);
  }

  const round: Round = {
    round: (state.current?.round ?? 0) + 1,
    sceneId: input.sceneId ?? pickRandomSceneId(),
    startAt: input.now + START_DELAY_MS,
  };
  return ok({ state: { ...state, phase: "playing", current: round }, round });
};

/** 進行中のラウンド。途中で戻ってきた人に送り直す */
export const ongoingRound = (state: RoomState) =>
  state.phase === "playing" ? state.current : null;

/** 参加者の一覧として見せる形にする。まだ join していないホストは出さない */
export const visiblePlayers = (
  state: RoomState,
  connectedIds: ReadonlySet<string>,
): z.infer<typeof PlayerView>[] =>
  state.players.flatMap((p) =>
    p.name === null
      ? []
      : [
          {
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            connected: connectedIds.has(p.id),
          },
        ],
  );

/** 同じ ID の参加者を入れ替える */
const replacePlayer = (state: RoomState, player: Player): RoomState => ({
  ...state,
  players: state.players.map((p) => (p.id === player.id ? player : p)),
});
