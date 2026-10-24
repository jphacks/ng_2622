import Anthropic from "@anthropic-ai/sdk";
import type { LanguageScore, Scene, ScoringEnv } from "./types";

const DEFAULT_MODEL = "claude-haiku-5-5";

const SYSTEM = `You grade short spoken English descriptions by Japanese learners in a party game.
All players watched the same scene and described it freely in up to 20 seconds. The input is an automatic transcript, so ignore punctuation and small recognition errors.

Score two items from 0 to 100:
- content: how well the description matches the scene and how many of the listed elements it covers. Things not in the scene lower the score.
- expression: vocabulary range and sentence construction (variety, accuracy, natural phrasing).

Use the whole range. A few correct words is around 20; covering most elements in correct, varied sentences is around 90.
Also write:
- comment: one short sentence of feedback in Japanese, saying what was good first.
- modelAnswer: one or two natural English sentences describing the scene at a level slightly above the player.`;

const SCHEMA = {
  type: "object",
  properties: {
    content: { type: "integer" },
    expression: { type: "integer" },
    comment: { type: "string" },
    modelAnswer: { type: "string" },
  },
  required: ["content", "expression", "comment", "modelAnswer"],
  additionalProperties: false,
};

export class ClaudeError extends Error {}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

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
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `Scene: ${scene.description}\nElements: ${scene.elements.join(", ")}\n\nTranscript: ${transcript}`,
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
  const parsed = JSON.parse(text.text) as LanguageScore;
  return {
    ...parsed,
    content: clamp(parsed.content),
    expression: clamp(parsed.expression),
  };
}
