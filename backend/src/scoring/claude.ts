import Anthropic from "@anthropic-ai/sdk";
import type {
  ElementJudgment,
  LanguageScore,
  Scene,
  ScoringEnv,
} from "./types";

const DEFAULT_MODEL = "claude-haiku-5-5";

const SYSTEM = `You grade short spoken English descriptions by Japanese learners in a party game.
All players watched the same scene and described it freely in up to 20 seconds. The input is an automatic transcript, so ignore punctuation and small recognition errors.

1. For each listed element, judge whether the transcript describes it:
   - "full": it matches the accepted wording or a clear paraphrase of it.
   - "partial": it matches the partial wording. Use this only when partial wording is given.
   - "none": not described.
   Judge meaning, not exact words. Grammar mistakes do not matter here. Quote the words you based the judgment on as evidence ("" for none).
2. extra: points from 0 to the given maximum for correct details of the scene that are not in the list.
3. expression: score from 0 to 100 for vocabulary range and sentence construction (variety, accuracy, natural phrasing). A few separate words is around 20; correct, varied sentences are around 90.
4. comment: one short sentence of feedback in Japanese, saying what was good first. If an element was missed, hint at it.
5. modelAnswer: one or two natural English sentences describing the scene at a level slightly above the player.`;

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
    comment: { type: "string" },
    modelAnswer: { type: "string" },
  },
  required: ["elements", "extra", "expression", "comment", "modelAnswer"],
  additionalProperties: false,
});

type Judged = {
  elements: ElementJudgment[];
  extra: number;
  expression: number;
  comment: string;
  modelAnswer: string;
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
      effort: "high",
      format: { type: "json_schema", schema: schemaFor(scene) },
    },
    system: SYSTEM,
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
    comment: judged.comment,
    modelAnswer: judged.modelAnswer,
    elements: judged.elements,
  };
}
