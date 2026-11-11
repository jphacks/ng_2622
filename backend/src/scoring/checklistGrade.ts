import Anthropic from "@anthropic-ai/sdk";
import {
  type CheckedNextStep,
  type ChecklistItem,
  type Claim,
  type ContentBreakdown,
  checkNextStep,
  type Grade,
  type RawNextStep,
  scoreContent,
} from "./checklist";
import { ClaudeError, DEFAULT_MODEL, effortOf } from "./claude";
import type {
  ContentFeedback,
  Rewrite,
  ScoringEnv,
  SpeechAspects,
} from "./types";

// 内容をチェックリストの F1、表現を級の文法の一覧に照らした段階で付ける。1 人につき Claude を 1 回呼ぶ
// （ADR 20261110-score-content-with-checklist-f1・20261110-align-scoring-with-eiken-speaking-viewpoints）。
// Claude が返すのは描写の一覧と表現の点と講評だけで、内容の点は checklist.ts が計算する。
// 30 場面を作り直して採点を切り替えるまで、score() からは呼ばれない

// 表現の段階の文は下書き。PR で人が確かめたものに差し替える。IELTS・英検の公式の文は丸写ししない
const EXPRESSION_BANDS = `Expression: grammar and vocabulary, measured against the grammar list of the player's grade (given in the input). Judge how well the player uses the forms of their grade, not how long or how difficult the answer is. A short answer can reach 80. Rare or difficult words do not raise the band by themselves.
- 100: Uses the forms on the grade's grammar list correctly and naturally, and also uses forms beyond the list (the next grade up) naturally. Words fit the scene. Almost no errors.
- 80: Uses the forms on the grade's grammar list correctly, in complete sentences. Errors are rare and do not block the meaning.
- 60: Complete sentences, but only with the easier forms on the list, or forms of the grade with clear errors (verb forms, articles, prepositions). The meaning is clear.
- 40: Short simple sentences or phrases with frequent errors (a missing be-verb, bare verbs). The meaning is mostly clear.
- 20: Isolated words or memorized fragments, hardly any sentence structure.
- 0: No English that can be assessed.`;

const SYSTEM = `You grade short spoken English descriptions by Japanese learners in a party game. The players are junior and senior high school students practicing for a speaking test, at one of three grades: eiken-3 (easiest), eiken-pre2, eiken-2 (hardest).
All players watched the same 3D scene and described it freely in up to 20 seconds. The input is an automatic transcript, so ignore punctuation and small recognition errors.

You get the scene data: every thing in the scene with its name, English words, size, position, facing and motion, and the relations the scene was built from. It is the ground truth; nothing else is in the scene. A model answer for the grade may follow as a supplement; when it disagrees with the scene data, trust the scene data.
Players can rotate the scene, so accept left/right and front/back from any viewpoint as long as the relation could be true from some side. Do not judge colors that the scene data does not give.

You also get the checklist of the scene. Each item has an id, a kind (center: who is doing what; reason: why something is happening; link: a chain from a cause through an action to its result or purpose; detail: a position, a count and so on), a Japanese label, accept (the English wording that counts as said) and refs (the keys of the things in the scene data that the item is about).

# Claims
Split what the player said into claims and judge each one. Do not give a content score; the program computes it from your claims.
- One claim is one fact. "A man is reading a book next to the table." is two claims: "A man is reading a book" and "next to the table". Naming a person or thing ("there is a dog") is a claim too. If the player repeats the same fact, list it once.
- quote: the words of the claim, copied exactly from the transcript as one continuous run of words. Do not fix, reorder or join words. List the claims in the order they were spoken.
- verdict:
  - "correct": agrees with the scene data.
  - "contradiction": about something in the scene, but wrong (calling the cat a dog, a wrong action, a wrong place).
  - "absent": about a person or thing that is not in the scene.
  - "offtopic": not about the scene at all ("I like pizza").
  - "ignored": not counted either way. Use it for a reason or a guess that follows naturally from the scene and does not contradict it but cannot be checked ("maybe he is tired", "I think she is late"), for fillers and connecting words ("I think", "um", "in this picture"), and for a claim that is only about a color the scene data does not give.
  A reason that contradicts the scene, or that depends on something not in the scene, is "contradiction" or "absent".
- item: for a "correct" claim, the id of the checklist item it says, or null when it is true but not on the checklist. For every other verdict, null. Judge meaning, not exact words; grammar mistakes do not matter here.
- level: for a claim with an item, compare it with the item's accept. "full": it says the accept wording or a clear paraphrase of it. "partial": it says only part of it (the person without the action, the action without the person or the object it needs). Null when item is null.
  - reason item: any reason that does not contradict the scene is "full", even if it differs from accept. Saying the action without any reason does not hit the reason item.
  - link item: "full" when two steps are connected: a cause, the action, and its result or purpose (e.g. "The boy threw a ball, so the dog is running across the grass to get it."). "partial" when only one step is connected (a single "because" or "so").
  - A reason or a chain that hits a reason or link item is "correct" with that item, not "ignored".
- note: for "contradiction", "absent" and "offtopic", one short sentence in Japanese saying what is wrong. Otherwise null.

# Expression
Give expression a score from 0 to 100 using the bands below. Pick the band that fits best; scores between bands are fine.

${EXPRESSION_BANDS}

# Feedback
Write feedback in Japanese for the player. Be specific and encouraging, and do not mention points.
1. strength: the best thing the player said. quote: copy the words exactly from the transcript. text: one short sentence saying what the quote conveys well.
2. nextStep: the one thing that would improve the player's description the most. kind: "content" (a checklist item they did not say), "expression" (grammar or vocabulary of their grade), or "speech" (pronunciation, fluency or intonation; only when speech scores are given; choose it when the lowest speech score is clearly below how well they did on content and expression). text: one short sentence with a short English example (e.g. 次は男の人がベンチに向かって歩いているところを足してみよう。"A man is walking toward the bench."). item: when kind is "content", the id of the checklist item to say next; choose among the items the player did not say, by kind in this order: center, reason, link, detail. Otherwise null.
3. rewrite: pick one sentence or fragment of the player and make it natural, keeping the meaning and using the grammar of their grade. before: copy it exactly from the transcript. after: the corrected English. reason: one short sentence in Japanese.
   Words that look like recognition errors (odd or meaningless words, very short fragments) are not the player's mistakes; do not correct them. If nothing needs fixing, return null.`;

const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: "null" }],
});

const schemaFor = (checklist: ChecklistItem[], withSpeech: boolean) => {
  const itemId = nullable({ type: "string", enum: checklist.map((c) => c.id) });
  return {
    type: "object",
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: {
            quote: { type: "string" },
            verdict: {
              type: "string",
              enum: [
                "correct",
                "contradiction",
                "absent",
                "offtopic",
                "ignored",
              ],
            },
            item: itemId,
            level: nullable({ type: "string", enum: ["full", "partial"] }),
            note: nullable({ type: "string" }),
          },
          required: ["quote", "verdict", "item", "level", "note"],
          additionalProperties: false,
        },
      },
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
          item: itemId,
        },
        required: ["kind", "text", "item"],
        additionalProperties: false,
      },
      rewrite: nullable({
        type: "object",
        properties: {
          before: { type: "string" },
          after: { type: "string" },
          reason: { type: "string" },
        },
        required: ["before", "after", "reason"],
        additionalProperties: false,
      }),
    },
    required: ["claims", "expression", "strength", "nextStep", "rewrite"],
    additionalProperties: false,
  };
};

/** Claude が返す形（内容の点は入らない） */
export type ChecklistJudgment = {
  claims: Claim[];
  expression: number;
  strength: ContentFeedback["strength"];
  nextStep: RawNextStep;
  rewrite: Rewrite | null;
};

export type ChecklistInput = {
  grade: Grade;
  checklist: ChecklistItem[];
  // layout.ts の describeLayoutWithRelations で作った、関係つきの場面の情報
  sceneData: string;
  // 級の見本の答え（場面の description。補足）
  description?: string;
  // 級の文法の一覧。表現の段階の物差しにする（生成と同じ定数 GRADES から渡す）
  grammar: string[];
  // 一つ上の級で足される文法の一覧。あれば 100 の段階の目安として渡す
  grammarAbove?: string[];
  transcript: string;
  speech?: SpeechAspects;
};

export type ChecklistScore = {
  content: number;
  expression: number;
  // 描写の一覧・項目ごとの達成・言えたと正しさの内訳
  breakdown: ContentBreakdown;
  strength: ContentFeedback["strength"];
  nextStep: CheckedNextStep;
  rewrite: Rewrite | null;
};

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;
/** Claude の呼び出し。テストや測定では差し替える */
export type CreateMessage = (
  params: CreateParams,
) => Promise<Pick<Anthropic.Message, "stop_reason" | "content">>;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const describeChecklist = (checklist: ChecklistItem[]) =>
  checklist
    .map(
      (c) =>
        `- ${c.id} [${c.kind}] ${c.label} / accept: ${c.accept} / refs: ${c.refs.join(", ")}`,
    )
    .join("\n");

/** Claude に渡す本文。重みと F1 の式は入れない（点を意識した判定を避ける） */
export const checklistPrompt = (input: ChecklistInput) => {
  const parts = [
    `Grade: ${input.grade}`,
    `Grammar list of the grade:\n${input.grammar.map((g) => `- ${g}`).join("\n")}`,
  ];
  if (input.grammarAbove?.length) {
    parts.push(
      `Forms added in the next grade up:\n${input.grammarAbove.map((g) => `- ${g}`).join("\n")}`,
    );
  }
  parts.push(
    `Scene data:\n${input.sceneData}`,
    `Checklist:\n${describeChecklist(input.checklist)}`,
  );
  if (input.description) {
    parts.push(`Model answer (supplement): ${input.description}`);
  }
  if (input.speech) {
    const { accuracy, fluency, prosody } = input.speech;
    parts.push(
      `Speech scores (0-100, from pronunciation assessment): pronunciation ${accuracy}, fluency ${fluency}, intonation ${prosody}`,
    );
  }
  parts.push(`Transcript: ${input.transcript}`);
  return parts.join("\n\n");
};

/** Claude が返した判定から、内容の点・内訳・確かめた次の一つを作る（Claude は呼ばない） */
export const scoreJudgment = (
  input: Pick<ChecklistInput, "checklist" | "transcript">,
  judged: ChecklistJudgment,
): ChecklistScore => {
  const { content, ...breakdown } = scoreContent(
    input.checklist,
    input.transcript,
    judged.claims,
  );
  return {
    content,
    expression: clamp(judged.expression),
    breakdown,
    strength: judged.strength,
    nextStep: checkNextStep({ content, ...breakdown }, judged.nextStep),
    rewrite: judged.rewrite,
  };
};

/**
 * チェックリストで採点する。create を渡すと Claude の呼び出しを差し替えられる（そのとき CLAUDE_API_KEY は要らない）。
 * 3 語未満の発話を 0 点にするのと、strength・rewrite の引用の確かめ（feedback.ts の checkedNotes）は、呼ぶ側で行う
 */
export async function gradeWithChecklist(
  env: ScoringEnv,
  input: ChecklistInput,
  deps: { create?: CreateMessage } = {},
): Promise<ChecklistScore> {
  let create = deps.create;
  if (!create) {
    if (!env.CLAUDE_API_KEY) {
      throw new ClaudeError("CLAUDE_API_KEY が要る");
    }
    const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY });
    create = (params) => client.messages.create(params);
  }
  const response = await create({
    model: env.CLAUDE_MODEL || DEFAULT_MODEL,
    max_tokens: 4000,
    output_config: {
      effort: effortOf(env.CLAUDE_EFFORT),
      format: {
        type: "json_schema",
        schema: schemaFor(input.checklist, !!input.speech),
      },
    },
    system: SYSTEM,
    messages: [{ role: "user", content: checklistPrompt(input) }],
  });
  if (response.stop_reason !== "end_turn") {
    throw new ClaudeError(`Claude が途中で止まった: ${response.stop_reason}`);
  }
  const text = response.content.find((b) => b.type === "text");
  if (text?.type !== "text") {
    throw new ClaudeError("Claude の応答に本文が無い");
  }
  return scoreJudgment(input, JSON.parse(text.text) as ChecklistJudgment);
}
