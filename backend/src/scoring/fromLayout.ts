import type { ChecklistItem, GradeId } from "../scenes/types";
import {
  type CheckedNextStep,
  type ContentBreakdown,
  emptyContent,
  type SentContent,
  toSentContent,
} from "./checklist";
import { gradeWithChecklist } from "./checklistGrade";
import { ClaudeError } from "./claude";
import { checkedRewrite } from "./feedback";
import {
  grammarFor,
  MIN_WORDS,
  parseWeights,
  SHORT_TEXT,
  sentBasis,
  withGain,
} from "./index";
import {
  describeLayoutWithRelations,
  type PartMeta,
  type RelationItem,
} from "./layout";
import type { NextStep, Rewrite, ScoringEnv, SpeechAspects } from "./types";

// 配置の JSON（scenenglish.scene/2 のうち採点に使う項目）と文字起こしから、部屋を通さずに内容と表現を採点する（POST /score）。
// 採り方は部屋の採点（index.ts の score）と同じチェックリストの採点。音声は受けず、話し方（発音）の点は付けない

export type Layout = {
  difficulty: GradeId;
  // 級の見本の答え（英語）。採点の補足として渡す
  description?: string;
  checklist: ChecklistItem[];
  items: RelationItem[];
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
      breakdown: SentContent;
      feedback: {
        nextStep: NextStep;
        rewrite: Rewrite | null;
        expressionBasis: string | null;
      };
      mode: "live" | "fixed";
      elapsedMs: number;
    }
  | Failure;

/**
 * 1 人分を採点する。例外は投げず、失敗は ok: false で返す。
 * extraParts は同梱に無い部品（配置の id@版 の部品。苦手の場面で作った部品）のメタデータ
 */
export async function scoreLayout(
  env: ScoringEnv,
  input: { layout: Layout; transcript: string; speech?: SpeechAspects },
  extraParts: readonly PartMeta[] = [],
): Promise<LayoutScoreResult> {
  const started = Date.now();
  const transcript = input.transcript.trim();
  const { layout } = input;
  const weights = parseWeights(env.SCORE_WEIGHTS);

  const result = (
    graded: {
      content: number;
      expression: number;
      breakdown: ContentBreakdown;
      nextStep: CheckedNextStep;
      rewrite: Rewrite | null;
      // 表現の点の根拠。Claude を呼ばなかったときは空（送るときに null にする）
      expressionBasis: string;
    },
    mode: "live" | "fixed",
  ): LayoutScoreResult => ({
    ok: true,
    content: graded.content,
    expression: graded.expression,
    transcript,
    breakdown: toSentContent(graded.breakdown),
    feedback: {
      // 話し方の点は付けないので、gain は話し方を変えないとしたときの合計の伸び（話し方の項は差で消える）
      nextStep: withGain(graded.nextStep, weights, {
        content: graded.content,
        expression: graded.expression,
        speech: 0,
      }),
      rewrite: checkedRewrite(transcript, graded.rewrite),
      expressionBasis: sentBasis(graded.expressionBasis),
    },
    mode,
    elapsedMs: Date.now() - started,
  });

  if (env.SCORING_MODE === "fixed") {
    return result(
      {
        content: 60,
        expression: 60,
        breakdown: emptyContent(layout.checklist),
        nextStep: {
          kind: "expression",
          text: "文をつなげて、もう少し詳しく言ってみよう。",
          item: null,
          contentIfSaid: null,
        },
        rewrite: null,
        expressionBasis: "",
      },
      "fixed",
    );
  }

  const sceneData = describeLayoutWithRelations(layout.items, extraParts);
  if (!sceneData) {
    return {
      ok: false,
      reason: "unknown_parts",
      message: "置いた部品が 1 つも見つからない",
    };
  }

  const words = transcript.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) {
    return result(
      {
        content: 0,
        expression: 0,
        breakdown: emptyContent(layout.checklist),
        nextStep: {
          kind: "content",
          text: SHORT_TEXT,
          item: null,
          contentIfSaid: null,
        },
        rewrite: null,
        expressionBasis: "",
      },
      "live",
    );
  }

  try {
    const graded = await gradeWithChecklist(env, {
      grade: layout.difficulty,
      checklist: layout.checklist,
      sceneData,
      description: layout.description?.trim() || undefined,
      ...grammarFor(layout.difficulty),
      transcript,
      speech: input.speech,
    });
    console.log({
      event: "layout_scoring_timing",
      words,
      claudeMs: Date.now() - started,
      claudeRetries: graded.expressionRetries,
    });
    return result(graded, "live");
  } catch (e) {
    console.error("配置からの採点に失敗", e);
    return {
      ok: false,
      reason: "api_error",
      message: e instanceof ClaudeError ? e.message : "採点の途中で失敗した",
    };
  }
}
