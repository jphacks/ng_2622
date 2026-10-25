import Anthropic from "@anthropic-ai/sdk";
import { ClaudeError, DEFAULT_MODEL, effortOf } from "./claude";
import type {
  ContentFeedback,
  Rewrite,
  ScoringEnv,
  SpeechAspects,
} from "./types";

// 内容と表現を、採点基準の段階（0・20・40・60・80・100）で付ける。1 人につき Claude を 1 回呼ぶ
// （ADR 20261025-score-content-with-layout-and-rubric-bands）。
// 段階の説明の文は下書き。野沢さんが確かめたものに差し替える。IELTS・英検の公式の文は丸写ししない

// 量より質を重く見る。段階はまず質（場面の中心を、正しく具体的に言えたか）で決め、同じ質なら量（正しい細かいことの数）で上げる
const CONTENT_BANDS = `Content: how well the player conveyed the scene. Judge quality first, then quantity.
- Quality: whether they caught the core of the scene and said it accurately and specifically. The core is the people and animals, what they are doing (pose and motion), and how the main things relate; the scene description usually states it. A precise statement ("An apple is falling from the tree.") is worth more than a vague one ("There is an apple.").
- Quantity: correct supporting details (other things, where they are, counts). Among descriptions of similar quality, more correct details score higher. Listing many minor things does not make up for missing or getting the core wrong.
- 100: Conveys the core accurately and specifically (the main actions and how the main things relate), plus several correct supporting details. Everything said agrees with the scene.
- 80: Conveys the core accurately and specifically, with few supporting details. Or conveys it well with one small mistake.
- 60: Gets part of the core (the main action or a main relation), but vaguely or incompletely. Or gives many correct details but misses the core.
- 40: Names things in the scene without saying what they are doing or how they relate. Or gets the core wrong.
- 20: Only one or two correct words about the scene, or mostly things that are not in the scene.
- 0: Nothing about the scene: silence, unrelated talk, or only wrong statements.`;

const EXPRESSION_BANDS = `Expression: vocabulary and grammar (in the spirit of IELTS Lexical Resource and Grammatical Range and Accuracy).
- 100: Wide and precise vocabulary for the scene with natural word combinations. Mixes simple and complex sentences (clauses with while, because, which and so on). Almost no errors.
- 80: Enough vocabulary to describe clearly, with some less common words. Mostly complete sentences, some complex. Errors are rare and do not block the meaning.
- 60: Everyday vocabulary used adequately, with some repetition. Mostly simple sentences that are usually correct; longer sentences have errors.
- 40: Limited, repetitive vocabulary. Short simple sentences or phrases with frequent errors, but the meaning is mostly clear.
- 20: Isolated words or memorized fragments, hardly any sentence structure.
- 0: No English that can be assessed.`;

const SYSTEM = `You grade short spoken English descriptions by Japanese learners in a party game.
All players watched the same 3D scene and described it freely in up to 20 seconds. The input is an automatic transcript, so ignore punctuation and small recognition errors.

You get the scene data: every thing in the scene with its name, English words, size, position, facing and motion. It is the ground truth; nothing else is in the scene. A short scene description may follow as a supplement; when it disagrees with the scene data, trust the scene data.
Read positions from the coordinates. Players can rotate the scene, so accept left/right and front/back from any viewpoint as long as the relation could be true from some side. Do not reward or penalize colors that the scene data does not give.

Give content and expression each a score from 0 to 100 using the bands below. Pick the band that fits best; scores between bands are fine. Mistakes lower the content band; do not subtract points separately.

${CONTENT_BANDS}

${EXPRESSION_BANDS}

Then write feedback in Japanese for the player. Be specific and encouraging, and do not mention points.
1. strength: the best thing the player said. quote: copy the words exactly from the transcript. text: one short sentence saying what the quote conveys well.
2. nextStep: the one thing that would improve the player's description the most. kind: "content" (an important thing, action or relation in the scene they did not describe, or a wrong statement to fix), "expression" (vocabulary or sentence construction), or "speech" (pronunciation, fluency or intonation; only when speech scores are given; choose it when the lowest speech score is clearly below your content and expression scores). text: one short sentence with a short English example (e.g. 次は男の人がベンチに向かって歩いているところを足してみよう。"A man is walking toward the bench.").
3. rewrite: pick one sentence or fragment of the player and make it natural, keeping the meaning and level. before: copy it exactly from the transcript. after: the corrected English. reason: one short sentence in Japanese.
   Words that look like recognition errors (odd or meaningless words, very short fragments) are not the player's mistakes; do not correct them. If nothing needs fixing, return null.`;

const schemaFor = (withSpeech: boolean) => ({
  type: "object",
  properties: {
    content: { type: "integer" },
    expression: { type: "integer" },
    strength: {
      type: "object",
      properties: { quote: { type: "string" }, text: { type: "string" } },
      required: ["quote", "text"],
      additionalProperties: false,
    },
    nextStep: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: withSpeech
            ? ["content", "expression", "speech"]
            : ["content", "expression"],
        },
        text: { type: "string" },
      },
      required: ["kind", "text"],
      additionalProperties: false,
    },
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
  required: ["content", "expression", "strength", "nextStep", "rewrite"],
  additionalProperties: false,
});

export type BandScore = {
  content: number;
  expression: number;
  strength: ContentFeedback["strength"];
  nextStep: ContentFeedback["nextStep"];
  rewrite: Rewrite | null;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export async function gradeWithBands(
  env: ScoringEnv,
  input: {
    // layout.ts の describeLayout で作った場面の情報
    sceneData: string;
    // 作り置きのときに書いて人が確かめた場面の説明文（補足）
    description?: string;
    transcript: string;
    speech?: SpeechAspects;
  },
): Promise<BandScore> {
  if (!env.CLAUDE_API_KEY) {
    throw new ClaudeError("CLAUDE_API_KEY が要る");
  }
  const parts = [`Scene data:\n${input.sceneData}`];
  if (input.description) {
    parts.push(`Scene description (supplement): ${input.description}`);
  }
  if (input.speech) {
    const { accuracy, fluency, prosody } = input.speech;
    parts.push(
      `Speech scores (0-100, from pronunciation assessment): pronunciation ${accuracy}, fluency ${fluency}, intonation ${prosody}`,
    );
  }
  parts.push(`Transcript: ${input.transcript}`);

  const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });
  const response = await client.messages.create({
    model: env.CLAUDE_MODEL || DEFAULT_MODEL,
    max_tokens: 4000,
    output_config: {
      effort: effortOf(env.CLAUDE_EFFORT),
      format: { type: "json_schema", schema: schemaFor(!!input.speech) },
    },
    system: SYSTEM,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  });
  if (response.stop_reason !== "end_turn") {
    throw new ClaudeError(`Claude が途中で止まった: ${response.stop_reason}`);
  }
  const text = response.content.find((b) => b.type === "text");
  if (text?.type !== "text") {
    throw new ClaudeError("Claude の応答に本文が無い");
  }
  const graded = JSON.parse(text.text) as BandScore;
  return {
    ...graded,
    content: clamp(graded.content),
    expression: clamp(graded.expression),
  };
}
