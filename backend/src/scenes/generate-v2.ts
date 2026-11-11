import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  ATTEMPT_TIMEOUT_MS,
  type CreateMessage,
  classify,
  DEFAULT_SCENE_MODEL,
  type Effort,
  effortOf,
  type GenerateEnv,
  type GenerateOptions,
  itemsSchema,
  PlanItems,
  SCENE_RULES,
  SceneGenerationError,
  THEMES,
} from "./generate";
import { GRADE_LIST, grammarUpTo, kindsOf } from "./grades";
import { actionVocabulary, thingVocabulary } from "./pose-verbs";
import {
  CHECKLIST_KINDS,
  type GradeId,
  type Part,
  type PlanItem,
  type ScenePlanV2,
  type SceneSentences,
} from "./types";
import { type Problem, refNames, verifyItems, verifySentences } from "./verify";

// 英文を先に書く 2 段の場面の生成（scenenglish.scene/2）。
// 1 回目: 部品の一覧を見せず、級の規則で英文の部分（name・description・checklist）を書かせる。
// 部品の候補: candidates()。今は全部の部品を返す。後でベクトル検索に差し替える。
// 2 回目: 1 回目の出力・候補の部品・呼び名の一覧を渡し、部品と関係（items）を書かせる。
// 決めた経緯は docs/adr/20261110-write-grade-sentences-before-scene-parts.md。
// 今の 1 回の生成（generate.ts の generatePlan）は置き換えない。部屋での生成にはまだつないでいない

/** 2 段の生成への入力。theme を省けば、指示の中のテーマの一覧から Claude が選ぶ */
export type GenerateV2Input = { grade: GradeId; theme?: string };

// 指示の例は /2 の形で eiken-pre2 の 1 つだけ（例に似た場面ばかりになるのを防ぐ）。
// docs/design/scene-protocol.md の雨のバス停を、実在の部品で組めるよう直したもの
export const EXAMPLE_GRADE: GradeId = "eiken-pre2";
export const EXAMPLE_THEME = "バス停（bus stop）";
export const EXAMPLE_SENTENCES: SceneSentences = {
  name: "雨のバス停",
  description:
    "It is raining at the bus stop. A girl is holding an umbrella. A boy is running to the bus stop because he has no umbrella. A man is sitting on the bench. He is reading a book.",
  checklist: [
    {
      id: "girl_umbrella",
      kind: "center",
      label: "女の子が傘をさしている",
      accept: "a girl is holding an umbrella",
      refs: ["girl"],
    },
    {
      id: "boy_run",
      kind: "center",
      label: "男の子が走っている",
      accept: "a boy is running to the bus stop",
      refs: ["boy"],
    },
    {
      id: "man_sit",
      kind: "center",
      label: "男の人がベンチに座っている",
      accept: "a man is sitting on the bench",
      refs: ["man", "bench"],
    },
    {
      id: "why_run",
      kind: "reason",
      label: "男の子が走っている理由",
      accept: "because he has no umbrella / because it is raining",
      refs: ["rain", "boy"],
    },
    {
      id: "rain",
      kind: "detail",
      label: "雨が降っている",
      accept: "it is raining",
      refs: ["rain"],
    },
    {
      id: "man_read",
      kind: "detail",
      label: "男の人が本を読んでいる",
      accept: "he is reading a book",
      refs: ["man"],
    },
  ],
};
export const EXAMPLE_ITEMS: PlanItem[] = [
  { key: "ground", part: "sidewalk_stone", place: { relation: "ground" } },
  { key: "rain", part: "rain", place: { relation: "ground" } },
  {
    key: "bench",
    part: "bench",
    place: { relation: "ground", zone: "center" },
  },
  {
    key: "man",
    part: "person_read_sit_adult_a",
    place: { relation: "sit_on", target: "bench" },
  },
  {
    key: "girl",
    part: "person_umbrella_girl_a",
    place: {
      relation: "relate",
      target: "bench",
      side: "right",
      distance: "approach",
      turn: "same",
    },
  },
  {
    key: "boy",
    part: "person_run_boy_a",
    place: { relation: "ground", zone: "left" },
    motion: { type: "move", toward: "bench", duration: 5 },
  },
];

const range = (min: number, max: number) =>
  min === max ? `${min}` : `${min}-${max}`;

/** 級の規則の表（1 回目の指示）。GRADES から作るので、裏取りで数える数と食い違わない */
export const gradeRules = (): string =>
  GRADE_LIST.map((g) => {
    const counts = kindsOf(g.id)
      .map((k) => `${g.checklist[k]} ${k}`)
      .join(", ");
    return `## ${g.id} (CEFR ${g.cefr})
- People: ${range(g.people.min, g.people.max)} people or animals (an animal counts as one), ${g.people.note}.
- description: exactly ${g.sentences} sentences, about ${g.words} words in total.
- checklist: exactly ${counts}.
- Verbs of the center items: CEFR-J ${g.cefr} or below.
- Grammar you may use: ${grammarUpTo(g.id).join("; ")}.`;
  }).join("\n\n");

/** 1 回目の指示。部品の一覧は渡さず、今の部品で描ける人・動作・物の語彙だけを渡す */
export const buildSentenceSystem = (
  parts: Part[],
) => `You write the English side of small 3D scenes for an English speaking game for Japanese learners. The game follows the grades of the Eiken speaking test.
Players look at a 3D scene and describe it aloud in English. Their answer is scored with a checklist: which items they said, and whether what they said is true in the scene.
You get a grade and a theme. If no theme is given, choose one from the theme list. Write the name, the model answer (description) and the checklist of one scene.
You do not choose 3D parts. A second step builds the scene from your text with a fixed set of parts, so write only what those parts can show (see "What the scene can show").

# Grades
${gradeRules()}

Grammar and verbs of a lower grade may be used in a higher grade, but never use grammar above the grade. Keep the other words at the CEFR level of the grade too; most nouns come from the list of things below.

# description (the model answer)
- Write what a good player of that grade would say about the scene: plain sentences, one fact or action per sentence or clause.
- Every sentence must be visible in a still 3D scene with simple motion. Do not write names, feelings, thoughts, speech, sounds, or anything that happened before and left nothing to see.
- Every person and animal does one action from the list below, and only a person listed for that action can do it (a girl can blow out candles; a man cannot). Use each person or animal once.
- Write the description before the checklist.

# checklist
- center: who is doing what (the main people and animals). The verb must be one of the verbs listed for that action, at or below the CEFR-J level of the grade.
- detail: a position, a number, a thing, the weather, or a second fact about a person.
- reason (eiken-pre2 and eiken-2): why a person does something. The cause must be something visible in the scene, placed as its own thing or person: rain, a spilled drink, a person who has fallen down, a thrown ball, and so on. Think of the cause yourself, but use only causes the scene can show. Say the reason in the description.
- link (eiken-2 only): a chain of two steps, cause -> action -> result or purpose, said in one sentence ("The boy threw a ball, so the dog is running across the grass to get it.").
- id: short snake_case, unique. label: short Japanese shown to the player after the round.
- accept: the English wording that counts as "said". Copy it word for word from the description (a whole sentence or one clause; lower case and no final period are fine). Every accept must be found in the description. For reason and link you may add other correct wordings after " / ", but the first wording must be copied from the description.
- refs: the people and things the item is about, as short lower-case English names (man, bench, rain; letters, digits and _ only). Use one name for one person or thing in the whole checklist (two boys: boy and tall_boy). The second step puts one part in the scene for every name, so name only things that stand in the scene as their own part: people, animals, furniture, things, rain. Do not name the place itself (park), a body part, or a thing that a person holds as part of the action (the book of a person reading, the box of a person carrying): name the person instead.
- reason and link items need two or more refs: the cause and the person who acts.

# What the scene can show
People and animals, one line per action: action | verbs you may use for it, each with its CEFR-J level | who can do it
${actionVocabulary(parts)}

Things and places, as "English word (Japanese name of the part)":
${thingVocabulary(parts)}

Things can also fall, move in a straight line, spin or sway. A ball can fly from a person who throws it to a person who catches it. Faces and feelings are not visible.

# Themes (choose one when the request has no theme)
${THEMES.map((t) => `- ${t}`).join("\n")}
For eiken-pre2 and eiken-2, do not choose a theme where you cannot place a visible cause. If the given theme cannot be made with these parts, write the closest everyday scene you can.

# Example
Request: 級: ${EXAMPLE_GRADE} / テーマ: ${EXAMPLE_THEME}
${JSON.stringify(EXAMPLE_SENTENCES)}`;

const describePartV2 = (p: Part) => {
  const fields = [
    p.id,
    p.label,
    p.category,
    `words: ${p.words.map((w) => w.word).join(", ")}`,
    p.pose ? `pose: ${p.pose}` : null,
    p.holds ? `holds: ${p.holds}` : null,
    p.uses ? `uses: ${p.uses.join(", ")}` : null,
    `size(w,h,d): ${p.size.join(", ")}`,
    p.anchors ? `anchors: ${JSON.stringify(p.anchors)}` : null,
  ];
  return `- ${fields.filter(Boolean).join(" | ")}`;
};

// 2 回目の指示に足す、人と物のやり取りの関係（relate・seat_at・thrown_by）。
// 今の 1 回の生成の指示（SCENE_RULES）には無いので、ここで教える
const PEOPLE_RULES = `# Relations with people (use these whenever a person or an animal is involved; they take priority over the simple relations above)
- relate: how a person, an animal or a piece of furniture stands against target. It has four independent settings:
  - link: "hand" = the hand touches target (wiping, cooking, paying, putting, taking; with spot, the hand goes to that named spot of target, such as spot "register" of checkout_counter or "top_book" of bookshelf; the spots are in anchors.spots). "body" (default) = the whole body stands apart from target. "under" = stand under the umbrella that target holds (sharing an umbrella); side, distance and turn are not used.
  - side: where you stand as seen from target: front, back, left, right (based on the body of the target person or seat). Use "any" for a target without a front (a tree, a table, a bicycle) and when the text does not say.
  - distance: the gap between the two bodies. touch (nothing between), beside (side by side), talk (talking, asking, helping), approach (waiting in a line, bringing something, running to something), far (pointing or calling from a distance, running after someone).
  - turn: toward (face target), away (back to target), same (the same direction as target, as in a line or side by side).
  Examples: side by side = side left, distance beside, turn same. Waiting in a line = side back, distance approach, turn same. Running after someone = side back, distance far, turn same. Talking = side front, distance talk, turn toward.
- seat_at: a chair at the next free seat of a table (target the table). Use it for every chair at a table; the person then uses sit_on with that chair. Choose the table by the number of people: table_small for 2, table_long for 3 to 6, table_party for 8 or more.
- thrown_by: a thrown thing in the air in front of the person who throws it (target), or between that person and the person who catches it.
- facing "auto": for the first person or seat of a group, use relation "ground", zone "center", facing "auto"; the program tries directions and picks the one where nobody hides another person. relate sets the direction itself. Give facing "left" or "right" only when someone walks or runs alone in a direction.
- "holds" names what a part already has in its hands; do not add that thing as a separate item. "uses" lists parts that must also be in the scene for that action; add them (a person who cooks needs kitchen_counter and a pan on its spot "stove").
- A person with a sitting pose (anchors.hip) must sit on something: add a chair, a bench or a sofa and use sit_on.
- Furniture that someone works at (kitchen_counter, checkout_counter, bookshelf, ticket_machine) goes with relation "ground" and zone "left"; the program turns it so that the person is seen from the side.
- A background wall can be a target: a person writing on wall_blackboard uses relate with link "hand".
- When it rains, add the part rain with relation "ground" (it covers the whole scene). A cafe uses wall_cafe as its background wall.
- The words of a part say who it is (man, woman, boy, girl, old man). Keep the person of the text: never use a man for a woman.`;

/** 2 回目の指示。場面・関係・向き・動きの決まりは今の生成（SCENE_RULES）と同じ文を使う */
export const buildItemsSystem = (
  parts: Part[],
) => `You build small 3D scenes for an English speaking game for Japanese learners.
Players look at the scene and describe it in English. Their answer is scored with the checklist of the scene.
You get the English side of one scene (name, description and checklist), its grade, and the list of keys. Build the one scene that shows exactly this description, using only the parts listed below. You do not write coordinates: you choose parts and how they relate to each other, and the program computes the positions.

${SCENE_RULES}

${PEOPLE_RULES}

# Writing the items
- "Keys" lists the names used in the refs of the checklist. Use every one of them, exactly once, as the key of the item that shows that person or thing. A program checks this.
- Give the other items (the ground, the background wall, chairs to sit on, a few background things) other short lower-case keys.
- For every person and animal, choose the part whose words say the same person and whose pose shows the action that the description and the accept of the checklist say. A program checks the pose of the people in center items against the verb of accept.
- Show only the people and animals that the description mentions. Everything the description mentions must be in the scene.
- The cause of a reason or link item must be visible as its own item (rain, spilled_juice, a person who has fallen down, a thrown ball).
- At most 40 items.

# Parts (id | label | category | words | pose | holds | uses | size in meters | anchors)
${parts.map(describePartV2).join("\n")}

# Example
Request:
${itemsMessage({ grade: EXAMPLE_GRADE }, EXAMPLE_SENTENCES)}
Answer:
${JSON.stringify({ items: EXAMPLE_ITEMS })}`;

/** 1 回目に書かせる形。kind はその級に出てくる種類だけにする */
export const sentenceSchema = (grade: GradeId) => ({
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    checklist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: kindsOf(grade) },
          label: { type: "string" },
          accept: { type: "string" },
          refs: { type: "array", items: { type: "string" } },
        },
        required: ["id", "kind", "label", "accept", "refs"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "description", "checklist"],
  additionalProperties: false,
});

/** 2 回目に書かせる形。items は今の生成（planSchema）と同じ。部品の ID は候補だけの enum */
export const itemsOnlySchema = (parts: Part[]) => ({
  type: "object",
  properties: { items: itemsSchema(parts) },
  required: ["items"],
  additionalProperties: false,
});

const Sentences = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  checklist: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        kind: z.enum(CHECKLIST_KINDS),
        label: z.string().trim().min(1),
        accept: z.string().trim().min(1),
        refs: z.array(z.string().trim()),
      }),
    )
    .min(1),
});
const ItemsOnly = z.object({ items: PlanItems });

// 裏取りで落ちた理由を、作り直しの指示に足す
const feedbackText = (feedback: string[] | undefined) =>
  feedback?.length
    ? `\n\nYour last answer was rejected by the checking program. Write a new answer that fixes all of these:\n${feedback.map((f) => `- ${f}`).join("\n")}`
    : "";

/** 1 回目の user の文 */
export const sentenceMessage = (input: GenerateV2Input, feedback?: string[]) =>
  `級: ${input.grade}\nテーマ: ${input.theme ?? "一覧から選ぶ"}${feedbackText(feedback)}`;

/** 2 回目の user の文。1 回目の出力の全部と、コードが refs から集めた呼び名の一覧 */
export function itemsMessage(
  input: Pick<GenerateV2Input, "grade">,
  sentences: SceneSentences,
  feedback?: string[],
) {
  return `級: ${input.grade}\nScene: ${JSON.stringify(sentences)}\nKeys: ${refNames(sentences.checklist).join(", ")}${feedbackText(feedback)}`;
}

/**
 * 部品の候補を返す関数の形。description は 1 回目に書いた見本の答え（英文）、parts は全部の部品。
 * 返すのは 2 回目に渡す部品（parts の一部か全部）。ベクトル検索に差し替えるための口なので非同期にしてある
 */
export type CandidateSearch = (
  description: string,
  parts: Part[],
) => Promise<Part[]>;

/** 今は全部の部品を返す。後で「英文 1〜3 文 → 種類ごとに上位 k 個の要素 → 部品」の検索に差し替える */
export const candidates: CandidateSearch = async (_description, parts) => parts;

/** 差し替えられるもの。create は Claude の呼び出し（テストでは偽の応答）、candidates は部品の候補、now は時計 */
export type GenerateV2Deps = {
  create?: CreateMessage;
  candidates?: CandidateSearch;
  now?: () => number;
};

type Call = {
  create: CreateMessage;
  model: string;
  effort: Effort;
  options: GenerateOptions;
};

const prepare = (
  env: GenerateEnv,
  deps: GenerateV2Deps,
  options: GenerateOptions,
): Call => {
  if (!env.CLAUDE_API_KEY) {
    throw new SceneGenerationError("unavailable", "CLAUDE_API_KEY が要る");
  }
  // SDK の再送は使わない（maxRetries 0）。やり直しは callJson で決める
  const create =
    deps.create ??
    (() => {
      const client = new Anthropic({
        apiKey: env.CLAUDE_API_KEY,
        maxRetries: 0,
      });
      return (
        params: Anthropic.MessageCreateParamsNonStreaming,
        callOptions: { timeout: number; signal?: AbortSignal },
      ) => client.messages.create(params, callOptions);
    })();
  return {
    create,
    model: env.CLAUDE_SCENE_MODEL || DEFAULT_SCENE_MODEL,
    effort: effortOf(env.CLAUDE_SCENE_EFFORT),
    options,
  };
};

/**
 * Claude を 1 段ぶん呼び、JSON を形で確かめて返す。呼び方は generatePlan と同じ
 * （json_schema・system に cache_control・形が違う／途中で止まった／5xx／接続の失敗のときだけやり直す）
 */
const callJson = async <T>(
  call: Call,
  label: string,
  system: string,
  schema: Record<string, unknown>,
  user: string,
  parse: (json: unknown) => T | undefined,
): Promise<{ value: T; usage: Anthropic.Usage }> => {
  const timeout = call.options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const maxAttempts = call.options.maxAttempts ?? 2;
  const signal = call.options.signal;
  let last: SceneGenerationError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await call.create(
        {
          model: call.model,
          max_tokens: 8000,
          output_config: {
            effort: call.effort,
            format: { type: "json_schema", schema },
          },
          system: [
            {
              type: "text",
              text: system,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: user }],
        },
        { timeout, signal },
      );
      if (response.stop_reason === "refusal") {
        throw new SceneGenerationError("refused", "Claude が断った");
      }
      if (response.stop_reason !== "end_turn") {
        throw new SceneGenerationError(
          "invalid",
          `Claude が途中で止まった（${response.stop_reason}）`,
        );
      }
      const text = response.content.find((b) => b.type === "text");
      if (text?.type !== "text") {
        throw new SceneGenerationError("invalid", "Claude の応答に本文が無い");
      }
      let json: unknown;
      try {
        json = JSON.parse(text.text);
      } catch {
        throw new SceneGenerationError(
          "invalid",
          "Claude の応答が JSON でない",
        );
      }
      const value = parse(json);
      if (value === undefined) {
        throw new SceneGenerationError("invalid", "Claude の応答の形が違う");
      }
      return { value, usage: response.usage };
    } catch (e) {
      const { error, retry } = classify(e);
      last = error;
      console.error(
        `場面の生成（${label}）に失敗（${attempt} 回目）`,
        error.message,
      );
      if (!retry || signal?.aborted) break;
    }
  }
  throw last as SceneGenerationError;
};

const cleanSentences = (s: z.infer<typeof Sentences>): SceneSentences => ({
  name: s.name,
  description: s.description,
  checklist: s.checklist.map((c) => ({
    ...c,
    refs: c.refs.filter((r) => r.length > 0),
  })),
});

/** 1 回目: 級（とテーマ）から英文の部分を書かせる。feedback は裏取りで落ちた理由（作り直しのとき） */
export async function generateSentences(
  env: GenerateEnv,
  parts: Part[],
  input: GenerateV2Input,
  deps: GenerateV2Deps = {},
  options: GenerateOptions = {},
  feedback?: string[],
): Promise<{ sentences: SceneSentences; usage: Anthropic.Usage }> {
  const result = await callJson(
    prepare(env, deps, options),
    "1 回目・英文",
    buildSentenceSystem(parts),
    sentenceSchema(input.grade),
    sentenceMessage(input, feedback),
    (json) => {
      const parsed = Sentences.safeParse(json);
      return parsed.success ? cleanSentences(parsed.data) : undefined;
    },
  );
  return { sentences: result.value, usage: result.usage };
}

/** 2 回目: 英文の部分と候補の部品から、部品と関係（items）を書かせる */
export async function generateItems(
  env: GenerateEnv,
  candidateParts: Part[],
  input: Pick<GenerateV2Input, "grade">,
  sentences: SceneSentences,
  deps: GenerateV2Deps = {},
  options: GenerateOptions = {},
  feedback?: string[],
): Promise<{ items: PlanItem[]; usage: Anthropic.Usage }> {
  const result = await callJson(
    prepare(env, deps, options),
    "2 回目・部品",
    buildItemsSystem(candidateParts),
    itemsOnlySchema(candidateParts),
    itemsMessage(input, sentences, feedback),
    (json) => {
      const parsed = ItemsOnly.safeParse(json);
      return parsed.success ? (parsed.data.items as PlanItem[]) : undefined;
    },
  );
  return { items: result.value, usage: result.usage };
}

export type GenerateV2Result = {
  plan: ScenePlanV2;
  /** 裏取りで落ちた理由。空なら通った */
  problems: Problem[];
  model: string;
  /** 各段の時間（ms）。candidates は部品の候補を選ぶ時間 */
  ms: { sentences: number; candidates: number; items: number; total: number };
  /** 呼んだ順の usage（1 回目、2 回目） */
  usage: Anthropic.Usage[];
};

/**
 * 2 段の生成を 1 回通す（1 回目 → 部品の候補 → 2 回目 → 裏取り）。作り直しはしない。
 * 裏取りの結果は problems で返す（落ちても投げない）。測定と、作り直しの中の 1 回に使う
 */
export async function generateSceneV2(
  env: GenerateEnv,
  parts: Part[],
  input: GenerateV2Input,
  deps: GenerateV2Deps = {},
  options: GenerateOptions = {},
): Promise<GenerateV2Result> {
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const first = await generateSentences(env, parts, input, deps, options);
  const t1 = now();
  const found = await (deps.candidates ?? candidates)(
    first.sentences.description,
    parts,
  );
  const t2 = now();
  const second = await generateItems(
    env,
    found,
    input,
    first.sentences,
    deps,
    options,
  );
  const t3 = now();
  const plan = { ...first.sentences, items: second.items };
  return {
    plan,
    problems: [
      ...verifySentences(input.grade, plan),
      ...verifyItems(input.grade, plan, plan.items, parts),
    ],
    model: env.CLAUDE_SCENE_MODEL || DEFAULT_SCENE_MODEL,
    ms: {
      sentences: t1 - t0,
      candidates: t2 - t1,
      items: t3 - t2,
      total: t3 - t0,
    },
    usage: [first.usage, second.usage],
  };
}

/** 作り置きで、裏取りに落ちたときに作り直す回数の上限（最初の 1 回とは別に 2 回まで） */
export const MAX_REMAKES = 2;

/** 作り直しても裏取りを通らなかった。problems は最後の回で落ちた理由 */
export class SceneVerificationError extends SceneGenerationError {
  constructor(readonly problems: Problem[]) {
    super(
      "invalid",
      `裏取りを通らなかった: ${problems.map((p) => p.message).join(" / ")}`,
    );
  }
}

export type VerifiedSceneResult = {
  plan: ScenePlanV2;
  model: string;
  /** 作り直した回数（0〜2） */
  remakes: number;
  /** 回ごとに落ちた理由（通った回は入らない） */
  rejected: Problem[][];
  usage: Anthropic.Usage[];
};

/**
 * 作り置きを作る道。裏取りで落ちたら、落ちた理由を指示に足して 2 回まで作り直す。
 * 英文の部分で落ちたら 1 回目から、部品だけで落ちたら同じ英文のまま 2 回目だけを作り直す
 *（同じ英文で部品が 2 回落ちたら、英文が部品で描けないとみて 1 回目から）。
 * 英文の部分で落ちたときは 2 回目を呼ばない（部品を選ぶ前に分かるので）。
 * 通らなければ SceneVerificationError を投げる。部屋での生成では使わない（作り直さず作り置きに切り替えるため）
 */
export async function generateVerifiedScene(
  env: GenerateEnv,
  parts: Part[],
  input: GenerateV2Input,
  deps: GenerateV2Deps = {},
  options: GenerateOptions = {},
): Promise<VerifiedSceneResult> {
  const find = deps.candidates ?? candidates;
  const usage: Anthropic.Usage[] = [];
  const rejected: Problem[][] = [];
  let sentences: SceneSentences | undefined;
  let found: Part[] = parts;
  let feedback: string[] | undefined;
  let itemsRejected = 0;
  for (let round = 0; round <= MAX_REMAKES; round++) {
    if (!sentences) {
      const first = await generateSentences(
        env,
        parts,
        input,
        deps,
        options,
        feedback,
      );
      usage.push(first.usage);
      const problems = verifySentences(input.grade, first.sentences);
      if (problems.length > 0) {
        rejected.push(problems);
        feedback = problems.map((p) => p.message);
        continue;
      }
      sentences = first.sentences;
      found = await find(sentences.description, parts);
      feedback = undefined;
    }
    const second = await generateItems(
      env,
      found,
      input,
      sentences,
      deps,
      options,
      feedback,
    );
    usage.push(second.usage);
    const problems = verifyItems(input.grade, sentences, second.items, parts);
    if (problems.length === 0) {
      return {
        plan: { ...sentences, items: second.items },
        model: env.CLAUDE_SCENE_MODEL || DEFAULT_SCENE_MODEL,
        remakes: round,
        rejected,
        usage,
      };
    }
    rejected.push(problems);
    feedback = problems.map((p) => p.message);
    itemsRejected++;
    // 英文を書き直さないと直らない理由があるか、同じ英文で部品が 2 回落ちたら、1 回目から作り直す
    if (problems.some((p) => p.stage === "sentences") || itemsRejected >= 2) {
      sentences = undefined;
      itemsRejected = 0;
    }
  }
  throw new SceneVerificationError(rejected[rejected.length - 1]);
}
