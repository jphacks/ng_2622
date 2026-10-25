import { gradeWithBands } from "./bands";
import { ClaudeError } from "./claude";
import { checkedNotes } from "./feedback";
import { describeLayout, type LayoutItem } from "./layout";
import type { ContentFeedback, ScoringEnv, SpeechAspects } from "./types";

// 配置の JSON と文字起こしから、内容と表現を採点基準の段階で採点する。画像は使わず、話し方（発音）の点も付けない。
// 場面の情報（部品・座標・動き）と説明文をそのまま Claude に渡すので、場面ごとの基準を作ったり覚えたりしない

// これより短い発話は Claude を呼ばずに内容・表現を 0 点にする
const MIN_WORDS = 3;

export type Layout = {
  // 作り置きのときに書いて人が確かめた場面の説明文（英語）。採点の補足として渡す
  description?: string;
  items: LayoutItem[];
};

type Failure = {
  ok: false;
  reason: "unknown_parts" | "api_error";
  message: string;
};

export type LayoutScoreResult =
  | {
      ok: true;
      content: number;
      expression: number;
      transcript: string;
      feedback: ContentFeedback;
      mode: "live" | "fixed";
      elapsedMs: number;
    }
  | Failure;

/** 1 人分を採点する。例外は投げず、失敗は ok: false で返す */
export async function scoreLayout(
  env: ScoringEnv,
  input: { layout: Layout; transcript: string; speech?: SpeechAspects },
): Promise<LayoutScoreResult> {
  const started = Date.now();
  const transcript = input.transcript.trim();

  if (env.SCORING_MODE === "fixed") {
    return {
      ok: true,
      content: 60,
      expression: 60,
      transcript,
      feedback: {
        strength: { quote: "", text: "固定の点数を返しています。" },
        nextStep: {
          kind: "expression",
          text: "文をつなげて、もう少し詳しく言ってみよう。",
        },
        rewrite: null,
      },
      mode: "fixed",
      elapsedMs: Date.now() - started,
    };
  }

  const sceneData = describeLayout(input.layout.items);
  if (!sceneData) {
    return {
      ok: false,
      reason: "unknown_parts",
      message: "置いた部品が 1 つも見つからない",
    };
  }

  const words = transcript.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) {
    return {
      ok: true,
      content: 0,
      expression: 0,
      transcript,
      feedback: {
        strength: { quote: "", text: "英語で話し始められました。" },
        nextStep: {
          kind: "content",
          text: "もう少し長く、文にして話してみよう。",
        },
        rewrite: null,
      },
      mode: "live",
      elapsedMs: Date.now() - started,
    };
  }

  try {
    const graded = await gradeWithBands(env, {
      sceneData,
      description: input.layout.description?.trim() || undefined,
      transcript,
      speech: input.speech,
    });
    console.log({
      event: "layout_scoring_timing",
      words,
      claudeMs: Date.now() - started,
    });
    return {
      ok: true,
      content: graded.content,
      expression: graded.expression,
      transcript,
      feedback: {
        ...checkedNotes(transcript, graded),
        nextStep: graded.nextStep,
      },
      mode: "live",
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    console.error("配置からの採点に失敗", e);
    return {
      ok: false,
      reason: "api_error",
      message: e instanceof ClaudeError ? e.message : "採点の途中で失敗した",
    };
  }
}
