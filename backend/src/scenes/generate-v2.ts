import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { PartOrder } from "../parts/workshop";
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
import {
  CEFR_LEVELS,
  checklistSize,
  GRADE_LIST,
  GRADES,
  grammarUpTo,
  kindsOf,
  withinLevel,
} from "./grades";
import {
  livingId,
  livingTable,
  MAX_NEW_PARTS,
  OrderSchema,
  orderJsonSchema,
  provisionalPart,
  resolveParts,
  thingNouns,
} from "./lookup";
import {
  actionVocabulary,
  poseVerbsOf,
  thingVocabulary,
  verbsAbove,
} from "./pose-verbs";
import {
  CHECKLIST_KINDS,
  type ChecklistKind,
  type GradeId,
  type Part,
  type PlanItem,
  type ScenePlanV2,
  type SceneSentences,
} from "./types";
import { reasonSeeds } from "./variety";
import {
  acceptInDescription,
  normalizeText,
  type Problem,
  refNames,
  verifyItems,
  verifyPlaces,
  verifyScene,
  verifySentences,
} from "./verify";
import { defaultPitch, type WeakFocus, weakText } from "./weak";

// 英文を先に書く 2 段の場面の生成（scenenglish.scene/2）。
// 1 回目: 部品の一覧を見せず、級の規則で英文の部分（name・description・checklist）を書かせる。
// 部品の候補: candidates()。今は全部の部品を返す。後でベクトル検索に差し替える。
// 2 回目: 1 回目の出力・候補の部品・呼び名の一覧を渡し、部品と関係（items）を書かせる。
// 決めた経緯は docs/adr/20261110-write-grade-sentences-before-scene-parts.md。
// 今の 1 回の生成（generate.ts の generatePlan）は置き換えない。部屋での生成にはまだつないでいない

/** 2 段の生成への入力。theme を省けば、指示の中のテーマの一覧から Claude が選ぶ */
export type GenerateV2Input = {
  grade: GradeId;
  theme?: string;
  /**
   * すでに作った場面の要約（variety.ts の summarizeScene）。渡すと、1 回目に「これらと違う場面にする」と指示する。
   * 作り置きを級ごとにまとめて作るとき、場面が似すぎないようにするためのもの
   */
  avoid?: string[];
  /** 苦手の場面（POST /weak-scenes）の苦手。渡すと 1 回目に苦手の指示を足し、一言（pitch）も書かせる */
  weak?: WeakFocus;
};

/**
 * 1 回目に Claude が書く形。description を文の配列で書かせ、項目ごとに「どの文の事実か」を番号で書かせる。
 * 2級は項目が 8 つ・見本が 6 文で、accept を description と違う文で書く・同じ文を 2 つの項目に使う、が多かった。
 * 文と項目の対応を形にして、accept が description にあることをコードで保証する（toSceneSentences）。
 * 保存する場面の形（scenenglish.scene/2 の description と checklist）は変えない
 */
export type SceneAnswer = {
  name: string;
  /** 苦手の場面の一言（日本語）。苦手の場面のときだけ書かせる */
  pitch?: string;
  /** 見本の答えの文（級の数だけ）。つなげたものが description になる */
  sentences: string[];
  checklist: {
    id: string;
    kind: ChecklistKind;
    label: string;
    /** その項目の事実が書いてある文の番号（1 から） */
    sentence: number;
    /** center・detail は、その文から写した言い方。reason・link は別の言い方（無ければ空） */
    accept: string;
    refs: string[];
  }[];
};

/** 文の全部を accept にするときの形（文末の句読点を取り、先頭を小文字にする） */
const wholeSentence = (text: string) => {
  const t = text.trim().replace(/[.!?]+$/, "");
  return t.charAt(0).toLowerCase() + t.slice(1);
};

/** 行動の節（because・so that・, so より前）。center の accept を文から取り直すときに使う */
const actionClause = (text: string) =>
  wholeSentence(text.split(/,?\s+(?:because|so that|so)\b/i)[0]);

/**
 * Claude が書いた形（文の配列と文の番号）を、保存する形（description と accept）に直す。
 * - description は文をつなげたもの
 * - reason・link の accept は、番号の文の全部（Claude が別の言い方を書いていれば " / " で後ろに足す）
 * - center・detail の accept は、Claude が書いた言い方が番号の文にあればそれ、無ければ文から取り直す
 *   （center は行動の節、detail は文の全部）。これで accept は必ず description にある
 * problems は形の決まりの違反: 文の数が級と違う、番号の文が無い、center・detail が同じ文を使っている
 */
export function toSceneSentences(
  gradeId: GradeId,
  answer: SceneAnswer,
): { sentences: SceneSentences; problems: Problem[] } {
  const grade = GRADES[gradeId];
  const texts = answer.sentences.map((t) => t.trim()).filter((t) => t.length);
  const problems: Problem[] = [];
  const add = (code: Problem["code"], message: string) =>
    problems.push({ code, stage: "sentences", message });
  if (texts.length !== grade.sentences) {
    add(
      "sentence_count",
      `sentences が ${texts.length} 文ある。${gradeId} は ${grade.sentences} 文（center と detail の項目 1 つにつき 1 文）`,
    );
  }
  const used = new Map<number, string>();
  const checklist = answer.checklist.map((c) => {
    const text = texts[c.sentence - 1];
    const refs = c.refs.filter((r) => r.length > 0);
    const base = { id: c.id, kind: c.kind, label: c.label, refs };
    if (text === undefined) {
      add(
        "sentence_number",
        `項目 ${c.id} の sentence ${c.sentence} にあたる文が無い（文は 1 から ${texts.length} まで）`,
      );
      return { ...base, accept: c.accept };
    }
    if (c.kind === "reason" || c.kind === "link") {
      const whole = wholeSentence(text);
      const other = c.accept.trim();
      const same = !other || normalizeText(other) === normalizeText(whole);
      return { ...base, accept: same ? whole : `${whole} / ${other}` };
    }
    const before = used.get(c.sentence);
    if (before) {
      add(
        "sentence_shared",
        `${c.kind} の項目 ${c.id} と項目 ${before} が、同じ文 ${c.sentence}「${text}」を使っている。center と detail は 1 文に 1 つ。${c.id} の事実は別の文に書く`,
      );
    } else {
      used.set(c.sentence, c.id);
    }
    const written = c.accept.trim();
    const copied = written.length > 0 && acceptInDescription(written, text);
    const accept = copied
      ? written
      : c.kind === "center"
        ? actionClause(text)
        : wholeSentence(text);
    return { ...base, accept };
  });
  return {
    sentences: {
      name: answer.name,
      description: texts.join(" "),
      checklist,
    },
    problems,
  };
}

// 指示の例は /2 の形で eiken-pre2 の 1 つだけ（例に似た場面ばかりになるのを防ぐ）。
// docs/design/scene-protocol.md の雨のバス停を、実在の部品で組めるよう直したもの
export const EXAMPLE_GRADE: GradeId = "eiken-pre2";
export const EXAMPLE_THEME = "バス停（bus stop）";
export const EXAMPLE_ANSWER: SceneAnswer = {
  name: "雨のバス停",
  sentences: [
    "It is raining at the bus stop.",
    "A girl is holding an umbrella.",
    "A boy is running to the bus stop because it is raining.",
    "A man is reading a book.",
    "The man is sitting on the bench.",
  ],
  checklist: [
    {
      id: "girl_umbrella",
      kind: "center",
      label: "女の子が傘をさしている",
      sentence: 2,
      accept: "a girl is holding an umbrella",
      refs: ["girl"],
    },
    {
      id: "boy_run",
      kind: "center",
      label: "男の子が走っている",
      sentence: 3,
      accept: "a boy is running",
      refs: ["boy"],
    },
    {
      id: "man_read",
      kind: "center",
      label: "男の人が本を読んでいる",
      sentence: 4,
      accept: "a man is reading a book",
      refs: ["man"],
    },
    {
      id: "why_run",
      kind: "reason",
      label: "男の子が走っている理由",
      sentence: 3,
      accept: "",
      refs: ["boy", "rain"],
    },
    {
      id: "rain",
      kind: "detail",
      label: "雨が降っている",
      sentence: 1,
      accept: "it is raining",
      refs: ["rain"],
    },
    {
      id: "man_sit",
      kind: "detail",
      label: "男の人はベンチに座っている",
      sentence: 5,
      accept: "the man is sitting on the bench",
      refs: ["man", "bench"],
    },
  ],
};
/** 例を、保存する形（description と accept）に直したもの */
export const EXAMPLE_SENTENCES: SceneSentences = toSceneSentences(
  EXAMPLE_GRADE,
  EXAMPLE_ANSWER,
).sentences;
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

/** その級の checklist の数の言い方（"3 center, 1 reason, 2 detail"） */
export const checklistCounts = (id: GradeId) =>
  kindsOf(id)
    .map((k) => `${GRADES[id].checklist[k]} ${k}`)
    .join(", ");

/** その級の中心の動作に使える段階（"A1, A2"） */
const levelsUpTo = (id: GradeId) =>
  CEFR_LEVELS.filter((l) => withinLevel(l, GRADES[id].cefr)).join(", ");

/** 級の規則の表（1 回目の指示）。GRADES から作るので、裏取りで数える数と食い違わない */
export const gradeRules = (): string =>
  GRADE_LIST.map(
    (g) => `## ${g.id} (CEFR ${g.cefr})
- People: ${range(g.people.min, g.people.max)} people or animals in the whole scene (an animal counts as one), ${g.people.note}.
- sentences: exactly ${g.sentences} sentences, about ${g.words} words in total: one sentence for each center item (${g.checklist.center}) and one for each detail item (${g.checklist.detail}).${
      g.checklist.reason + g.checklist.link > 0
        ? ` The ${g.checklist.link > 0 ? "reason and the link are" : "reason is"} not ${g.checklist.link > 0 ? "sentences" : "a sentence"} of ${g.checklist.link > 0 ? "their" : "its"} own: ${g.checklist.link > 0 ? "each is" : "it is"} added to the sentence of a center item${g.checklist.link > 0 ? " (two different center sentences)" : ""}.`
        : ""
    }
- checklist: exactly ${checklistSize(g.id)} items: ${checklistCounts(g.id)}.
- Verbs of the center items: only verbs marked ${levelsUpTo(g.id)} in the list of actions.
- Grammar you may use: ${grammarUpTo(g.id).join("; ")}.`,
  ).join("\n\n");

/** 級ごとに、動作の語彙に出てくるが中心には使えない動詞を名指しする（1 回目の指示） */
export const verbLimits = (parts: Part[]): string =>
  GRADE_LIST.map((g) => {
    const verbs = verbsAbove(g.cefr, parts);
    return `- ${g.id}: ${verbs.length ? verbs.join(", ") : "(none)"}`;
  }).join("\n");

/** 1 回目の指示。部品の一覧は渡さず、今の部品で描ける人・動作・物の語彙だけを渡す */
export const buildSentenceSystem = (
  parts: Part[],
) => `You write the English side of small 3D scenes for an English speaking game for Japanese learners. The game follows the grades of the Eiken speaking test.
Players look at a 3D scene and describe it aloud in English. Their answer is scored with a checklist: which items they said, and whether what they said is true in the scene.
You get a grade and a theme. If no theme is given, choose one from the theme list. Write the name, the model answer (as a list of sentences) and the checklist of one scene.
You do not choose 3D parts. A second step builds the scene from your text with a fixed set of parts, so write only what those parts can show (see "What the scene can show").

# Grades
${gradeRules()}

Grammar and verbs of a lower grade may be used in a higher grade, but never use grammar above the grade. Keep the other words at the CEFR level of the grade too; most nouns come from the list of things below.

# sentences (the model answer)
- Write what a good player of that grade would say about the scene, as a list of plain sentences. Joined together they are the description that the player sees.
- Plan the sentences from the checklist: every center item has its own sentence, and every detail item has its own sentence. No sentence carries two of them. That gives exactly the number of sentences of the grade.
- The reason is written into the sentence of the center item it explains: "<noun> is <action> because <visible cause>." The link (eiken-2) is written into the sentence of another center item: "<visible cause>, so <noun> is <action> to <purpose>." or "<noun> is <action> so that <result>."
- Start every sentence with a noun (A girl, The boy, The dog), with "There is / There are", or, for the weather only, with "It is". Never start a sentence with He, She, They or It for a person, an animal or a thing.
- Every sentence must be visible in a still 3D scene with simple motion. Do not write names, feelings, thoughts, speech, sounds, or anything that happened before and left nothing to see.
- One person, one action: every person and animal does exactly one action from the list of actions below. Never give the same person a second action (not "a woman is cooking" and later "the woman is wiping the table"). A second fact about the same person can only be where they are (a detail); it is never another action ("she is drinking from a cup" about a woman who is sitting is a second action).
- Only a person listed for an action can do it. Read the last column of the action's line: "drink from a cup | ... | woman, man" means only a woman or a man can drink; a girl or a boy cannot. "have fallen down | ... | woman" means only a woman can have fallen down. A program checks the subject of every center item against this column.
- The posture belongs to the action: actions marked "(sitting)" and the action "sit" are seated, all the others are done standing. Do not write that a person who drinks, reads (standing) or waits is sitting.
- Use only people, actions and things from the lists below. Do not write about a thing that is not in the list of things.
- A thing that a person holds as part of the action (the umbrella of the girl who shares it, the basket of a person who waits with it, the book, the box, the cup) is part of that person. Do not write it as a second, separate thing.
- Nothing can hang on a wall. The background walls already show a blackboard, windows, shelves or a menu; do not write about a clock, a picture or anything else "on the wall".
- When you say that someone is on the sidewalk, on the road or on the grass, the second step must be able to put them exactly there; in a street scene say clearly who is on the road and who is on the sidewalk, and do not say it for both.
- Rain only falls in outdoor scenes (a park, a street, a bus stop, a playground, a beach). Indoors (a store, a cafe, a kitchen, a classroom, a room, a library) and on a station platform there is no rain: do not write "it is raining outside" and do not use rain as a reason there.
- Count the people and animals: the whole scene has exactly the number of the grade, and all of them are in the description.
- Write the sentences before the checklist.

# checklist
- Always write the whole checklist, with exactly the number of items of each kind for the grade. Never return an empty or shorter checklist. A program counts the items.
- center: who is doing what. Each person or animal is the subject of at most one center item.
- The verb of a center accept must be one of the verbs on the line of that person's action, and its level must be within the grade: eiken-3 uses only verbs marked A1, eiken-pre2 verbs marked A1 or A2, eiken-2 verbs marked A1, A2 or B1. A program checks this against the 3D part. When the usual verb of an action is above the grade, say the action with another verb of the same line (in eiken-3 the boy of "throw a ball" "is playing with a ball", a person who stands "is waiting" or "is looking at" something, the woman of "wipe a table" "is cleaning the table"), or choose another action. Verbs from the list that a center accept must not use:
${verbLimits(parts)}
- detail: a position, a number, a thing or the weather. It must be a fact that no other item already says: never repeat the accept of a center item as a detail, and never make a detail from a second action of a person.
- reason (eiken-pre2 and eiken-2): why a person does their action. The cause must be visible in the scene as a thing, the weather, or what another person or animal is doing. Choose it from "Visible events that can be a reason" below, or build another one from the lists in the same way. A feeling, a wish or a plan is not a cause (she wants it, he is in a hurry, he is late, she wants to go home), and neither is a thing that is not in the list of things. 
- link (eiken-2 only): one sentence with two steps: because of a visible cause, a person does the action, and the action has a purpose or result that the player can see coming (the dog runs to get the ball). Not a plan you invent, and not two facts that only stand next to each other.
- Do not make every scene about the same cause. Rain and a person who has fallen down are only two of many causes; prefer a cause that belongs to the theme, and when you can, let the cause be a thing or another person's action rather than a repeat of a center item.
- The cause must make the action happen: if the cause were not there, the person would not do it. Two things that are only in the same place are not a reason.
  - Good: "A woman is cleaning the table because juice is spilled on it." (the spilled juice makes her clean)
  - Bad: "A woman is sitting on the bench because a man is reading a book next to her." (his reading does not make her sit)
- What a person does in the cause ("because the woman is asking a question") is also an action of that person: it must be the same action as that person's center item, and only things the scene can show.
- Bad reasons and links (never write these):
  - "A girl is reaching for the ball because she wants it." (a wish is not visible)
  - "A man is running because a girl is standing near the door." (not a cause)
  - "The man is hurrying so that he can leave." (no visible cause, and the purpose is invented)
  - "A bag is on the ground so the boy is running past it." (the bag does not make him run, and running past it has no purpose)
  - "A man is waiting behind her because he has a basket." / "A woman is paying because a man is waiting behind her." (having a basket or someone waiting does not cause the action)
- What a person holds, and the second action joined by "and" ("is sitting on a sofa and reading"), must also be shown by that person's action line: a girl who only sits cannot also read, and a girl who stands has no basket.
- id: short snake_case, unique. label: short Japanese shown to the player after the round.
- sentence: the number of the sentence that says this item (1 is the first sentence). Each center and each detail has a different number. The reason has the number of the center sentence that contains its "because"; the link has the number of the center sentence that contains its "so" or "so that". The reason and the link have different numbers.
- accept for a center or detail item: the English wording that counts as "said", copied letter for letter from the sentence with that number (lower case and no final period are fine). One item, one fact, with a subject and a verb ("a man is reading a book", "there is a ball under the bench"); never a piece of a sentence ("to the train", "waiting with a basket").
- For a center item, accept is who is doing what: the part of its sentence before "because" or "so", without the place and without a second fact joined by "and" ("a woman is waiting", not "a woman is waiting with a shopping basket in the store"). Put the place into accept only when the item is a detail about the place.
- accept for a reason or link item: leave it empty (""). The program uses the whole sentence with that number as accept, so that sentence must start with a noun and say the action and its cause. Only if another wording of the same reason is also correct, write that wording into accept.
- The action before "because" or "so" is the same action as in that person's center item, never a new one.
- refs: the people and things the item is about, as short lower-case English names (man, bench, rain; letters, digits and _ only). Put the person or animal who acts first. Use one name for one person or thing in the whole checklist (two boys: boy and tall_boy). The second step puts one part in the scene for every name, so name only things that stand in the scene as their own part: people, animals, furniture, things, rain. Do not name the place itself (park), a body part, or a thing that a person holds as part of the action (the book of a person reading, the box of a person carrying): name the person instead.
- reason and link items need two or more refs: the person who acts, and the cause (a thing or another person).

# What the scene can show
People and animals, one line per action: action | verbs that can say it, each marked with its CEFR-J level (A1, A2, B1; B2 is above every grade) | who can do it
${actionVocabulary(parts)}

Things and places, as "English word (Japanese name of the part)":
${thingVocabulary(parts)}

Visible events that can be a reason, as "visible cause -> action (-> purpose or result)". They are material, not a fixed list: pick one that fits the theme, change who does it within the "who can do it" column, or build another visible cause from the lists above. Do not always take the same ones.
${reasonSeeds(parts)}

Things can also fall, move in a straight line, spin or sway. A ball can fly from a person who throws it to a person who catches it. Faces and feelings are not visible.

# Themes (choose one when the request has no theme)
${THEMES.map((t) => `- ${t}`).join("\n")}
For eiken-pre2 and eiken-2, do not choose a theme where you cannot place a visible cause. If the given theme cannot be made with these parts, write the closest everyday scene you can.

# Example
This example only shows the form of the answer (sentence 3 carries both the center item boy_run and the reason why_run). Do not reuse its scene, its sentences, its people or its cause (rain) in your answer; even for a bus stop, write a different scene.
Request: 級: ${EXAMPLE_GRADE} / テーマ: ${EXAMPLE_THEME}
${JSON.stringify(EXAMPLE_ANSWER)}`;

const isLivingPart = (p: Part) =>
  p.category === "person" || p.category === "animal";

const describePartV2 = (p: Part) => {
  const fields = [
    p.id,
    p.label,
    p.category,
    `words: ${p.words.map((w) => w.word).join(", ")}`,
    p.pose ? `pose: ${p.pose}` : null,
    isLivingPart(p)
      ? `says: ${poseVerbsOf(p)
          .map((v) => v.verb)
          .join(", ")}`
      : null,
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
- "holds" names what a part already has in its hands (the umbrella of person_umbrella_girl_a, the basket of person_basket_woman_a, the book, the box, the cup). That thing is part of the person: never add it as a separate item, not on the ground and not in the air. A program checks this.
- "uses" lists parts that must also be in the scene for that action; add them (a person who cooks needs kitchen_counter and a pan on its spot "stove").
- A person with a sitting pose (anchors.hip) must sit on something: add a chair, a bench or a sofa and use sit_on.
- Furniture that someone works at (kitchen_counter, checkout_counter, bookshelf, ticket_machine) goes with relation "ground" and zone "left"; the program turns it so that the person is seen from the side.
- A background wall can be a target: a person writing on wall_blackboard uses relate with link "hand".
- When it rains, add the part rain with relation "ground" (it covers the whole scene). Use rain only when the ground is an outdoor ground; never put rain in a scene whose ground is a floor_ part. A cafe uses wall_cafe as its background wall.
- The words of a part say who it is (man, woman, boy, girl, old man). Keep the person of the text: never use a man for a woman.`;

/** 2 回目の「items の書き方」。部品の一覧を出す道と、ID の規約で引く道で同じ文を使う */
const ITEM_RULES = `# Writing the items
- "Keys" lists the names used in the refs of the checklist. Use every one of them, exactly once, as the key of the item that shows that person or thing. A program checks this.
- Give the other items (the ground, the background wall, chairs to sit on, a few background things) other short lower-case keys.
- For every person and animal, choose the part whose words say the same person and whose pose shows the action of the description.
- For each center item, read the verb of its accept and give the first person or animal of its refs a part whose "says" lists that verb (accept "a woman is drinking" needs a woman part that says drink, not one that says wipe, and not one that only says sit or stand). A program checks this.
- Choose the part whose words name the same person as the noun in the sentences: a girl is a girl part, never a woman or man part (person_point_woman_a and person_phone_adult_a are adults); a boy is a boy part; a man is a man or old man part. A program checks this.
- Keep who the person is. If that person has no part that says the verb, still use a part of that person (the closest pose); never change a woman into a man or give the action to someone else. The checker then sends the text back to be rewritten.
- Nothing can hang on a wall: do not use clock, and never put a wall thing on a table or on the floor instead. Indoors, the background wall already has windows; use window or door only in a back zone right in front of the background wall, never in the middle of the room. A program checks this.
- Keep everything the checklist names inside the picture: the camera looks down from the front, so a thing high above a tree in a back zone (a balloon "above" a tree) is cut off at the top. Put such a tree in a front or center zone.
- People must not hide each other: the camera looks from the front and above, so a person right behind another person, or behind a table, a shelf or a counter, is hidden. Do not put two people at the same spot; at a table, seat at most two people, and let a standing person (a waiter, someone setting plates) stand at the side, not in front of a seated person.
- When an accept says that someone is on the sidewalk, on the grass or on the road, place them on that ground part. road_patch lies on top of the sidewalk and is 5.5 m deep, so with the road in zone "back" it also covers the center zones: people on the sidewalk go in a front zone, people on the road in center or back. A program checks this with the computed positions.
- Show exactly the people and animals that the description mentions: no one more, no one less, one item for each. Everything the description mentions must be in the scene.
- The cause of a reason or link item must be visible as its own item (rain, spilled_juice, a person who has fallen down, a thrown ball).
- At most 40 items.`;

/** 2 回目の指示。場面・関係・向き・動きの決まりは今の生成（SCENE_RULES）と同じ文を使う */
export const buildItemsSystem = (
  parts: Part[],
) => `You build small 3D scenes for an English speaking game for Japanese learners.
Players look at the scene and describe it in English. Their answer is scored with the checklist of the scene.
You get the English side of one scene (name, description and checklist), its grade, and the list of keys. Build the one scene that shows exactly this description, using only the parts listed below. You do not write coordinates: you choose parts and how they relate to each other, and the program computes the positions.

${SCENE_RULES}

${PEOPLE_RULES}

${ITEM_RULES}

# Parts (id | label | category | words | pose | says: verbs that can say the pose | holds | uses | size in meters | anchors)
${parts.map(describePartV2).join("\n")}

# Example
Request:
${itemsMessage({ grade: EXAMPLE_GRADE }, EXAMPLE_SENTENCES)}
Answer:
${JSON.stringify({ items: EXAMPLE_ITEMS })}`;

/** 例の items を、ID の規約で書いた形にする（人は person_<動作>_<誰>_a） */
const conventionExample = (parts: Part[]) => {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return EXAMPLE_ITEMS.map((i) => {
    const part = byId.get(i.part);
    return part && (part.category === "person" || part.category === "animal")
      ? { ...i, part: livingId(part) }
      : i;
  });
};

/**
 * 2 回目の指示（ID の規約で引く道）。部品の一覧を出さず、ID の規約と、人と動物の動作の表、
 * もう部品のある物の名詞だけを渡す。作った部品が増えても長くならない。parts は同梱の部品（表と名詞を作る）
 */
export const buildConventionItemsSystem = (
  parts: Part[],
) => `You build small 3D scenes for an English speaking game for Japanese learners.
Players look at the scene and describe it in English. Their answer is scored with the checklist of the scene.
You get the English side of one scene (name, description and checklist), its grade, and the list of keys. Build the one scene that shows exactly this description. There is no list of parts: you write the id of each part by the rules in "Part ids", and the program finds the part (or makes a new one from your order). You do not write coordinates: you choose parts and how they relate to each other, and the program computes the positions.

${SCENE_RULES}

${PEOPLE_RULES}

${ITEM_RULES}

# Part ids
- Grounds and background walls: only the ids named in the rules above (grass_patch, sidewalk_stone, floor_wood, wall_window, wall_cafe and the others). They are never made new.
- People: person_<action>_<who>_a. Animals: animal_<action>_<kind>_a. Take <action> and <who> from one line of the table below (the line shows which who can do the action). The program uses the part with that who and that action; if there is none, it uses the closest one, and the checking program may send the scene back.
- Things, furniture, food, plants and vehicles: the English noun in lower case (bench, ball, cup, lamp), or noun_detail for a kind of it (table_small, apple_red, teapot_white). Lower-case letters and _ only, at most three words, at most 32 letters. Use the same id for the same kind of thing.
- These nouns already have a part; write the noun (or the id named in the rules above) and no order: ${thingNouns(parts)}.
- For any other thing, also write an order in newParts with the same id: category (thing, furniture, food, plant or vehicle), label (short Japanese), words (English nouns), size in meters (width, height, depth of the real thing), description (one English sentence: the shape and the colors), and top (true if other things can be put on it). The program makes a simple 3D part from the order. At most ${MAX_NEW_PARTS} new things in one scene; prefer things that already have a part.
- Never order people, animals, body parts, grounds, walls, rooms or buildings, liquids that are not in a container, weapons, violent or sexual things, brand names or names of real people.
- When a part has "holds" or "uses" in the table, follow the same rules as above (holds is part of the person; add the uses parts).

# People and animals (id pattern | action | says: verbs that can say it | who can do it | holds | uses | sitting)
${livingTable(parts)}

# Example
Request:
${itemsMessage({ grade: EXAMPLE_GRADE }, EXAMPLE_SENTENCES)}
Answer:
${JSON.stringify({ items: conventionExample(parts), newParts: [] })}`;

/** 1 回目に書かせる形。kind はその級に出てくる種類だけにする */
export const sentenceSchema = (grade: GradeId, weak = false) => ({
  type: "object",
  properties: {
    name: { type: "string" },
    ...(weak ? { pitch: { type: "string" } } : {}),
    // description は文の配列で先に書かせる（つなげるのはコード）
    sentences: { type: "array", minItems: 1, items: { type: "string" } },
    checklist: {
      type: "array",
      // structured outputs が受け付ける minItems は 0 と 1 だけなので、級の数までは指定できない
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: kindsOf(grade) },
          label: { type: "string" },
          sentence: {
            type: "integer",
            description: "the number of the sentence that says this item",
          },
          accept: { type: "string" },
          refs: { type: "array", minItems: 1, items: { type: "string" } },
        },
        required: ["id", "kind", "label", "sentence", "accept", "refs"],
        additionalProperties: false,
      },
    },
  },
  required: weak
    ? ["name", "pitch", "sentences", "checklist"]
    : ["name", "sentences", "checklist"],
  additionalProperties: false,
});

/** 2 回目に書かせる形。items は今の生成（planSchema）と同じ。部品の ID は候補だけの enum */
export const itemsOnlySchema = (parts: Part[]) => ({
  type: "object",
  properties: { items: itemsSchema(parts) },
  required: ["items"],
  additionalProperties: false,
});

/** 2 回目（ID の規約で引く道）に書かせる形。part は規約の形の文字列、newParts は作る物の注文 */
export const conventionItemsSchema = () => {
  const items = itemsSchema([]);
  return {
    type: "object",
    properties: {
      items: {
        ...items,
        items: {
          ...items.items,
          properties: {
            ...items.items.properties,
            part: {
              type: "string",
              description: "a part id written by the rules in Part ids",
            },
          },
        },
      },
      newParts: { type: "array", items: orderJsonSchema },
    },
    required: ["items", "newParts"],
    additionalProperties: false,
  };
};

const Answer = z.object({
  name: z.string().trim().min(1),
  pitch: z.string().trim().optional(),
  sentences: z.array(z.string()).min(1),
  // 空でも受け取り、裏取り（数が合わない）で落とす。理由を付けて作り直せるようにするため
  checklist: z.array(
    z.object({
      id: z.string().trim().min(1),
      kind: z.enum(CHECKLIST_KINDS),
      label: z.string().trim().min(1),
      sentence: z.number().int(),
      accept: z.string(),
      refs: z.array(z.string().trim()),
    }),
  ),
});
const ItemsOnly = z.object({ items: PlanItems });
const ConventionItems = z.object({
  items: PlanItems,
  newParts: z.array(OrderSchema).max(12).default([]),
});

/**
 * 作り直しのときに渡すもの。problems は裏取りで落ちた理由（どの項目かを id で名指しした文）、
 * previous は落ちた前の答え。前の答えを見せないと、理由がどこを指すのかが Claude に分からない
 */
export type Retry = { problems: string[]; previous?: unknown };

// 落ちた前の答えと理由を、作り直しの指示に足す。直す所だけを直させる
const feedbackText = (retry: Retry | undefined) =>
  retry?.problems.length
    ? `\n\nYour last answer was rejected by the checking program.${
        retry.previous === undefined
          ? ""
          : `\nYour last answer:\n${JSON.stringify(retry.previous)}`
      }\nProblems (each one names the id of the item or the number of the sentence to fix):\n${retry.problems
        .map((f) => `- ${f}`)
        .join(
          "\n",
        )}\nWrite the whole answer again. Change what the problems name and whatever must change with it; keep the rest as it was.`
    : "";

// すでに作った場面の要約を渡し、違う場面を書かせる
const avoidText = (avoid: string[] | undefined) =>
  avoid?.length
    ? `\n\nScenes already made for this grade. Write a scene that is clearly different from all of them: other main actions, other people, and a cause that none of them uses.\n${avoid.map((a) => `- ${a}`).join("\n")}`
    : "";

/** 1 回目の user の文 */
export const sentenceMessage = (input: GenerateV2Input, feedback?: Retry) =>
  `級: ${input.grade}\nテーマ: ${input.theme ?? "一覧から選ぶ"}\nchecklist: ${checklistCounts(input.grade)}（計 ${checklistSize(input.grade)} 個）${input.weak ? weakText(input.weak) : ""}${avoidText(input.avoid)}${feedbackText(feedback)}`;

/** 2 回目の user の文。1 回目の出力の全部と、コードが refs から集めた呼び名の一覧 */
export function itemsMessage(
  input: Pick<GenerateV2Input, "grade">,
  sentences: SceneSentences,
  feedback?: Retry,
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
  /** Claude を 1 回呼ぶたびの usage（失敗した生成の費用も数えるため） */
  onUsage?: (usage: Anthropic.Usage) => void;
  /**
   * 2 回目の部品の引き方。渡すと ID の規約で引く道（部品の一覧を出さず、無い物は workshop で作る）。
   * 渡さなければ今の道（部品の一覧を出す）
   */
  lookup?: PartLookup;
};

/**
 * ID の規約で引く道で、同梱に無い部品を引く・作るもの（backend/src/parts/workshop.ts の lookupPart・ensureParts。
 * テストでは偽物）。maxNew は 1 場面で同梱に無い部品を使う数の上限
 */
export type Workshop = {
  lookup: (id: string) => Promise<Part | null>;
  ensure: (
    orders: PartOrder[],
    opts: { signal?: AbortSignal; maxNew: number; timeoutMs?: number },
  ) => Promise<{
    parts: Part[];
    failed: { id: string; reason: string }[];
    /** 部品ごとの時間と費用（作ったときだけ。測定とログ用） */
    logs?: { id: string; made: boolean; ms: number; usd: number }[];
  }>;
};
/**
 * workshop を渡したときだけ、前に作った部品（R2）を引き、足りない部品を作る（苦手の場面の道だけ）。
 * 渡さなければ同梱の部品だけを引き、無い物は作らずに裏取りの問題にする（部屋のスタート・作り置きの生成）
 */
export type PartLookup = { workshop?: Workshop; maxNew?: number };

/** 部品を作れなかった（作り直しても）。場面の生成を失敗にする（作り直しの理由にはしない） */
export class PartBuildError extends SceneGenerationError {
  constructor(
    readonly failed: { id: string; reason: string }[],
    /** 作れた部品も含めた、部品ごとの時間と費用 */
    readonly logs: {
      id: string;
      made: boolean;
      ms: number;
      usd: number;
    }[] = [],
  ) {
    super(
      "invalid",
      `部品を作れなかった: ${failed.map((f) => `${f.id}（${f.reason}）`).join("、")}`,
    );
  }
}

/** 呼び方の上書きに、全体の締め切り（Date.now() の ms）を足したもの。締め切りが近ければ Claude を呼ばない */
export type GenerateV2Options = GenerateOptions & { deadline?: number };

/** 締め切りまでに、Claude をもう 1 回呼ぶのに要る残り時間（ms） */
const MIN_CALL_MS = 12_000;
/** 部品を作る Claude の 1 回の上限（ms）。実測は 1 個 3.6〜16 秒 */
const PART_CALL_TIMEOUT_MS = 35_000;

type Call = {
  create: CreateMessage;
  model: string;
  effort: Effort;
  options: GenerateV2Options;
};

const prepare = (
  env: GenerateEnv,
  deps: GenerateV2Deps,
  options: GenerateV2Options,
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
/** 測定で原因を調べるために残す、生の本文の長さ */
const RAW_LENGTH = 500;

/** 応答が JSON でない・形が違う。raw は Claude の生の本文の先頭 */
export class SceneResponseError extends SceneGenerationError {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super("invalid", message);
  }
}

const callJson = async <T>(
  call: Call,
  label: string,
  system: string,
  schema: Record<string, unknown>,
  user: string,
  parse: (json: unknown) => T | undefined,
): Promise<{ value: T; usage: Anthropic.Usage }> => {
  const maxAttempts = call.options.maxAttempts ?? 2;
  const signal = call.options.signal;
  const deadline = call.options.deadline;
  let last: SceneGenerationError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let timeout = call.options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
    if (deadline !== undefined) {
      const left = deadline - Date.now();
      if (left < MIN_CALL_MS) {
        last = new SceneGenerationError(
          "unavailable",
          "時間切れ（締め切りまでに Claude を呼べない）",
        );
        break;
      }
      timeout = Math.min(timeout, left);
    }
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
      const raw = text.text.slice(0, RAW_LENGTH);
      let json: unknown;
      try {
        json = JSON.parse(text.text);
      } catch {
        throw new SceneResponseError("Claude の応答が JSON でない", raw);
      }
      const value = parse(json);
      if (value === undefined) {
        throw new SceneResponseError("Claude の応答の形が違う", raw);
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

/**
 * 1 回目: 級（とテーマ）から英文の部分を書かせる。feedback は作り直しのときの、前の答えと落ちた理由。
 * answer は Claude が書いたままの形、sentences は保存する形に直したもの、problems は形の決まりの違反
 */
export async function generateSentences(
  env: GenerateEnv,
  parts: Part[],
  input: GenerateV2Input,
  deps: GenerateV2Deps = {},
  options: GenerateOptions = {},
  feedback?: Retry,
): Promise<{
  sentences: SceneSentences;
  problems: Problem[];
  answer: SceneAnswer;
  usage: Anthropic.Usage;
}> {
  const result = await callJson(
    prepare(env, deps, options),
    "1 回目・英文",
    buildSentenceSystem(parts),
    sentenceSchema(input.grade, input.weak !== undefined),
    sentenceMessage(input, feedback),
    (json) => {
      const parsed = Answer.safeParse(json);
      return parsed.success ? (parsed.data as SceneAnswer) : undefined;
    },
  );
  return {
    ...toSceneSentences(input.grade, result.value),
    answer: result.value,
    usage: result.usage,
  };
}

/** 2 回目: 英文の部分と候補の部品から、部品と関係（items）を書かせる */
export async function generateItems(
  env: GenerateEnv,
  candidateParts: Part[],
  input: Pick<GenerateV2Input, "grade">,
  sentences: SceneSentences,
  deps: GenerateV2Deps = {},
  options: GenerateOptions = {},
  feedback?: Retry,
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

/**
 * 2 回目（ID の規約で引く道）: 英文の部分から、規約どおりの ID で部品と関係（items）と、作る物の注文（newParts）を書かせる。
 * parts は同梱の部品（指示の人と動物の表・物の名詞を作る。一覧そのものは出さない）
 */
export async function generateItemsByConvention(
  env: GenerateEnv,
  parts: Part[],
  input: Pick<GenerateV2Input, "grade">,
  sentences: SceneSentences,
  deps: GenerateV2Deps = {},
  options: GenerateV2Options = {},
  feedback?: Retry,
): Promise<{ items: PlanItem[]; orders: PartOrder[]; usage: Anthropic.Usage }> {
  const result = await callJson(
    prepare(env, deps, options),
    "2 回目・部品（規約）",
    buildConventionItemsSystem(parts),
    conventionItemsSchema(),
    itemsMessage(input, sentences, feedback),
    (json) => {
      const parsed = ConventionItems.safeParse(json);
      return parsed.success
        ? {
            items: parsed.data.items as PlanItem[],
            orders: parsed.data.newParts,
          }
        : undefined;
    },
  );
  return { ...result.value, usage: result.usage };
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
    problems: [...first.problems, ...verifyScene(input.grade, plan, parts)],
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

/** 作り直しても裏取りを通らなかった。problems は最後の回で落ちた理由、rejected は回ごとの理由 */
export class SceneVerificationError extends SceneGenerationError {
  readonly problems: Problem[];
  constructor(readonly rejected: Problem[][]) {
    const problems = rejected[rejected.length - 1] ?? [];
    super(
      "invalid",
      `裏取りを通らなかった: ${problems.map((p) => p.message).join(" / ")}`,
    );
    this.problems = problems;
  }
}

/**
 * 形が違う・途中で止まった応答（invalid）を、作り直しの理由にする。
 * 断られた・API の失敗はそのまま投げる（作り直しても直らないので）
 */
const invalidResponse = (e: unknown, stage: Problem["stage"]): Problem => {
  if (!(e instanceof SceneGenerationError) || e.kind !== "invalid") throw e;
  return {
    code: "invalid_response",
    stage,
    message: `前の応答は使えなかった（${e.message}）。決まった形で、全部の欄を最後まで書く`,
  };
};

export type VerifiedSceneResult = {
  plan: ScenePlanV2;
  model: string;
  /** 作り直した回数（0〜2） */
  remakes: number;
  /** 回ごとに落ちた理由（通った回は入らない） */
  rejected: Problem[][];
  usage: Anthropic.Usage[];
  /** 苦手の場面の一言（1 回目が書いたもの。苦手の場面でなければ undefined） */
  pitch?: string;
  /**
   * ID の規約で引く道で使った、同梱に無い部品（前に作った・その場で作った）のメタデータ。
   * 座標の計算に同梱の部品と合わせて渡し、配置では id@版 にする。部品の一覧を出す道では空
   */
  extraParts: Part[];
  /** その場で作った部品の ID */
  madeParts: string[];
  /** 部品ごとの時間と費用（部品を作る口のログ。作ったときだけ費用が入る） */
  partLogs: { id: string; made: boolean; ms: number; usd: number }[];
};

type ItemsOutcome = {
  items?: PlanItem[];
  problems: Problem[];
  /** 作り直しのときに見せる、前の 2 回目の答え */
  previous?: unknown;
  extraParts: Part[];
  madeParts: string[];
  /** 部品ごとの時間と費用（部品を作る口のログ） */
  partLogs?: { id: string; made: boolean; ms: number; usd: number }[];
};

/** 2 回目（部品の一覧を出す道）を 1 回呼び、裏取りする */
const listItems = async (
  env: GenerateEnv,
  parts: Part[],
  found: Part[],
  input: GenerateV2Input,
  sentences: SceneSentences,
  deps: GenerateV2Deps,
  options: GenerateV2Options,
  feedback: Retry | undefined,
  usage: Anthropic.Usage[],
): Promise<ItemsOutcome> => {
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
  deps.onUsage?.(second.usage);
  const items = second.items;
  let problems = verifyItems(input.grade, sentences, items, parts);
  if (problems.length === 0) {
    problems = verifyPlaces(input.grade, { ...sentences, items }, parts);
  }
  return {
    items,
    problems,
    previous: { items },
    extraParts: [],
    madeParts: [],
  };
};

/**
 * 2 回目（ID の規約で引く道）を 1 回呼び、部品を引いて裏取りし、通ったら足りない部品を作る。
 * 裏取りは作る前の仮のメタデータ（注文の大きさ）で行い、作ったあと本物の大きさで場所だけ確かめ直す
 *（落ちた場面のために部品を作らない）。作れなかった部品は 1 回だけ作り直し、だめなら PartBuildError を投げる
 */
const conventionItems = async (
  env: GenerateEnv,
  parts: Part[],
  lookup: PartLookup,
  input: GenerateV2Input,
  sentences: SceneSentences,
  deps: GenerateV2Deps,
  options: GenerateV2Options,
  feedback: Retry | undefined,
  usage: Anthropic.Usage[],
): Promise<ItemsOutcome> => {
  const maxNew = lookup.maxNew ?? MAX_NEW_PARTS;
  const second = await generateItemsByConvention(
    env,
    parts,
    input,
    sentences,
    deps,
    options,
    feedback,
  );
  usage.push(second.usage);
  deps.onUsage?.(second.usage);
  const previous = { items: second.items, newParts: second.orders };
  const resolved = await resolveParts(
    second.items,
    second.orders,
    parts,
    lookup.workshop?.lookup ?? (async () => null),
    maxNew,
    lookup.workshop !== undefined,
  );
  if (resolved.mapped.length > 0) {
    console.log(
      JSON.stringify({ event: "scene_parts_mapped", mapped: resolved.mapped }),
    );
  }
  const none = { extraParts: [], madeParts: [] };
  if (resolved.problems.length > 0) {
    return { problems: resolved.problems, previous, ...none };
  }
  const items = resolved.items;
  const provisional = [
    ...parts,
    ...resolved.found,
    ...resolved.orders.map(provisionalPart),
  ];
  let problems = verifyItems(input.grade, sentences, items, provisional);
  if (problems.length === 0) {
    problems = verifyPlaces(input.grade, { ...sentences, items }, provisional);
  }
  if (problems.length > 0) return { items, problems, previous, ...none };

  // 作り直し（検査に落ちたら 1 回だけ書き直す）は部品を作る口の中で行う。締め切りまでの残りを 1 回の上限にする
  const made: Part[] = [];
  let partLogs: ItemsOutcome["partLogs"] = [];
  if (resolved.orders.length > 0 && lookup.workshop) {
    // 部品 1 個は Claude を最悪 2 回呼ぶので、1 回の上限は残りの半分（35 秒まで）。締め切りでは signal で止まる
    const left =
      options.deadline === undefined
        ? undefined
        : Math.min(
            PART_CALL_TIMEOUT_MS,
            Math.max(5_000, (options.deadline - Date.now()) / 2),
          );
    const result = await lookup.workshop.ensure(resolved.orders, {
      signal: options.signal,
      maxNew,
      ...(left !== undefined ? { timeoutMs: left } : {}),
    });
    made.push(...result.parts);
    partLogs = result.logs ?? [];
    const got = new Set(made.map((p) => p.id));
    const failed = resolved.orders
      .filter((o) => !got.has(o.id))
      .map((o) => ({
        id: o.id,
        reason:
          result.failed.find((f) => f.id === o.id)?.reason ?? "作られなかった",
      }));
    if (failed.length > 0) throw new PartBuildError(failed, partLogs);
  }

  const extraParts = [...resolved.found, ...made];
  problems = verifyPlaces(input.grade, { ...sentences, items }, [
    ...parts,
    ...extraParts,
  ]);
  return {
    items,
    problems,
    previous,
    extraParts,
    madeParts: made.map((p) => p.id),
    partLogs,
  };
};

/**
 * 作り置き・苦手の場面を作る道。裏取りで落ちたら、落ちた理由を指示に足して maxRemakes 回（既定 2）まで作り直す。
 * 英文の部分で落ちたら 1 回目から、部品だけで落ちたら同じ英文のまま 2 回目だけを作り直す
 *（同じ英文で部品が 2 回落ちたら、英文が部品で描けないとみて 1 回目から）。
 * 英文の部分で落ちたときは 2 回目を呼ばない（部品を選ぶ前に分かるので）。
 * 形が違う・途中で止まった応答（各段の中で 1 回やり直した後も）も、同じように作り直す。
 * deps.lookup を渡すと、2 回目は ID の規約で引き、足りない部品を作る（作れなければ PartBuildError で、作り直さない）。
 * 通らなければ SceneVerificationError を投げる
 */
export async function generateVerifiedScene(
  env: GenerateEnv,
  parts: Part[],
  input: GenerateV2Input,
  deps: GenerateV2Deps = {},
  options: GenerateV2Options & { maxRemakes?: number } = {},
): Promise<VerifiedSceneResult> {
  const { maxRemakes = MAX_REMAKES, ...callOptions } = options;
  const find = deps.candidates ?? candidates;
  const usage: Anthropic.Usage[] = [];
  const rejected: Problem[][] = [];
  let sentences: SceneSentences | undefined;
  let found: Part[] = parts;
  let feedback: Retry | undefined;
  let itemsRejected = 0;
  /** 1 回目の前の答え（Claude が書いたままの形）。作り直しのときに見せる */
  let lastAnswer: SceneAnswer | undefined;
  for (let round = 0; round <= maxRemakes; round++) {
    if (!sentences) {
      let written: SceneSentences | undefined;
      let problems: Problem[];
      try {
        const first = await generateSentences(
          env,
          parts,
          input,
          deps,
          callOptions,
          feedback,
        );
        usage.push(first.usage);
        deps.onUsage?.(first.usage);
        written = first.sentences;
        lastAnswer = first.answer;
        problems = [
          ...first.problems,
          ...verifySentences(input.grade, written, parts),
        ];
      } catch (e) {
        problems = [invalidResponse(e, "sentences")];
        lastAnswer = undefined;
      }
      if (problems.length > 0 || !written) {
        rejected.push(problems);
        feedback = {
          problems: problems.map((p) => p.message),
          previous: lastAnswer,
        };
        continue;
      }
      sentences = written;
      if (!deps.lookup) found = await find(sentences.description, parts);
      feedback = undefined;
    }
    let outcome: ItemsOutcome;
    try {
      outcome = deps.lookup
        ? await conventionItems(
            env,
            parts,
            deps.lookup,
            input,
            sentences,
            deps,
            callOptions,
            feedback,
            usage,
          )
        : await listItems(
            env,
            parts,
            found,
            input,
            sentences,
            deps,
            callOptions,
            feedback,
            usage,
          );
    } catch (e) {
      if (e instanceof PartBuildError) throw e;
      outcome = {
        problems: [invalidResponse(e, "items")],
        extraParts: [],
        madeParts: [],
      };
    }
    const { items, problems } = outcome;
    if (problems.length === 0 && items) {
      return {
        plan: { ...sentences, items },
        model: env.CLAUDE_SCENE_MODEL || DEFAULT_SCENE_MODEL,
        remakes: round,
        rejected,
        usage,
        ...(input.weak
          ? {
              pitch: lastAnswer?.pitch?.trim() || defaultPitch(input.weak.kind),
            }
          : {}),
        extraParts: outcome.extraParts,
        madeParts: outcome.madeParts,
        partLogs: outcome.partLogs ?? [],
      };
    }
    rejected.push(problems);
    itemsRejected++;
    // 英文を書き直さないと直らない理由があるか、同じ英文で部品が 2 回落ちたら、1 回目から作り直す
    const rewrite =
      problems.some((p) => p.stage === "sentences") || itemsRejected >= 2;
    feedback = {
      problems: problems.map((p) => p.message),
      // 1 回目からなら前の英文、2 回目だけなら前の部品を見せる
      previous: rewrite ? lastAnswer : outcome.previous,
    };
    if (rewrite) {
      sentences = undefined;
      itemsRejected = 0;
    }
  }
  throw new SceneVerificationError(rejected);
}
