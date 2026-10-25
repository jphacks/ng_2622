import { ClaudeError, gradeLanguage } from "./claude";
import { buildContentFeedback } from "./feedback";
import { describeLayout, type LayoutItem } from "./layout";
import { type Difficulty, draftRubric } from "./rubric";
import type {
  ContentFeedback,
  ElementJudgment,
  LanguageScore,
  Scene,
  ScoringEnv,
} from "./types";

// 配置の JSON と文字起こしから、内容と表現を採点する。画像は使わず、話し方（発音）も扱わない。
// 1 段目: 配置と部品のメタデータから採点の基準（説明・要素・配点）を作る。同じ場面の基準は 1 つだけ覚えて、全員に使う
// 2 段目: その基準で、文字起こしを判定する

// これより短い発話は Claude を呼ばずに内容・表現を 0 点にする
const MIN_WORDS = 3;

export type Layout = {
  difficulty?: Difficulty;
  items: LayoutItem[];
};

export type RubricStore = {
  get: (key: string) => Promise<Scene | null>;
  keep: (
    key: string,
    rubric: Scene,
  ) => Promise<{ rubric: Scene; created: boolean }>;
};

type Failure = {
  ok: false;
  reason: "unknown_parts" | "api_error";
  message: string;
};

export type RubricResult =
  | {
      ok: true;
      sceneKey: string;
      rubric: Scene;
      // この呼び出しで基準を作ったか（false なら覚えていたものを使った）
      created: boolean;
    }
  | Failure;

export type LayoutScoreResult =
  | {
      ok: true;
      // 採点の基準を覚えたキー。同じキーの人は同じ基準で採点される
      sceneKey: string;
      content: number;
      expression: number;
      scene: { name: string; description: string };
      // 要素ごとの判定と配点。内容の点の内訳
      elements: (ElementJudgment & { label: string; points: number })[];
      transcript: string;
      feedback: ContentFeedback;
      mode: "live" | "fixed";
      elapsedMs: number;
    }
  | Failure;

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// sceneKey が無ければ、配置の中身から決める（同じ配置なら同じキー）
const keyOf = async (layout: Layout, sceneKey?: string) => {
  if (sceneKey) return `key:${sceneKey}`;
  const body = JSON.stringify({
    difficulty: layout.difficulty ?? "easy",
    items: layout.items,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  return `layout:${hex(digest)}`;
};

const fail = (reason: Failure["reason"], message: string): Failure => ({
  ok: false,
  reason,
  message,
});

const failFrom = (e: unknown): Failure => {
  console.error("配置からの採点に失敗", e);
  return fail(
    "api_error",
    e instanceof ClaudeError ? e.message : "採点の途中で失敗した",
  );
};

/** 採点の基準を用意する。覚えていればそれを、無ければ作って覚える。例外は投げない */
export async function prepareRubric(
  env: ScoringEnv,
  store: RubricStore,
  input: { layout: Layout; sceneKey?: string },
): Promise<RubricResult> {
  const sceneKey = await keyOf(input.layout, input.sceneKey);
  try {
    const kept = await store.get(sceneKey);
    if (kept) return { ok: true, sceneKey, rubric: kept, created: false };
    const facts = describeLayout(input.layout.items);
    if (!facts) {
      return fail("unknown_parts", "置いた部品が 1 つも見つからない");
    }
    const started = Date.now();
    const drafted = await draftRubric(
      env,
      sceneKey,
      facts,
      input.layout.difficulty ?? "easy",
    );
    console.log({
      event: "rubric_timing",
      sceneKey,
      claudeMs: Date.now() - started,
    });
    // 同時に作った人がいれば、先に保存された方を使う
    const { rubric, created } = await store.keep(sceneKey, drafted);
    return { ok: true, sceneKey, rubric, created };
  } catch (e) {
    return failFrom(e);
  }
}

/** 1 人分を採点する。例外は投げず、失敗は ok: false で返す */
export async function scoreLayout(
  env: ScoringEnv,
  store: RubricStore,
  input: { layout: Layout; transcript: string; sceneKey?: string },
): Promise<LayoutScoreResult> {
  const started = Date.now();
  const transcript = input.transcript.trim();

  if (env.SCORING_MODE === "fixed") {
    return {
      ok: true,
      sceneKey: await keyOf(input.layout, input.sceneKey),
      content: 60,
      expression: 60,
      scene: { name: "", description: "" },
      elements: [],
      transcript,
      feedback: {
        strength: { quote: "", text: "固定の点数を返しています。" },
        nextStep: {
          kind: "expression",
          gain: null,
          text: "文をつなげて、もう少し詳しく言ってみよう。",
        },
        rewrite: null,
      },
      mode: "fixed",
      elapsedMs: Date.now() - started,
    };
  }

  const prepared = await prepareRubric(env, store, input);
  if (!prepared.ok) return prepared;
  const { rubric, sceneKey } = prepared;

  try {
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const claudeStarted = Date.now();
    const language: LanguageScore =
      words < MIN_WORDS
        ? {
            content: 0,
            expression: 0,
            elements: [],
            notes: {
              strength: { quote: "", text: "英語で話し始められました。" },
              hints: [],
              expressionTip: "もう少し長く、文にして話してみよう。",
              rewrite: null,
            },
          }
        : await gradeLanguage(env, rubric, transcript);
    console.log({
      event: "layout_scoring_timing",
      sceneKey,
      rubricCreated: prepared.created,
      words,
      claudeMs: words < MIN_WORDS ? null : Date.now() - claudeStarted,
      totalMs: Date.now() - started,
    });
    const judged = new Map(language.elements.map((j) => [j.id, j]));
    return {
      ok: true,
      sceneKey,
      content: Math.round(language.content * 10) / 10,
      expression: language.expression,
      scene: { name: rubric.name, description: rubric.description },
      elements: rubric.elements.map((e) => ({
        id: e.id,
        label: e.label,
        points: e.points,
        level: judged.get(e.id)?.level ?? "none",
        evidence: judged.get(e.id)?.evidence ?? "",
      })),
      transcript,
      feedback: buildContentFeedback({
        scene: rubric,
        transcript,
        elements: language.elements,
        notes: language.notes,
      }),
      mode: "live",
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    return failFrom(e);
  }
}
