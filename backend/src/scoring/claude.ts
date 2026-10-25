import Anthropic from "@anthropic-ai/sdk";
import type {
  ElementJudgment,
  LanguageNotes,
  LanguageScore,
  Scene,
  ScoringEnv,
} from "./types";

export const DEFAULT_MODEL = "claude-haiku-5-5";
const DEFAULT_EFFORT = "high";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

// 知らない値は既定に戻す（設定の打ち間違いで採点を止めないため）
export const effortOf = (raw: string | undefined): Effort =>
  raw && EFFORTS.includes(raw) ? (raw as Effort) : DEFAULT_EFFORT;

const SYSTEM = `You grade short spoken English descriptions by Japanese learners in a party game.
All players watched the same scene and described it freely in up to 20 seconds. The input is an automatic transcript, so ignore punctuation and small recognition errors.

1. For each listed element, judge whether the transcript describes it:
   - "full": it matches the accepted wording or a clear paraphrase of it.
   - "partial": it matches the partial wording. Use this only when partial wording is given.
   - "none": not described.
   Judge meaning, not exact words. Grammar mistakes do not matter here. Quote the words you based the judgment on as evidence ("" for none).
2. extra: points from 0 to the given maximum for correct details of the scene that are not in the list.
3. expression: score from 0 to 100 for vocabulary range and sentence construction (variety, accuracy, natural phrasing). A few separate words is around 20; correct, varied sentences are around 90.

Then write feedback in Japanese for the player. Be specific and encouraging, and do not mention points.
4. strength: the best thing the player said. quote: copy the words exactly from the transcript. text: one short sentence saying what the quote conveys well.
5. hints: for every element judged "partial" or "none", one short sentence suggesting what to add, with a short English example (e.g. 次は女性がスーツケースを引いているところを足してみよう。"A woman is pulling a suitcase.").
6. expressionTip: one short sentence on how to make the sentences richer, with a short English example.
7. rewrite: pick one sentence or fragment of the player and make it natural, keeping the meaning and level. before: copy it exactly from the transcript. after: the corrected English. reason: one short sentence in Japanese.
   Words that look like recognition errors (odd or meaningless words, very short fragments) are not the player's mistakes; do not correct them. If nothing needs fixing, return null.`;

// 配置から作った基準（Scene.fromLayout）のときに足す決まり。説明が場面のすべてなので、それに照らして判定する
const FROM_LAYOUT = `

The scene description lists everything in the scene, generated from the 3D scene data. Treat it as the ground truth:
- Give extra points only for details that agree with the description. Things that are not in the scene, or that contradict it, get nothing.
- The description gives colors only for some things. When the player mentions a color the description does not give, neither reward nor penalize it.
- For an element about an action, a color, a count or a position, "full" needs that detail itself; only naming the person or thing is "partial" at most (or "none" if no partial wording is given). A wrong detail is not "full".
- Positions are given without left/right or front/back, because players see the scene from any side. Accept left/right or front/back wording when the stated relation (next to, near, and so on) is right.`;

const schemaFor = (scene: Scene) => ({
  type: "object",
  properties: {
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: scene.elements.map((e) => e.id) },
          level: { type: "string", enum: ["full", "partial", "none"] },
          evidence: { type: "string" },
        },
        required: ["id", "level", "evidence"],
        additionalProperties: false,
      },
    },
    extra: { type: "integer" },
    expression: { type: "integer" },
    strength: {
      type: "object",
      properties: { quote: { type: "string" }, text: { type: "string" } },
      required: ["quote", "text"],
      additionalProperties: false,
    },
    hints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: scene.elements.map((e) => e.id) },
          text: { type: "string" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
    expressionTip: { type: "string" },
    rewrite: {
      anyOf: [
        {
          type: "object",
          properties: {
            before: { type: "string" },
            after: { type: "string" },
            reason: { type: "string" },
          },
          required: ["before", "after", "reason"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
  },
  required: [
    "elements",
    "extra",
    "expression",
    "strength",
    "hints",
    "expressionTip",
    "rewrite",
  ],
  additionalProperties: false,
});

type Judged = LanguageNotes & {
  elements: ElementJudgment[];
  extra: number;
  expression: number;
};

export class ClaudeError extends Error {}

const clamp = (n: number, max = 100) => Math.max(0, Math.min(max, n));

const describeElements = (scene: Scene) =>
  scene.elements
    .map(
      (e) =>
        `- ${e.id}: accept: ${e.accept}${e.partial ? ` / partial: ${e.partial}` : ""}`,
    )
    .join("\n");

// 合計は Claude に計算させず、要素ごとの判定から足す
const contentScore = (scene: Scene, judged: Judged) => {
  const level = new Map(judged.elements.map((j) => [j.id, j.level]));
  const fromElements = scene.elements.reduce((sum, e) => {
    const l = level.get(e.id);
    if (l === "full") return sum + e.points;
    if (l === "partial" && e.partial) return sum + e.points / 2;
    return sum;
  }, 0);
  return clamp(fromElements + clamp(judged.extra, scene.extraMax));
};

export async function gradeLanguage(
  env: ScoringEnv,
  scene: Scene,
  transcript: string,
): Promise<LanguageScore> {
  if (!env.CLAUDE_API_KEY) {
    throw new ClaudeError("CLAUDE_API_KEY が要る");
  }
  const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });
  const response = await client.messages.create({
    model: env.CLAUDE_MODEL || DEFAULT_MODEL,
    max_tokens: 4000,
    output_config: {
      effort: effortOf(env.CLAUDE_EFFORT),
      format: { type: "json_schema", schema: schemaFor(scene) },
    },
    system: scene.fromLayout ? SYSTEM + FROM_LAYOUT : SYSTEM,
    messages: [
      {
        role: "user",
        content: `Scene: ${scene.description}\nElements:\n${describeElements(scene)}\nMaximum extra: ${scene.extraMax}\n\nTranscript: ${transcript}`,
      },
    ],
  });
  if (response.stop_reason !== "end_turn") {
    throw new ClaudeError(`Claude が途中で止まった: ${response.stop_reason}`);
  }
  const text = response.content.find((b) => b.type === "text");
  if (text?.type !== "text") {
    throw new ClaudeError("Claude の応答に本文が無い");
  }
  const judged = JSON.parse(text.text) as Judged;
  return {
    content: contentScore(scene, judged),
    expression: clamp(judged.expression),
    elements: judged.elements,
    notes: {
      strength: judged.strength,
      hints: judged.hints,
      expressionTip: judged.expressionTip,
      rewrite: judged.rewrite,
    },
  };
}
