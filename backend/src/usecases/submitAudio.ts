import { fail, ok } from "../domain/result";
import type { Grade } from "../domain/round";
import type { PlayRecordInput } from "../durable-objects/playRecords";
import type { PlayRecordRepository } from "../repositories/playRecordRepository";
import type { RoomRepository } from "../repositories/roomRepository";
import { findPoolScene } from "../scenes/pool";
import type { SceneLayoutV2 } from "../scenes/types";
import { type ScoreResult, type ScoringEnv, score } from "../scoring";

/** 16 kHz・16 bit・モノラルで 20 秒 ≈ 0.64 MB。採点（scoring/）と同じく 1 MB まで */
export const MAX_AUDIO_BYTES = 1024 * 1024;

const isWav = (audio: ArrayBuffer) => {
  if (audio.byteLength < 44) return false;
  const head = new TextDecoder().decode(new Uint8Array(audio, 0, 12));
  return head.startsWith("RIFF") && head.endsWith("WAVE");
};

/** 採点の結果を、部屋に書き込む 1 人分の採点にする */
export const toGrade = (result: ScoreResult): Grade =>
  result.ok
    ? {
        status: "done",
        score: {
          content: result.content,
          expression: result.expression,
          speech: result.speech,
          total: result.total,
        },
        transcript: result.transcript,
        content: result.breakdown,
        feedback: result.feedback,
      }
    : { status: "failed" };

/** 採点できた 1 人分を、きろくの 1 行にする。表示名は入れない。点数は結果発表と同じく整数にする */
export const toRecord = (
  result: Extract<ScoreResult, { ok: true }>,
  deviceId: string,
  layout: SceneLayoutV2,
): PlayRecordInput => ({
  deviceId,
  sceneId: result.sceneId,
  score: {
    content: Math.round(result.content),
    expression: Math.round(result.expression),
    speech: Math.round(result.speech),
    total: Math.round(result.total),
  },
  transcript: result.transcript,
  content: result.breakdown,
  feedback: result.feedback,
  layout,
});

/**
 * 1 人分の音声を受け取り、採点中にする。採点は応答を返した後に waitUntil で続け、
 * 終わったら部屋に書き込む（全員そろうと部屋が results を配る）。
 * 端末の ID があれば、採点できた結果を本人のきろくにも残す
 */
export const submitAudio = async (
  repository: RoomRepository,
  env: ScoringEnv,
  waitUntil: (promise: Promise<unknown>) => void,
  input: {
    roomId: string;
    round: number;
    playerId: string;
    token: string;
    audio: ArrayBuffer;
    /** 端末で文字起こしした発話。無ければ Azure の文字起こしを使う */
    transcript?: string;
    /** 端末ごとの乱数の ID（場面の評価と同じ）。古いアプリは送らない */
    deviceId?: string;
  },
  /** きろくの置き場所。無ければ残さない */
  records?: PlayRecordRepository,
) => {
  if (input.audio.byteLength > MAX_AUDIO_BYTES || !isWav(input.audio)) {
    return fail("invalid_audio", "1 MB までの WAV を送る");
  }
  const begun = await repository.beginGrading(input.roomId, input);
  if (!begun.ok) return begun;

  const { roomId, round, playerId } = input;
  // DO の RPC を通ると型の上で座標の組（Vec3）が number[] になるので戻す。中身は部屋が置いた配置そのもの
  const roomLayout = begun.value.layout as SceneLayoutV2 | undefined;
  const grade = async () => {
    const result = await score(
      env,
      input.audio,
      begun.value.sceneId,
      input.transcript,
      roomLayout,
    ).catch(() => null);
    await repository.recordGrade(roomId, {
      round,
      playerId,
      grade: result ? toGrade(result) : { status: "failed" },
    });
    if (result?.ok && records && input.deviceId) {
      // 過去の振り返りを出し直すため、遊んだ場面の配置も残す（部屋が AI で作った場面は、部屋が閉じると消える）
      const layout = roomLayout ?? findPoolScene(begun.value.sceneId);
      if (layout) {
        // きろくに残せなくても遊びは止めない
        await records
          .append(toRecord(result, input.deviceId, layout))
          .catch((e) => console.error("きろくに残せませんでした", e));
      }
    }
  };
  waitUntil(grade());
  return ok(null);
};
