import { GRADE_LIST, grammarUpTo } from "../scenes/grades";
import { findPoolScene, type PoolScene } from "../scenes/pool";
import type { GradeId } from "../scenes/types";
import { assessSpeech } from "./azure";
import {
  type CheckedNextStep,
  type ContentBreakdown,
  emptyContent,
  toSentContent,
} from "./checklist";
import { gradeWithChecklist } from "./checklistGrade";
import { checkedRewrite, speechTip } from "./feedback";
import { describeLayoutWithRelations } from "./layout";
import type {
  NextStep,
  Rewrite,
  ScoreResult,
  ScoringEnv,
  SpeechScore,
} from "./types";

export type { Feedback, ScoreResult, ScoringEnv } from "./types";

// 1 人分の採点。話し方は Azure の発音評価、内容・表現と講評は Claude（チェックリストの採点の 1 通り）。
// 決めた経緯は docs/adr/20261111-score-only-with-checklist-and-drop-handmade-scenes.md

// 16 kHz・16 bit・モノラルで 20 秒 ≈ 0.64 MB。余裕を見て 1 MB まで
const MAX_AUDIO_BYTES = 1024 * 1024;
// これより短い発話は Claude を呼ばずに内容・表現を 0 点にする
export const MIN_WORDS = 3;
// 短すぎる発話に出す、次の一つの文
export const SHORT_TEXT = "もう少し長く、文にして話してみよう。";
/**
 * 送る表現の点の根拠。空（Claude を呼ばなかった・呼び直しても空だった・空白だけ）なら null にする。
 * 本物の根拠に見える文を作らない（苦手の分析の入力に混ざらないように）
 */
export const sentBasis = (basis: string): string | null =>
  basis.trim() === "" ? null : basis.trim();

// 合計と話し方の点は小数第 1 位まで返す
const round = (n: number) => Math.round(n * 10) / 10;

export const parseWeights = (
  raw: string | undefined,
): [number, number, number] => {
  const w = (raw ?? "50,25,25").split(",").map(Number);
  if (
    w.length !== 3 ||
    w.some((n) => !Number.isFinite(n) || n < 0) ||
    w[0] + w[1] + w[2] === 0
  ) {
    return [50, 25, 25];
  }
  return [w[0], w[1], w[2]];
};

/** 重み付きの合計（丸めない）。合計の点も、次の一つの gain も、この 1 つの式で出す */
export const weightedTotal = (
  [wc, we, ws]: [number, number, number],
  content: number,
  expression: number,
  speech: number,
) => (content * wc + expression * we + speech * ws) / (wc + we + ws);

/**
 * 画面に出す合計。score() は合計を小数第 1 位に丸めて返し、結果発表（domain/round.ts の roundScore）が整数に丸めて見せる。
 * その 2 回の丸めをここで同じようにかける
 */
export const shownTotal = (total: number) => Math.round(round(total));

/**
 * 次の一つの gain（合計の点の伸び）。「その項目を full で言えたときの合計 − 今の合計」を、合計と同じ式と重みで出す。
 * 画面の足し算と合うよう、どちらも画面に出す合計（shownTotal）に丸めてから引く。
 * 内容以外の次の一つと、項目が無いときは null
 */
export const withGain = (
  step: CheckedNextStep,
  weights: [number, number, number],
  score: { content: number; expression: number; speech: number },
): NextStep => ({
  kind: step.kind,
  text: step.text,
  item: step.item,
  gain:
    step.contentIfSaid === null
      ? null
      : shownTotal(
          weightedTotal(
            weights,
            step.contentIfSaid,
            score.expression,
            score.speech,
          ),
        ) -
        shownTotal(
          weightedTotal(weights, score.content, score.expression, score.speech),
        ),
});

/** その級の文法の一覧（下の級の分も含む）と、一つ上の級で足される分 */
export const grammarFor = (grade: GradeId) => {
  const above = GRADE_LIST[GRADE_LIST.findIndex((g) => g.id === grade) + 1];
  return {
    grammar: grammarUpTo(grade),
    grammarAbove: above ? [...above.grammar] : undefined,
  };
};

const isWav = (buf: ArrayBuffer) => {
  if (buf.byteLength < 44) return false;
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, 12));
  return head.startsWith("RIFF") && head.endsWith("WAVE");
};

const FIXED_SPEECH = { accuracy: 60, fluency: 60, prosody: 60 };

type Graded = {
  content: number;
  expression: number;
  breakdown: ContentBreakdown;
  nextStep: CheckedNextStep;
  rewrite: Rewrite | null;
  // 表現の点の根拠（英語 1 文）。Claude を呼ばなかったときは空（送るときに null にする）
  expressionBasis: string;
};

/**
 * 1 人分の音声を採点する。例外は投げず、失敗は ok: false で返す。
 * deviceTranscript は端末で文字起こしした発話。あれば Azure の正解文と Claude の採点に使い、無ければ Azure の文字起こしを使う。
 * layout は部屋が AI で作った場面の配置（部屋の保存領域から渡す）。作り置きの場面と同じ採り方をする
 */
export async function score(
  env: ScoringEnv,
  wav: ArrayBuffer,
  sceneId: string,
  deviceTranscript?: string,
  layout?: PoolScene,
): Promise<ScoreResult> {
  const started = Date.now();
  const scene =
    findPoolScene(sceneId) ?? (layout?.id === sceneId ? layout : undefined);
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
  const weights = parseWeights(env.SCORE_WEIGHTS);

  const result = (
    graded: Graded,
    speech: Pick<SpeechScore, "accuracy" | "fluency" | "prosody" | "words"> & {
      score: number;
    },
    transcript: string,
    mode: "live" | "fixed",
  ): ScoreResult => ({
    ok: true,
    sceneId,
    total: round(
      weightedTotal(weights, graded.content, graded.expression, speech.score),
    ),
    content: graded.content,
    expression: graded.expression,
    speech: round(speech.score),
    transcript,
    breakdown: toSentContent(graded.breakdown),
    feedback: {
      nextStep: withGain(graded.nextStep, weights, {
        content: graded.content,
        expression: graded.expression,
        speech: speech.score,
      }),
      // 引用と言い換え元は、文字起こしに含まれるものだけを出す
      rewrite: checkedRewrite(transcript, graded.rewrite),
      speechTip: speechTip(speech),
      expressionBasis: sentBasis(graded.expressionBasis),
    },
    speechDetail: {
      accuracy: speech.accuracy,
      fluency: speech.fluency,
      prosody: speech.prosody,
    },
    mode,
    elapsedMs: Date.now() - started,
  });

  if (env.SCORING_MODE === "fixed") {
    return result(
      {
        content: 60,
        expression: 60,
        breakdown: emptyContent(scene.checklist),
        nextStep: {
          kind: "expression",
          text: "文をつなげて、もう少し詳しく言ってみよう。",
          item: null,
          contentIfSaid: null,
        },
        rewrite: null,
        // 固定の点数のモードは Claude を呼ばないので、根拠は無い（null で送る）
        expressionBasis: "",
      },
      { ...FIXED_SPEECH, score: 60, words: [] },
      "(固定の点数のモードのため、文字起こしはありません)",
      "fixed",
    );
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
    const sceneData = describeLayoutWithRelations(scene.items);
    if (!sceneData) {
      return {
        ok: false,
        sceneId,
        reason: "api_error",
        message: "場面の部品が 1 つも見つからない",
      };
    }
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const claudeStarted = Date.now();
    let graded: Graded;
    let retries: number | null = null;
    if (words < MIN_WORDS) {
      graded = {
        content: 0,
        expression: 0,
        breakdown: emptyContent(scene.checklist),
        nextStep: {
          kind: "content",
          text: SHORT_TEXT,
          item: null,
          contentIfSaid: null,
        },
        rewrite: null,
        // Claude を呼んでいないので根拠は無い（null で送る）
        expressionBasis: "",
      };
    } else {
      const scored = await gradeWithChecklist(env, {
        grade: scene.difficulty,
        checklist: scene.checklist,
        sceneData,
        description: scene.description.trim() || undefined,
        ...grammarFor(scene.difficulty),
        transcript,
        speech: {
          accuracy: speech.accuracy,
          fluency: speech.fluency,
          prosody: speech.prosody,
        },
      });
      graded = scored;
      retries = scored.expressionRetries;
    }
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
      // 表現 0 点か空の根拠で Claude を呼び直した回数
      claudeRetries: retries,
      totalMs: Date.now() - started,
    });
    return result(graded, speech, transcript, "live");
  } catch (e) {
    if (e instanceof Error) {
      console.error("採点に失敗", e);
      return { ok: false, sceneId, reason: "api_error", message: e.message };
    }
    throw e;
  }
}
