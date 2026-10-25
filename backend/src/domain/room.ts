import type { z } from "zod";
import type { Difficulty } from "../scenes/pool";
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
import { isSceneId, pickPoolSceneId, pickRandomSceneId } from "./scenes";

// ---------- 型 ----------

export type RoomState = {
  roomId: string;
  phase: z.infer<typeof RoomPhase>;
  hostId: string;
  players: Player[];
  /** 進行中か、最後に遊んだラウンド */
  current: Round | null;
  /** この部屋で難易度から選んで出した作り置きの場面。重ねて出さないために覚える（前の版で保存した部屋には無い） */
  playedSceneIds?: string[];
  /** AI で作っている最中（phase が generating のときだけ）。id で、終わったときに同じ生成かを確かめる */
  generating?: Generation | null;
  /** この部屋で AI の生成を試した回数（失敗も数える）。MAX_GENERATIONS で打ち止め（前の版で保存した部屋には無い） */
  generationCount?: number;
};

export type Generation = { id: string; difficulty: Difficulty };

/** AI で作った場面。名前は結果発表に出す */
export type GeneratedScene = { sceneId: string; name: string };

// ---------- ドメインルール ----------

/** 全員に round が届くまでの余裕 */
const START_DELAY_MS = 1500;

/** 1 部屋で AI に場面を作らせる回数の上限（料金を抑えるため）。超えたら作り置きの場面から選ぶ */
export const MAX_GENERATIONS = 20;

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
 * 難易度を送ると、その難易度の作り置きの場面のうち、この部屋でまだ出ていないものから選ぶ（シーンとの両方は送れない）。
 * このとき部屋に入っていて（join 済み）、つながっている人がラウンドの参加者になる。
 * 切断中の人を入れると、その人の音声を待ち続けてラウンドが終わらないため
 */
export const startRound = (
  state: RoomState,
  input: {
    playerId: string;
    sceneId?: string;
    difficulty?: Difficulty;
    now: number;
    connectedIds: ReadonlySet<string>;
  },
): Result<{ state: RoomState; round: Round }> => {
  const checked = checkStart(state, input);
  if (!checked.ok) return checked;

  if (input.difficulty !== undefined) {
    return ok(
      startPoolRound(state, { ...input, difficulty: input.difficulty }),
    );
  }
  return ok(
    withRound(state, {
      sceneId: input.sceneId ?? pickRandomSceneId(),
      now: input.now,
      connectedIds: input.connectedIds,
    }),
  );
};

/** この部屋でまだ AI に作らせてよいか。スイッチが on で、試した回数が上限に届いていないこと */
export const canGenerate = (state: RoomState, enabled: boolean) =>
  enabled && (state.generationCount ?? 0) < MAX_GENERATIONS;

/**
 * 難易度から AI で場面を作り始める（phase を generating にする）。確かめることは startRound と同じ。
 * 試した回数をここで 1 つ増やす（失敗しても数える）。できたら finishGeneration でラウンドを始める
 */
export const beginGeneration = (
  state: RoomState,
  input: { playerId: string; difficulty: Difficulty; generationId: string },
): Result<RoomState> => {
  const checked = checkStart(state, input);
  if (!checked.ok) return checked;
  return ok({
    ...state,
    phase: "generating",
    generating: { id: input.generationId, difficulty: input.difficulty },
    generationCount: (state.generationCount ?? 0) + 1,
  });
};

/**
 * 生成が終わったら（失敗・止めたときは scene を null で）ラウンドを始める。失敗したら同じ難易度の作り置きの場面にする。
 * 作っている間に別の生成に替わった・もう generating でない（ホストが抜けて先に始めた）なら null で、何もしない。
 * つながっている参加者が 1 人もいなければ、ラウンドは始めずに待合に戻す（round は null）
 */
export const finishGeneration = (
  state: RoomState,
  input: {
    generationId: string;
    scene: GeneratedScene | null;
    now: number;
    connectedIds: ReadonlySet<string>;
  },
): { state: RoomState; round: Round | null } | null => {
  const generation = state.generating;
  if (state.phase !== "generating" || generation?.id !== input.generationId) {
    return null;
  }
  const rest: RoomState = { ...state, generating: null };
  const anyone = state.players.some(
    (p) => p.name !== null && input.connectedIds.has(p.id),
  );
  if (!anyone) return { state: { ...rest, phase: "lobby" }, round: null };
  if (!input.scene) {
    return startPoolRound(rest, {
      ...input,
      difficulty: generation.difficulty,
    });
  }
  return withRound(rest, {
    sceneId: input.scene.sceneId,
    sceneName: input.scene.name,
    now: input.now,
    connectedIds: input.connectedIds,
  });
};

/** スタートを受け付けるか。ホストだけ、待合のときだけ、シーンと難易度はどちらか一方 */
const checkStart = (
  state: RoomState,
  input: { playerId: string; sceneId?: string; difficulty?: Difficulty },
): Result<null> => {
  if (input.playerId !== state.hostId) {
    return fail("not_host", "スタートできるのはホストだけ");
  }
  if (state.phase !== "lobby") {
    return fail("not_in_lobby", "待合でしかスタートできない");
  }
  if (input.sceneId !== undefined && input.difficulty !== undefined) {
    return fail(
      "invalid_message",
      "sceneId と difficulty はどちらか一方だけ送る",
    );
  }
  if (input.sceneId !== undefined && !isSceneId(input.sceneId)) {
    return fail("unknown_scene", `シーン ${input.sceneId} は無い`);
  }
  return ok(null);
};

/** 難易度から作り置きの場面を選んでラウンドを始める。出した場面を履歴に足す */
const startPoolRound = (
  state: RoomState,
  input: {
    difficulty: Difficulty;
    now: number;
    connectedIds: ReadonlySet<string>;
  },
) => {
  const picked = pickPoolSceneId(input.difficulty, state.playedSceneIds ?? []);
  return withRound(
    { ...state, playedSceneIds: picked.played },
    {
      sceneId: picked.sceneId,
      now: input.now,
      connectedIds: input.connectedIds,
    },
  );
};

/** このシーンでラウンドを始める（phase を playing にする） */
const withRound = (
  state: RoomState,
  input: {
    sceneId: string;
    sceneName?: string;
    now: number;
    connectedIds: ReadonlySet<string>;
  },
): { state: RoomState; round: Round } => {
  const round: Round = {
    round: (state.current?.round ?? 0) + 1,
    sceneId: input.sceneId,
    ...(input.sceneName !== undefined ? { sceneName: input.sceneName } : {}),
    startAt: input.now + START_DELAY_MS,
    playerIds: state.players
      .filter((p) => p.name !== null && input.connectedIds.has(p.id))
      .map((p) => p.id),
    grades: {},
  };
  return { state: { ...state, phase: "playing", current: round }, round };
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
 * ラウンド中なら、残りの人がそろったかを決め直す。
 * AI で作っている最中にホストが抜けたときは、ここでは generating のまま返す（生成を止めて作り置きで始めるのは呼ぶ側）
 */
export const leaveRoom = (state: RoomState, playerId: string): RoomState => {
  const rest = state.players.filter((p) => p.id !== playerId);
  if (playerId !== state.hostId) {
    return settleRound({ ...state, players: rest });
  }

  const nextHost = rest.find((p) => p.name !== null) ?? rest[0];
  return settleRound(
    withHost({ ...state, players: rest }, nextHost?.id ?? state.hostId),
  );
};

/**
 * ホストが切断したまま戻らないときに替えるか。ホストが切断中で、
 * ほかにつながっている参加者（join 済み）がいるとき替える
 */
export const hostIsAway = (
  state: RoomState,
  connectedIds: ReadonlySet<string>,
) =>
  !connectedIds.has(state.hostId) &&
  state.players.some((p) => p.name !== null && connectedIds.has(p.id));

/**
 * 切断したまま戻らないホストを替える。つながっている人のうち、先に入った人がホストになる。
 * 前のホストは参加者として残り、同じ合言葉で戻れる
 */
export const replaceAwayHost = (
  state: RoomState,
  connectedIds: ReadonlySet<string>,
): RoomState => {
  if (!hostIsAway(state, connectedIds)) return state;
  const nextHost = state.players.find(
    (p) => p.name !== null && connectedIds.has(p.id),
  );
  return nextHost ? withHost(state, nextHost.id) : state;
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

/** ホストを替える */
const withHost = (state: RoomState, hostId: string): RoomState => ({
  ...state,
  hostId,
  players: state.players.map((p) => ({ ...p, isHost: p.id === hostId })),
});

/** 同じ ID の参加者を入れ替える */
const replacePlayer = (state: RoomState, player: Player): RoomState => ({
  ...state,
  players: state.players.map((p) => (p.id === player.id ? player : p)),
});
