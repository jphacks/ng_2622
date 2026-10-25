import { findPoolScene, type PoolScene } from "../scenes/pool";
import { assessSpeech } from "./azure";
import { gradeWithBands } from "./bands";
import { gradeLanguage } from "./claude";
import { buildFeedback, checkedNotes, speechTip } from "./feedback";
import { describeLayout } from "./layout";
import { findScene } from "./scenes";
import type {
  Feedback,
  LanguageNotes,
  ScoreResult,
  ScoringEnv,
  SpeechScore,
} from "./types";

export type { Feedback, ScoreResult, ScoringEnv } from "./types";

// Claude を呼ばないときの講評の材料
const SHORT_NOTES: LanguageNotes = {
  strength: { quote: "", text: "英語で話し始められました。" },
  hints: [],
  expressionTip: "もう少し長く、文にして話してみよう。",
  rewrite: null,
};

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

// 1 人分の音声を採点する。例外は投げず、失敗は ok: false で返す。
// deviceTranscript は端末で文字起こしした発話。あれば Azure の正解文と Claude の採点に使い、無ければ Azure の文字起こしを使う。
// layout は部屋が AI で作った場面の配置（部屋の保存領域から渡す）。作り置きの場面と同じ採り方をする
export async function score(
  env: ScoringEnv,
  wav: ArrayBuffer,
  sceneId: string,
  deviceTranscript?: string,
  layout?: PoolScene,
): Promise<ScoreResult> {
  const started = Date.now();
  const poolScene =
    findPoolScene(sceneId) ?? (layout?.id === sceneId ? layout : undefined);
  if (poolScene)
    return scorePoolScene(env, wav, poolScene, started, deviceTranscript);
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
      feedback: buildFeedback({
        scene,
        transcript: "",
        elements: [],
        expression: 60,
        speech: {
          accuracy: 60,
          fluency: 60,
          prosody: 60,
          score: 60,
          words: [],
        },
        notes: {
          ...SHORT_NOTES,
          strength: { quote: "", text: "固定の点数を返しています。" },
        },
        weights: [wc, we, ws],
      }),
      elements: [],
      speechDetail: { accuracy: 60, fluency: 60, prosody: 60 },
      mode: "fixed",
      elapsedMs: Date.now() - started,
    };
  }

  try {
    const azureStarted = Date.now();
    const fromDevice = deviceTranscript?.trim() ?? "";
    const speech = await assessSpeech(env, wav, fromDevice);
    const azureMs = Date.now() - azureStarted;
    const transcript = fromDevice || speech?.transcript.trim() || "";
    if (!speech || transcript === "") {
      return {
        ok: false,
        sceneId,
        reason: "no_speech",
        message: "英語の発話を聞き取れなかった",
      };
    }
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const claudeStarted = Date.now();
    const language =
      words < MIN_WORDS
        ? { content: 0, expression: 0, elements: [], notes: SHORT_NOTES }
        : await gradeLanguage(env, scene, transcript);
    // 採点の所要時間の内訳（Cloudflare の Observability で見る）。claudeMs は Claude を呼ばなかったとき null
    console.log({
      event: "scoring_timing",
      sceneId,
      audioBytes: wav.byteLength,
      words,
      // 文字起こしがどちらから来たか（端末の精度を Azure と見比べるため、Azure の分も残す）
      transcriptSource: fromDevice ? "device" : "azure",
      azureTranscript: speech.transcript,
      azureMs,
      claudeMs: words < MIN_WORDS ? null : Date.now() - claudeStarted,
      totalMs: Date.now() - started,
    });
    return {
      ok: true,
      sceneId,
      total: total(language.content, language.expression, speech.score),
      content: language.content,
      expression: language.expression,
      speech: round(speech.score),
      transcript,
      feedback: buildFeedback({
        scene,
        transcript,
        elements: language.elements,
        expression: language.expression,
        speech,
        notes: language.notes,
        weights: [wc, we, ws],
      }),
      elements: language.elements,
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

// ---------- 作り置きの場面（gen-…）----------
// 話し方は Azure のまま。内容・表現と講評は、配置の情報・説明文・文字起こし・Azure の 3 つの点を渡して
// 採点基準の段階で 1 回の Claude 呼び出しで付ける（ADR 20261025-score-content-with-layout-and-rubric-bands）。
// 要素ごとの判定は無いので elements は空、nextStep.gain は null にする

const FIXED_SPEECH = { accuracy: 60, fluency: 60, prosody: 60 };

const poolFeedback = (
  speech: Pick<SpeechScore, "accuracy" | "fluency" | "prosody" | "words">,
  graded: Pick<Feedback, "strength" | "rewrite"> & {
    nextStep: { kind: Feedback["nextStep"]["kind"]; text: string };
  },
  transcript: string,
): Feedback => ({
  ...checkedNotes(transcript, graded),
  nextStep: { ...graded.nextStep, gain: null },
  speechTip: speechTip(speech),
});

async function scorePoolScene(
  env: ScoringEnv,
  wav: ArrayBuffer,
  scene: PoolScene,
  started: number,
  deviceTranscript?: string,
): Promise<ScoreResult> {
  const sceneId = scene.id;
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
      feedback: poolFeedback(
        { ...FIXED_SPEECH, words: [] },
        {
          strength: { quote: "", text: "固定の点数を返しています。" },
          nextStep: {
            kind: "expression",
            text: "文をつなげて、もう少し詳しく言ってみよう。",
          },
          rewrite: null,
        },
        "",
      ),
      elements: [],
      speechDetail: FIXED_SPEECH,
      mode: "fixed",
      elapsedMs: Date.now() - started,
    };
  }

  try {
    const azureStarted = Date.now();
    // 手作りの場面と同じく、端末の文字起こしがあれば Azure の正解文と Claude の採点に使う
    const fromDevice = deviceTranscript?.trim() ?? "";
    const speech = await assessSpeech(env, wav, fromDevice);
    const azureMs = Date.now() - azureStarted;
    const transcript = fromDevice || speech?.transcript.trim() || "";
    if (!speech || transcript === "") {
      return {
        ok: false,
        sceneId,
        reason: "no_speech",
        message: "英語の発話を聞き取れなかった",
      };
    }
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const sceneData = describeLayout(scene.items);
    if (!sceneData) {
      return {
        ok: false,
        sceneId,
        reason: "api_error",
        message: "場面の部品が 1 つも見つからない",
      };
    }
    const aspects = {
      accuracy: speech.accuracy,
      fluency: speech.fluency,
      prosody: speech.prosody,
    };
    const claudeStarted = Date.now();
    const graded =
      words < MIN_WORDS
        ? {
            content: 0,
            expression: 0,
            strength: SHORT_NOTES.strength,
            nextStep: {
              kind: "content" as const,
              text: SHORT_NOTES.expressionTip,
            },
            rewrite: null,
          }
        : await gradeWithBands(env, {
            sceneData,
            description: scene.description.trim() || undefined,
            transcript,
            speech: aspects,
          });
    console.log({
      event: "scoring_timing",
      sceneId,
      audioBytes: wav.byteLength,
      words,
      transcriptSource: fromDevice ? "device" : "azure",
      azureTranscript: speech.transcript,
      azureMs,
      claudeMs: words < MIN_WORDS ? null : Date.now() - claudeStarted,
      totalMs: Date.now() - started,
    });
    return {
      ok: true,
      sceneId,
      total: total(graded.content, graded.expression, speech.score),
      content: graded.content,
      expression: graded.expression,
      speech: round(speech.score),
      transcript,
      feedback: poolFeedback(speech, graded, transcript),
      elements: [],
      speechDetail: aspects,
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
