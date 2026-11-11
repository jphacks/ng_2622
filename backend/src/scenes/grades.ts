import type { ChecklistKind, GradeId } from "./types";

// 級ごとの規則。生成の指示の表（generate-v2.ts）も、裏取りで数える数（verify.ts）も、ここから作る。
// 決めた経緯は docs/adr/20261110-write-grade-sentences-before-scene-parts.md。
// 文法の一覧は CEFR-J の考え方での下書き（英検の過去問の文は使っていない）。中身は PR で確かめる

/** CEFR-J の段階。B2 は「B2 か、語彙表に無い」で、どの級の中心の動作にも使えない */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** a が b 以下の段階か（A1 は A2 以下） */
export const withinLevel = (a: CefrLevel, b: CefrLevel) =>
  CEFR_LEVELS.indexOf(a) <= CEFR_LEVELS.indexOf(b);

export type Grade = {
  id: GradeId;
  /** 英検協会の公開する対応（3級 = A1、準2級 = A2、2級 = B1） */
  cefr: CefrLevel;
  /** この級で足す文法（英語の短い項目）。下の級の文法は上の級でも使える */
  grammar: readonly string[];
  /** 人の数（動物も 1 人と数える）と、その決まり */
  people: { min: number; max: number; note: string };
  /** 見本の答え（description）の文の数と、語数の目安 */
  sentences: number;
  words: number;
  /** チェックリストの種類ごとの数（docs/adr/20261110-score-content-with-checklist-f1.md） */
  checklist: Record<ChecklistKind, number>;
};

export const GRADES: Record<GradeId, Grade> = {
  "eiken-3": {
    id: "eiken-3",
    cefr: "A1",
    grammar: [
      "present continuous (A man is reading a book.)",
      "there is / there are",
      "be + adjective (The ball is red.)",
      "prepositions of place (in, on, under, next to, in front of, behind)",
      "have / has (The girl has a bag.)",
      "and joining two nouns or two short sentences",
    ],
    people: { min: 1, max: 2, note: "one main action each" },
    sentences: 3,
    words: 20,
    checklist: { center: 2, reason: 0, link: 0, detail: 1 },
  },
  "eiken-pre2": {
    id: "eiken-pre2",
    cefr: "A2",
    grammar: [
      "because + sentence (He is running because it is raining.)",
      "and / but / so joining sentences",
      "past simple (She dropped her cup.)",
      "be going to (He is going to catch the ball.)",
      "want to / try to + verb",
      "prepositions of movement (to, into, across, along)",
    ],
    people: { min: 3, max: 3, note: "each doing a different action" },
    sentences: 5,
    words: 40,
    checklist: { center: 3, reason: 1, link: 0, detail: 2 },
  },
  "eiken-2": {
    id: "eiken-2",
    cefr: "B1",
    grammar: [
      "so that (She is holding an umbrella so that he does not get wet.)",
      "to + verb for purpose (He is running to catch the bus.)",
      "relative clauses with who / which / that",
      "present perfect (A woman has fallen down.)",
      "while / when + sentence",
      "passive voice (The juice was spilled.)",
      "seem to / look + adjective",
    ],
    people: {
      min: 3,
      max: 4,
      note: "at least two of them interact with each other",
    },
    sentences: 6,
    words: 60,
    checklist: { center: 4, reason: 1, link: 1, detail: 2 },
  },
};

/** 級の並び（下の級から） */
export const GRADE_LIST: readonly Grade[] = Object.values(GRADES);

/** その級で使える文法（下の級の分も含む） */
export const grammarUpTo = (id: GradeId): string[] => {
  const list: string[] = [];
  for (const g of GRADE_LIST) {
    list.push(...g.grammar);
    if (g.id === id) break;
  }
  return list;
};

/** その級のチェックリストに出てくる種類（数が 1 以上のもの） */
export const kindsOf = (id: GradeId): ChecklistKind[] =>
  (Object.keys(GRADES[id].checklist) as ChecklistKind[]).filter(
    (k) => GRADES[id].checklist[k] > 0,
  );

/** チェックリストの項目の数の合計 */
export const checklistSize = (id: GradeId) =>
  Object.values(GRADES[id].checklist).reduce((a, b) => a + b, 0);
