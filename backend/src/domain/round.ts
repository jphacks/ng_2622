import type { z } from "zod";
import type { PlayerStatus } from "../schemas/common";
import type { PlayerResult, ResultsMessage } from "../schemas/ws";
import { AVATAR_COLORS } from "./player";
import { fail, ok, type Result } from "./result";
import type { RoomState } from "./room";
import { sceneName } from "./scenes";

// ---------- 型 ----------

export type Score = {
  content: number;
  expression: number;
  speech: number;
  total: number;
};

/** 1 人分の採点。音声が届いたら grading、採点が返ったら done か failed */
export type Grade =
  | { status: "grading" }
  | {
      status: "done";
      score: Score;
      transcript: string;
      comment: string;
      modelAnswer: string;
    }
  | { status: "failed" };

export type Round = {
  round: number;
  sceneId: string;
  /** 回転を始める時刻（UNIX 時刻のミリ秒） */
  startAt: number;
  /** スタートしたときに部屋にいた人。後から抜けた人は数えない */
  playerIds: string[];
  /** 音声が届いた人の採点。キーは参加者の ID */
  grades: Record<string, Grade>;
};

type Status = z.infer<typeof PlayerStatus>;

// ---------- ドメインルール ----------

/** 音声を受け取り、その人を採点中にする。ラウンド中に 1 人 1 回だけ */
export const beginGrading = (
  state: RoomState,
  input: { playerId: string; round: number },
): Result<{ state: RoomState; sceneId: string }> => {
  const current = state.current;
  if (
    !current ||
    (state.phase !== "playing" && state.phase !== "waiting") ||
    current.round !== input.round
  ) {
    return fail("not_playing", `ラウンド ${input.round} は進行中でない`);
  }
  if (!current.playerIds.includes(input.playerId)) {
    return fail("not_playing", "このラウンドに参加していない");
  }
  if (current.grades[input.playerId]) {
    return fail("already_submitted", "このラウンドの音声はもう受け取った");
  }

  const next = withGrade(state, current, input.playerId, {
    status: "grading",
  });
  return ok({ state: settleRound(next), sceneId: current.sceneId });
};

/**
 * 採点の結果を書き込む。締め切られた後や、ラウンドが変わった後に届いたものは捨てる（null）。
 * 全員の採点がそろったら結果発表に進む
 */
export const recordGrade = (
  state: RoomState,
  input: { playerId: string; round: number; grade: Grade },
): RoomState | null => {
  const current = state.current;
  if (
    !current ||
    (state.phase !== "playing" && state.phase !== "waiting") ||
    current.round !== input.round ||
    current.grades[input.playerId]?.status !== "grading"
  ) {
    return null;
  }
  return settleRound(withGrade(state, current, input.playerId, input.grade));
};

/** ホストが締め切って結果発表に進む。採点がまだの人は「採点できませんでした」になる */
export const closeRound = (
  state: RoomState,
  input: { playerId: string },
): Result<RoomState> => {
  if (input.playerId !== state.hostId) {
    return fail("not_host", "締め切れるのはホストだけ");
  }
  if (state.phase !== "playing" && state.phase !== "waiting") {
    return fail("not_playing", "ラウンド中でない");
  }
  return ok({ ...state, phase: "results" });
};

/**
 * ラウンドの進み具合を決め直す。残っている参加者の全員が
 * 音声を送ったら採点待ち（waiting）、採点がそろったら結果発表（results）
 */
export const settleRound = (state: RoomState): RoomState => {
  if (
    !state.current ||
    (state.phase !== "playing" && state.phase !== "waiting")
  ) {
    return state;
  }
  const grades = roundPlayers(state).map((p) => state.current?.grades[p.id]);
  if (grades.every((g) => g && g.status !== "grading")) {
    return { ...state, phase: "results" };
  }
  if (grades.every((g) => g)) return { ...state, phase: "waiting" };
  return state;
};

/** 各自の状態。採点が終わった（失敗も含む）> 切断中 > 採点中 > 話している の順に見る */
export const progressOf = (
  state: RoomState,
  connectedIds: ReadonlySet<string>,
): { id: string; status: Status }[] =>
  roundPlayers(state).map((p) => {
    const grade = state.current?.grades[p.id];
    const status: Status =
      grade && grade.status !== "grading"
        ? "done"
        : !connectedIds.has(p.id)
          ? "offline"
          : grade
            ? "grading"
            : "talking";
    return { id: p.id, status };
  });

/** 結果発表の中身。合計点の高い順に並べ、同点は同じ順位、採点できなかった人は最後 */
export const roundResults = (
  state: RoomState,
): Omit<z.infer<typeof ResultsMessage>, "type"> | null => {
  const current = state.current;
  if (!current) return null;

  const rows = roundPlayers(state).map((p) => {
    const grade = current.grades[p.id];
    const done = grade?.status === "done" ? grade : null;
    return {
      id: p.id,
      name: p.name ?? "",
      color: p.color ?? AVATAR_COLORS[0],
      score: done ? roundScore(done.score) : null,
      transcript: done?.transcript ?? "",
      comment: done?.comment ?? "",
      modelAnswer: done?.modelAnswer ?? "",
    };
  });
  const graded = rows
    .filter((r) => r.score)
    .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));
  const ungraded = rows.filter((r) => !r.score);

  const players: z.infer<typeof PlayerResult>[] = [
    ...graded.map((r) => ({
      ...r,
      rank:
        1 +
        graded.filter((o) => (o.score?.total ?? 0) > (r.score?.total ?? 0))
          .length,
    })),
    ...ungraded.map((r) => ({ ...r, rank: null })),
  ];
  return {
    round: current.round,
    sceneId: current.sceneId,
    sceneName: sceneName(current.sceneId),
    players,
  };
};

/** このラウンドの参加者のうち、まだ部屋にいる人 */
const roundPlayers = (state: RoomState) =>
  state.players.filter((p) => state.current?.playerIds.includes(p.id));

const withGrade = (
  state: RoomState,
  current: Round,
  playerId: string,
  grade: Grade,
): RoomState => ({
  ...state,
  current: { ...current, grades: { ...current.grades, [playerId]: grade } },
});

/** 点数は整数で見せる */
const roundScore = (score: Score): Score => ({
  content: Math.round(score.content),
  expression: Math.round(score.expression),
  speech: Math.round(score.speech),
  total: Math.round(score.total),
});
