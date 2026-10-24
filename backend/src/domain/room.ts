import type { z } from "zod";
import {
  MAX_PLAYERS,
  type Player as PlayerView,
  type RoomPhase,
} from "../schemas/common";
import type { RoomSummary } from "../schemas/http";
import {
  AVATAR_COLORS,
  createPlayer,
  type Player,
  pickColor,
  tokenMatches,
} from "./player";
import { fail, ok, type Result } from "./result";
import { type Round, settleRound } from "./round";
import { isSceneId, pickRandomSceneId } from "./scenes";

// ---------- 型 ----------

export type RoomState = {
  roomId: string;
  phase: z.infer<typeof RoomPhase>;
  hostId: string;
  players: Player[];
  /** 進行中か、最後に遊んだラウンド */
  current: Round | null;
};

// ---------- ドメインルール ----------

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

/** 参加者の ID と合言葉が合うかを確かめる */
export const authenticate = (
  state: RoomState,
  playerId: string,
  token: string,
): Result<Player> => {
  const found = state.players.find((p) => p.id === playerId);
  if (!found || !tokenMatches(found, token)) {
    return fail("unauthorized", "参加者の ID と合言葉が合わない");
  }
  return ok(found);
};

/**
 * 部屋に入る。ID と合言葉があれば復帰（ホストの最初の参加を含む）、無ければ新しく入る。
 * 新しく入れるのは待合のときだけで、5 人まで。色を省くと空いている色にする
 */
export const joinRoom = (
  state: RoomState,
  input: { name: string; color?: number; playerId?: string; token?: string },
): Result<{ state: RoomState; player: Player; rejoined: boolean }> => {
  const rejoining = input.playerId !== undefined || input.token !== undefined;

  if (rejoining) {
    const found = authenticate(state, input.playerId ?? "", input.token ?? "");
    if (!found.ok) return found;
    const others = state.players.filter((p) => p.id !== found.value.id);
    const player = {
      ...found.value,
      name: input.name,
      color: input.color ?? found.value.color ?? pickColor(others),
    };
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
  const player = {
    ...createPlayer(false),
    name: input.name,
    color: input.color ?? pickColor(state.players),
  };
  return ok({
    state: { ...state, players: [...state.players, player] },
    player,
    rejoined: false,
  });
};

/**
 * ラウンドを始める。ホストだけが待合のときにできる。シーンを省くとおまかせ。
 * このとき部屋に入っている人（join 済み）がラウンドの参加者になる
 */
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
    playerIds: state.players.filter((p) => p.name !== null).map((p) => p.id),
    grades: {},
  };
  return ok({ state: { ...state, phase: "playing", current: round }, round });
};

/** ホストが結果発表から同じ顔ぶれで待合に戻す */
export const playAgain = (
  state: RoomState,
  input: { playerId: string },
): Result<RoomState> => {
  if (input.playerId !== state.hostId) {
    return fail("not_host", "もう一度を選べるのはホストだけ");
  }
  if (state.phase !== "results") {
    return fail("not_in_results", "結果発表のときにしか待合に戻れない");
  }
  return ok({ ...state, phase: "lobby" });
};

/**
 * 部屋から抜ける。席を空け、ホストが抜けたら次に入った人がホストになる。
 * ラウンド中なら、残りの人がそろったかを決め直す
 */
export const leaveRoom = (state: RoomState, playerId: string): RoomState => {
  const rest = state.players.filter((p) => p.id !== playerId);
  if (playerId !== state.hostId) {
    return settleRound({ ...state, players: rest });
  }

  const nextHost = rest.find((p) => p.name !== null) ?? rest[0];
  return settleRound({
    ...state,
    hostId: nextHost?.id ?? state.hostId,
    players: rest.map((p) => ({ ...p, isHost: p.id === nextHost?.id })),
  });
};

/** 進行中のラウンド（録音と採点待ち）。途中で戻ってきた人に送り直す */
export const ongoingRound = (state: RoomState) =>
  state.phase === "playing" || state.phase === "waiting" ? state.current : null;

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
            color: p.color ?? AVATAR_COLORS[0],
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
