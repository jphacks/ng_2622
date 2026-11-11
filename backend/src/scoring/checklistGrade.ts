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
import type { Rewrite, ScoringEnv, SpeechAspects } from "./types";

// 内容をチェックリストの F1、表現を級の文法の一覧に照らした段階で付ける。1 人につき Claude を 1 回呼ぶ
// （ADR 20261110-score-content-with-checklist-f1・20261110-align-scoring-with-eiken-speaking-viewpoints）。
// Claude が返すのは描写の一覧と表現の点と講評だけで、内容の点は checklist.ts が計算する。

// 表現の段階の文は下書き。PR で人が確かめたものに差し替える。IELTS・英検の公式の文は丸写ししない。
// 表現は発話の全部（推測や、場面と合わない文も含む）の英語を見る。合っているかは描写の判定だけで見る
// （2026-11-11 の実測で、推測を足した正しい英文の表現が 0 点になったため、0 と 60 の条件をはっきり書いた）
const EXPRESSION_BANDS = `Expression: the grammar and vocabulary of the player's English, measured against the grammar list in the input. The list covers the player's grade and the easier grades below it; its examples in parentheses are only examples.
Judge the English of the whole transcript: every sentence counts, including guesses, opinions ("I think ...", "Maybe ...") and sentences that are wrong about the scene or not about it. Whether a statement is true is judged only in the claims and must not change this score; the verdicts ("ignored" and so on) do not matter here.
Judge how well the player uses the forms, not how long or how difficult the answer is. A short answer can reach 80. Rare or difficult words do not raise the band by themselves. Forms that are not on any list ("I think", "maybe", "can") are fine and never lower the band.
- 100: Uses forms on the grammar list correctly and naturally, and also uses a form from the next grade up naturally. Almost no errors.
- 80: Uses forms on the grammar list correctly, in complete sentences. Errors are rare and do not block the meaning.
- 60: Complete sentences whose meaning is clear, but with some clear errors (verb forms, articles, prepositions).
- 40: Short simple sentences or phrases with frequent errors (a missing be-verb, bare verbs). The meaning is mostly clear.
- 20: Isolated words or memorized fragments, hardly any sentence structure.
- 0: Only when the transcript has no English words to judge.
One complete and correct English sentence is already 60 or more.`;

const SYSTEM = `You grade short spoken English descriptions by Japanese learners in a party game. The players are junior and senior high school students practicing for a speaking test, at one of three grades: eiken-3 (easiest), eiken-pre2, eiken-2 (hardest).
All players watched the same 3D scene and described it freely in up to 20 seconds. The input is an automatic transcript, so ignore punctuation and small recognition errors.

You get the scene data: every thing in the scene with its name, English words, size, position, facing and motion, and the relations the scene was built from. It is the ground truth; nothing else is in the scene. A model answer for the grade may follow as a supplement; when it disagrees with the scene data, trust the scene data.
Players can rotate the scene, so accept left/right and front/back from any viewpoint as long as the relation could be true from some side. Do not judge colors that the scene data does not give.

You also get the checklist of the scene. Each item has an id, a kind (center: who is doing what; reason: why something is happening; link: a chain from a cause through an action to its result or purpose; detail: a position, a count, a thing that is there and so on), a Japanese label, accept (the English wording that counts as said) and refs (the keys of the things in the scene data that the item is about). When accept lists several wordings separated by " / ", saying any one of them is enough.

# Claims
Split what the player said into claims and judge each one. Do not give a content score; the program computes it from your claims.
- One claim is one fact. Always put an action (who is doing what) and a position (a preposition phrase: where it is or where it happens) into separate claims. "A man is reading a book next to the table." is two claims: "A man is reading a book" and "next to the table". Naming a person or thing ("there is a dog", or each noun of "woman, table, cup") is a claim too. If the player repeats the same fact, list it once.
- Split even when the verb and the position are stuck together: "A woman is wiping under the table." is "A woman is wiping" and "under the table"; "There is a bicycle next to the bench." is "There is a bicycle" and "next to the bench".
- Judge each claim on its own. A wrong position does not make the action wrong. For a scene where a girl is sitting on a bench, "A girl is sitting under a bench." gives "A girl is sitting" (correct; it hits the item about the girl sitting) and "under a bench" (contradiction). For a scene where a dog is running on the grass, "A dog is running on the bench." gives "A dog is running" (correct) and "on the bench" (contradiction).
- When one stretch of speech says what two checklist items ask (an action and its reason, or an action inside a chain), make one claim for each item; their quotes may overlap or even be the same words. "A woman is wiping the table because of the juice." gives "A woman is wiping the table" (the center item about wiping) and "A woman is wiping the table because of the juice" (the reason item). Do the same for a long sentence that contains both a center item and a link item.
- quote: the words of the claim, copied exactly from the transcript as one continuous run of words. Do not fix, reorder or join words. List the claims in the order they were spoken.
- verdict:
  - "correct": agrees with the scene data.
  - "contradiction": about something in the scene, but wrong (calling the cat a dog, a wrong action, a wrong place).
  - "absent": about a person or thing that is not in the scene.
  - "offtopic": not about the scene at all ("I like pizza").
  - "ignored": not counted either way. Use it for a reason or a guess that follows naturally from the scene and does not contradict it but cannot be checked ("maybe he is tired", "I think she is late"), for fillers and connecting words ("I think", "um", "in this picture"), and for a claim that is only about a color the scene data does not give.
  A reason that contradicts the scene, or that depends on something not in the scene, is "contradiction" or "absent".
- item: for a "correct" claim, the id of the checklist item it says, or null when it is true but not on the checklist. For every other verdict, null. Judge meaning, not exact words; grammar mistakes do not matter here ("Woman wipe table" says the same as "a woman is wiping the table").
- level: "full" or "partial" for a claim with an item; null when item is null. Decide item and level by the kind of the item, with these rules only:
  - center item (who is doing what):
    - "full": the claim says the action of accept about that person or animal. Another verb with the same meaning counts. A place or other small words are not needed: for accept "a boy is sitting", "A boy is sitting" is full, with or without a place after it.
    - "partial": the claim says the action, but who does it or the object of the action is wrong or missing (for accept "a woman is wiping the table": "A woman is wiping", or "Someone is wiping the table").
    - A claim that only names the person or animal ("a girl", "there is a dog", a noun in a list) does not hit a center item: item null. It is still "correct" when the thing is in the scene.
  - detail item (a fact such as where a thing is or what state it is in):
    - "full": the claim says the fact of accept.
    - "partial": the claim says in a sentence that the thing is there, but leaves out the position or state accept asks for (for accept "there is a plant next to the boy": "There is a plant").
    - A bare name ("juice", "plant" in a list of nouns) does not hit a detail item whose accept asks for a position or a state: item null. It hits the item (full) only when accept asks for nothing more than the thing being there.
  - A claim that is only a position ("near the bench", "next to the boy"): when a detail item asks about that position, it hits that item (full when the position matches accept). Otherwise item null. A position claim never hits a center item.
  - reason item: its accept is a whole sentence, an action with its cause ("a boy is running because it is raining"). "full" when the claim says that action together with a reason that does not contradict the scene; the reason may differ from the one in accept. "partial" when a reason is given but the action it explains is wrong or unclear. Saying only the action, without a reason, does not hit the reason item (it hits the center item about that action). A reason for a different action does not hit it. Naming things does not hit it.
  - link item: its accept is a whole sentence with a chain. "full" when two steps are connected: a cause, the action, and its result or purpose (e.g. "The boy threw a ball, so the dog is running across the grass to get it."). "partial" when only one step is connected to that action (a single "because", "so" or "to ..."). Saying only the action does not hit it. Naming things does not hit it.
  - A reason or a chain that hits a reason or link item is "correct" with that item, not "ignored".
- note: for "contradiction", "absent" and "offtopic", one short sentence in Japanese saying what is wrong. Otherwise null.

# Expression
Fill in every field after the claims too; never leave expressionBasis or the feedback texts empty.
First write expressionBasis: one English sentence saying which forms the player used correctly and what errors there are. Then give expression a score from 0 to 100 that follows from it, using the bands below. Pick the band that fits best; scores between bands are fine.

${EXPRESSION_BANDS}

# Feedback
Write feedback in Japanese for the player. Be specific and encouraging, and do not mention points.
1. nextStep: the one thing that would improve the player's description the most. kind: "content" (a checklist item they did not say), "expression" (grammar or vocabulary of their grade), or "speech" (pronunciation, fluency or intonation; only when speech scores are given; choose it when the lowest speech score is clearly below how well they did on content and expression). text: one short sentence with a short English example (e.g. 次は男の人がベンチに向かって歩いているところを足してみよう。"A man is walking toward the bench."). item: when kind is "content", the id of the checklist item to say next; choose among the items the player did not say, by kind in this order: center, reason, link, detail. Otherwise null.
2. rewrite: pick one sentence or fragment of the player and make it natural, keeping the meaning and using the grammar of their grade. before: copy it exactly from the transcript. after: the corrected English. reason: one short sentence in Japanese.
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
      // 点の前に根拠を書かせる（根拠なしに数字を書かせると、正しい英文に 0 が返る回があった）
      expressionBasis: {
        type: "string",
        description:
          "One English sentence, never empty: which forms the player used correctly, and what errors there are",
      },
      expression: {
        type: "integer",
        description:
          "0-100 by the Expression bands, for the English of the whole transcript",
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
    required: [
      "claims",
      "expressionBasis",
      "expression",
      "nextStep",
      "rewrite",
    ],
    additionalProperties: false,
  };
};

/** Claude が返す形（内容の点は入らない） */
export type ChecklistJudgment = {
  claims: Claim[];
  // 表現の点の根拠（英語で 1 文）。記録用で、アプリには送らない
  expressionBasis: string;
  expression: number;
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
  // 級の文法の一覧。下の級の分も含めて渡す。表現の段階の物差しにする（生成と同じ定数 GRADES から作る）
  grammar: string[];
  // 一つ上の級で足される文法の一覧。あれば 100 の段階の目安として渡す
  grammarAbove?: string[];
  transcript: string;
  speech?: SpeechAspects;
};

export type ChecklistScore = {
  content: number;
  expression: number;
  // 表現の点の根拠（記録用。アプリには送らない）
  expressionBasis: string;
  // 表現が 0 点か根拠が空で返ったために Claude を呼び直した回数（0〜2）
  expressionRetries: number;
  // 描写の一覧・項目ごとの達成・言えたと正しさの内訳
  breakdown: ContentBreakdown;
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
    `Grammar list (the player's grade and the easier grades below it):\n${input.grammar.map((g) => `- ${g}`).join("\n")}`,
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
): Omit<ChecklistScore, "expressionRetries"> => {
  const { content, ...breakdown } = scoreContent(
    input.checklist,
    input.transcript,
    judged.claims,
  );
  return {
    content,
    expression: clamp(judged.expression),
    expressionBasis: judged.expressionBasis ?? "",
    breakdown,
    nextStep: checkNextStep({ content, ...breakdown }, judged.nextStep),
    rewrite: judged.rewrite,
  };
};

// これより短い発話は呼び直さない（index.ts の MIN_WORDS と同じ。3 語未満は呼ぶ側が Claude を呼ばずに 0 点にする）
const RETRY_MIN_WORDS = 3;
// 呼び直しの上限（初めの 1 回と合わせて 3 回まで呼ぶ）
const MAX_RETRIES = 2;

type Scored = Omit<ChecklistScore, "expressionRetries">;
const hasBasis = (s: Scored) => s.expressionBasis.trim() !== "";
// Claude が描写を書いたあと、残りの欄を空の値（""・0）で埋めて終えることがある。そういう応答は使わず呼び直す
const incomplete = (s: Scored) => s.expression === 0 || !hasBasis(s);
// どれも不完全なときに選ぶ順。根拠のあるもの（本当に 0 点と判定したもの）、次に点のあるもの
const rank = (s: Scored) => (hasBasis(s) ? 2 : 0) + (s.expression > 0 ? 1 : 0);

/**
 * チェックリストで採点する。create を渡すと Claude の呼び出しを差し替えられる（そのとき CLAUDE_API_KEY は要らない）。
 * 3 語以上の発話に、表現 0 点か空の根拠が返ったら、同じ入力で 2 回まで呼び直す。
 * 完全な応答が得られたら、その応答の全部（描写・講評も）を使う。得られなければ、根拠が空でない応答を優先し、同じなら先のものを使う。
 * 呼び直しが失敗したら、そこでやめて、それまでの応答から選ぶ。
 * 3 語未満の発話を 0 点にするのと、rewrite の引用の確かめ（feedback.ts の checkedRewrite）は、呼ぶ側（index.ts）で行う
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
  const params: CreateParams = {
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
  };
  const first = scoreJudgment(input, await judge(create, params));
  const words = input.transcript.split(/\s+/).filter(Boolean).length;
  if (!incomplete(first) || words < RETRY_MIN_WORDS) {
    return { ...first, expressionRetries: 0 };
  }
  let best = first;
  let retries = 0;
  while (retries < MAX_RETRIES) {
    retries++;
    try {
      const next = scoreJudgment(input, await judge(create, params));
      if (rank(next) > rank(best)) best = next;
      if (!incomplete(next)) break;
    } catch (e) {
      // 呼び直しの失敗で採点を落とさない
      console.error("採点の呼び直しに失敗", e);
      break;
    }
  }
  return { ...best, expressionRetries: retries };
}

const judge = async (
  create: CreateMessage,
  params: CreateParams,
): Promise<ChecklistJudgment> => {
  const response = await create(params);
  if (response.stop_reason !== "end_turn") {
    throw new ClaudeError(`Claude が途中で止まった: ${response.stop_reason}`);
  }
  const text = response.content.find((b) => b.type === "text");
  if (text?.type !== "text") {
    throw new ClaudeError("Claude の応答に本文が無い");
  }
  return JSON.parse(text.text) as ChecklistJudgment;
};
