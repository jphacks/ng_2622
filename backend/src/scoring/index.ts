import { assessSpeech } from "./azure";
import { gradeLanguage } from "./claude";
import { findScene } from "./scenes";
import type { ScoreResult, ScoringEnv } from "./types";

export type { ScoreResult, ScoringEnv } from "./types";

// 16 kHz・16 bit・モノラルで 20 秒 ≈ 0.64 MB。余裕を見て 1 MB まで
const MAX_AUDIO_BYTES = 1024 * 1024;
// これより短い発話は Claude を呼ばずに内容・表現を 0 点にする
const MIN_WORDS = 3;

const parseWeights = (raw: string | undefined): [number, number, number] => {
  const w = (raw ?? "50,25,25").split(",").map(Number);
  if (w.length !== 3 || w.some((n) => !Number.isFinite(n) || n < 0)) {
    return [50, 25, 25];
  }
  return [w[0], w[1], w[2]];
};

const isWav = (buf: ArrayBuffer) => {
  if (buf.byteLength < 44) return false;
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, 12));
  return head.startsWith("RIFF") && head.endsWith("WAVE");
};

const round = (n: number) => Math.round(n * 10) / 10;

// 1 人分の音声を採点する。例外は投げず、失敗は ok: false で返す
export async function score(
  env: ScoringEnv,
  wav: ArrayBuffer,
  sceneId: string,
): Promise<ScoreResult> {
  const started = Date.now();
  const scene = findScene(sceneId);
  if (!scene) {
    return {
      ok: false,
      sceneId,
      reason: "unknown_scene",
      message: `シーン ${sceneId} が無い`,
    };
  }
  if (wav.byteLength > MAX_AUDIO_BYTES || !isWav(wav)) {
    return {
      ok: false,
      sceneId,
      reason: "invalid_audio",
      message: "1 MB までの WAV を送る",
    };
  }

  const [wc, we, ws] = parseWeights(env.SCORE_WEIGHTS);
  const total = (content: number, expression: number, speech: number) =>
    round((content * wc + expression * we + speech * ws) / (wc + we + ws));

  if (env.SCORING_MODE === "fixed") {
    return {
      ok: true,
      sceneId,
      total: total(60, 60, 60),
      content: 60,
      expression: 60,
      speech: 60,
      transcript: "(固定の点数のモードのため、文字起こしはありません)",
      comment: "固定の点数を返しています。",
      modelAnswer: scene.description,
      speechDetail: { accuracy: 60, fluency: 60, prosody: 60 },
      mode: "fixed",
      elapsedMs: Date.now() - started,
    };
  }

  try {
    const speech = await assessSpeech(env, wav);
    if (!speech || speech.transcript.trim() === "") {
      return {
        ok: false,
        sceneId,
        reason: "no_speech",
        message: "英語の発話を聞き取れなかった",
      };
    }
    const words = speech.transcript.split(/\s+/).filter(Boolean).length;
    const language =
      words < MIN_WORDS
        ? {
            content: 0,
            expression: 0,
            comment: "もう少し長く話してみよう。",
            modelAnswer: scene.description,
          }
        : await gradeLanguage(env, scene, speech.transcript);
    return {
      ok: true,
      sceneId,
      total: total(language.content, language.expression, speech.score),
      content: language.content,
      expression: language.expression,
      speech: round(speech.score),
      transcript: speech.transcript,
      comment: language.comment,
      modelAnswer: language.modelAnswer,
      speechDetail: {
        accuracy: speech.accuracy,
        fluency: speech.fluency,
        prosody: speech.prosody,
      },
      mode: "live",
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    if (e instanceof Error) {
      console.error("採点に失敗", e);
      return { ok: false, sceneId, reason: "api_error", message: e.message };
    }
    throw e;
  }
}
