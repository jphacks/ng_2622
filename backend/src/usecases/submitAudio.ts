import { fail, ok } from "../domain/result";
import type { Grade } from "../domain/round";
import type { RoomRepository } from "../repositories/roomRepository";
import { type ScoreResult, type ScoringEnv, score } from "../scoring";

/** 16 kHz・16 bit・モノラルで 20 秒 ≈ 0.64 MB。採点（scoring/）と同じく 1 MB まで */
export const MAX_AUDIO_BYTES = 1024 * 1024;

const isWav = (audio: ArrayBuffer) => {
  if (audio.byteLength < 44) return false;
  const head = new TextDecoder().decode(new Uint8Array(audio, 0, 12));
  return head.startsWith("RIFF") && head.endsWith("WAVE");
};

const toGrade = (result: ScoreResult): Grade =>
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
        feedback: result.feedback,
      }
    : { status: "failed" };

/**
 * 1 人分の音声を受け取り、採点中にする。採点は応答を返した後に waitUntil で続け、
 * 終わったら部屋に書き込む（全員そろうと部屋が results を配る）
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
  },
) => {
  if (input.audio.byteLength > MAX_AUDIO_BYTES || !isWav(input.audio)) {
    return fail("invalid_audio", "1 MB までの WAV を送る");
  }
  const begun = await repository.beginGrading(input.roomId, input);
  if (!begun.ok) return begun;

  const { roomId, round, playerId } = input;
  const grade = async () => {
    const result = await score(env, input.audio, begun.value.sceneId).catch(
      () => null,
    );
    await repository.recordGrade(roomId, {
      round,
      playerId,
      grade: result ? toGrade(result) : { status: "failed" },
    });
  };
  waitUntil(grade());
  return ok(null);
};
