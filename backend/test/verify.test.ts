// 裏取り（src/scenes/verify.ts）のテスト。Claude は呼ばない
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLE_ITEMS, EXAMPLE_SENTENCES } from "../src/scenes/generate-v2";
import { GRADES } from "../src/scenes/grades";
import { PARTS } from "../src/scenes/parts";
import type {
  ChecklistItem,
  GradeId,
  PlanItem,
  SceneSentences,
} from "../src/scenes/types";
import {
  acceptInDescription,
  acceptWordings,
  normalizeText,
  type Problem,
  refNames,
  verifyItems,
  verifyScene,
  verifySentences,
} from "../src/scenes/verify";

const clone = <T>(v: T): T => structuredClone(v);
const codes = (problems: Problem[]) => problems.map((p) => p.code);

const ground: PlanItem = {
  key: "ground",
  part: "grass_patch",
  place: { relation: "ground" },
};
const item = (key: string, part: string): PlanItem => ({
  key,
  part,
  place: { relation: "ground", zone: "center" },
});
const check = (
  id: string,
  kind: ChecklistItem["kind"],
  accept: string,
  refs: string[],
): ChecklistItem => ({ id, kind, label: id, accept, refs });

// eiken-3 の通る場面（中心 2・細部 1）
const EASY: SceneSentences = {
  name: "公園の犬",
  description:
    "A boy is running in the park. A dog is sitting next to a bench. There is a red ball on the grass.",
  checklist: [
    check("boy_run", "center", "a boy is running in the park", ["boy"]),
    check("dog_sit", "center", "a dog is sitting next to a bench", [
      "dog",
      "bench",
    ]),
    check("ball", "detail", "there is a red ball on the grass", ["ball"]),
  ],
};
const EASY_ITEMS: PlanItem[] = [
  ground,
  item("boy", "person_run_boy_a"),
  item("bench", "bench"),
  item("dog", "animal_sit_dog_a"),
  item("ball", "ball_red"),
];

// eiken-2 の通る場面（中心 4・理由 1・つながり 1・細部 2）
const HARD: SceneSentences = {
  name: "ボールを追う犬",
  description:
    "A boy threw a ball, so the dog is running across the grass to get it. Another boy is waiting to catch the ball. A woman has fallen down next to her bicycle. A man is helping her because she fell down. There is a bench behind them. The bicycle is lying on the ground.",
  checklist: [
    check("boy_throw", "center", "a boy threw a ball", ["boy"]),
    check("dog_run", "center", "the dog is running across the grass", ["dog"]),
    check("boy_catch", "center", "another boy is waiting to catch the ball", [
      "tall_boy",
    ]),
    check("man_help", "center", "a man is helping her", ["man", "woman"]),
    check("why_help", "reason", "because she fell down", ["woman", "man"]),
    check(
      "ball_dog",
      "link",
      "a boy threw a ball, so the dog is running across the grass to get it",
      ["boy", "ball", "dog"],
    ),
    check("bench", "detail", "there is a bench behind them", ["bench"]),
    check("bicycle", "detail", "the bicycle is lying on the ground", [
      "bicycle",
    ]),
  ],
};
const HARD_ITEMS: PlanItem[] = [
  ground,
  item("boy", "person_throw_boy_a"),
  item("tall_boy", "person_catch_boy_a"),
  item("ball", "ball_red"),
  item("dog", "animal_run_dog_a"),
  item("woman", "person_fallen_woman_a"),
  item("man", "person_help_up_adult_a"),
  item("bicycle", "bicycle_down"),
  item("bench", "bench"),
];

const all = (grade: GradeId, s: SceneSentences, items: PlanItem[]) =>
  verifyScene(grade, { ...s, items }, PARTS);

test("通る場面は理由が空（3級・準2級の指示の例・2級）", () => {
  assert.deepEqual(all("eiken-3", EASY, EASY_ITEMS), []);
  assert.deepEqual(all("eiken-pre2", EXAMPLE_SENTENCES, EXAMPLE_ITEMS), []);
  assert.deepEqual(all("eiken-2", HARD, HARD_ITEMS), []);
});

test("呼び名を集める: 重ねず、出てきた順", () => {
  assert.deepEqual(refNames(EXAMPLE_SENTENCES.checklist), [
    "girl",
    "boy",
    "man",
    "bench",
    "rain",
  ]);
});

test("kind ごとの数が級の形と違えば落ちる", () => {
  // 準2級の場面を 3級として見ると、中心・理由・細部が多い
  const problems = verifySentences("eiken-3", EXAMPLE_SENTENCES);
  assert.deepEqual(codes(problems), ["kind_count", "kind_count", "kind_count"]);
  assert.equal(
    problems[0].message,
    "checklist の center が 3 個ある。eiken-3 は 2 個",
  );
  assert.ok(problems.every((p) => p.stage === "sentences"));

  // 細部が 1 つ足りない
  const s = clone(EXAMPLE_SENTENCES);
  s.checklist = s.checklist.filter((c) => c.id !== "man_read");
  assert.deepEqual(
    verifySentences("eiken-pre2", s).map((p) => p.message),
    ["checklist の detail が 1 個ある。eiken-pre2 は 2 個"],
  );
});

test("2級で link を reason と書くと、両方の数で落ちる", () => {
  const s = clone(HARD);
  s.checklist[5].kind = "reason";
  assert.deepEqual(
    verifySentences("eiken-2", s).map((p) => p.message),
    [
      "checklist の reason が 2 個ある。eiken-2 は 1 個",
      "checklist の link が 0 個ある。eiken-2 は 1 個",
    ],
  );
});

test("数える数は級の定数から取る", () => {
  for (const [grade, s] of [
    ["eiken-3", EASY],
    ["eiken-pre2", EXAMPLE_SENTENCES],
    ["eiken-2", HARD],
  ] as const) {
    for (const [kind, n] of Object.entries(GRADES[grade].checklist)) {
      assert.equal(s.checklist.filter((c) => c.kind === kind).length, n);
    }
  }
});

test("id が重なれば落ちる", () => {
  const s = clone(EASY);
  s.checklist[2].id = "boy_run";
  assert.deepEqual(codes(verifySentences("eiken-3", s)), ["duplicate_id"]);
});

test("refs が空・呼び名の形でない項目は落ちる", () => {
  const s = clone(EASY);
  s.checklist[2].refs = [];
  s.checklist[0].refs = ["Boy"];
  s.checklist[1].refs = ["dog", "park bench"];
  const problems = verifySentences("eiken-3", s);
  assert.deepEqual(codes(problems), ["ref_name", "ref_name", "no_refs"]);
  assert.ok(problems[0].message.includes("「Boy」"));
  assert.ok(problems[1].message.includes("「park bench」"));
});

test("reason・link の refs が 2 つ未満なら落ちる（同じ呼び名 2 つは 1 つと数える）", () => {
  const s = clone(HARD);
  s.checklist[4].refs = ["woman"];
  s.checklist[5].refs = ["dog", "dog"];
  assert.deepEqual(
    verifySentences("eiken-2", s).map((p) => p.message),
    [
      "reason の項目 why_help の refs が 1 個。原因と行動の 2 つ以上が要る",
      "link の項目 ball_dog の refs が 1 個。原因と行動の 2 つ以上が要る",
    ],
  );
  // center と detail は 1 つでよい
  assert.deepEqual(verifySentences("eiken-3", EASY), []);
});

test("accept が description に無ければ落ちる", () => {
  const s = clone(EASY);
  s.checklist[0].accept = "a boy is running fast";
  const problems = verifySentences("eiken-3", s);
  assert.deepEqual(codes(problems), ["accept_not_in_description"]);
  assert.equal(
    problems[0].message,
    "項目 boy_run の accept「a boy is running fast」が description に無い",
  );
});

test("accept と description の比べ方: 大文字小文字・句読点の違いは無視し、語の途中では当てない", () => {
  const d = "It's raining. A boy threw a ball, so the dog is running!";
  assert.ok(acceptInDescription("it's raining", d));
  assert.ok(acceptInDescription("Its raining.", d) === false);
  assert.ok(acceptInDescription("A BOY THREW A BALL so the dog is running", d));
  assert.ok(acceptInDescription("the dog is running.", d));
  assert.ok(!acceptInDescription("the dog is run", d));
  assert.ok(!acceptInDescription("a boy threw a ball so the cat", d));
  assert.equal(normalizeText("  He's  here,  (now). "), "he s here now");
});

test("accept の別の言い方（/ 区切り）は、どれか 1 つが description にあればよい", () => {
  const d = "A boy is running because he has no umbrella.";
  assert.deepEqual(
    acceptWordings("because it is raining / He has no umbrella."),
    ["because it is raining", "he has no umbrella"],
  );
  assert.ok(
    acceptInDescription("because it is raining / he has no umbrella", d),
  );
  assert.ok(!acceptInDescription("because it is raining / he is late", d));
  assert.ok(!acceptInDescription(" / ", d));
});

test("refs の呼び名が items の key に無ければ落ちる（どの項目のどの呼び名かを言う）", () => {
  const items = EXAMPLE_ITEMS.filter((i) => i.key !== "bench");
  const problems = verifyItems("eiken-pre2", EXAMPLE_SENTENCES, items, PARTS);
  assert.deepEqual(
    problems.map((p) => p.message),
    ["refs の bench（項目 man_sit）が items の key に無い"],
  );
  assert.equal(problems[0].stage, "items");
});

test("床や壁など、refs に無い key は足してよい", () => {
  const items = [...EXAMPLE_ITEMS, item("shelter", "bus_shelter")];
  assert.deepEqual(
    verifyItems("eiken-pre2", EXAMPLE_SENTENCES, items, PARTS),
    [],
  );
});

test("key が重なる・部品が一覧に無い items は落ちる", () => {
  const items = [
    ...EASY_ITEMS,
    item("ball", "ball_red"),
    item("cat", "animal_cat_a"),
  ];
  assert.deepEqual(codes(verifyItems("eiken-3", EASY, items, PARTS)), [
    "duplicate_key",
    "unknown_part",
  ]);
});

test("center が指す人のポーズと accept の動詞が食い違えば落ちる（2 回目の作り直しで直す）", () => {
  const items = EASY_ITEMS.map((i) =>
    i.key === "boy" ? item("boy", "person_stand_boy_a") : i,
  );
  const problems = verifyItems("eiken-3", EASY, items, PARTS);
  assert.deepEqual(codes(problems), ["verb_mismatch"]);
  assert.equal(problems[0].stage, "items");
  assert.equal(
    problems[0].message,
    "center の項目 boy_run の accept「a boy is running in the park」の動詞が、部品のポーズと合わない。boy の部品 person_stand_boy_a（stand, wait, watch, look, talk, listen）",
  );
});

test("center の動詞は、refs のうち人や動物のどれか 1 つのポーズと合えばよい", () => {
  // man（help_up）と woman（fallen）のうち、help は man のポーズの動詞
  assert.deepEqual(verifyItems("eiken-2", HARD, HARD_ITEMS, PARTS), []);
  // ベンチ（物）のポーズは見ない
  assert.deepEqual(verifyItems("eiken-3", EASY, EASY_ITEMS, PARTS), []);
});

test("center の refs に人や動物がいなければ落ちる（1 回目から作り直す）", () => {
  const s = clone(EASY);
  s.checklist[1] = check(
    "bench",
    "center",
    "a dog is sitting next to a bench",
    ["bench"],
  );
  const problems = verifyItems("eiken-3", s, EASY_ITEMS, PARTS);
  assert.deepEqual(codes(problems), ["center_without_actor"]);
  assert.equal(problems[0].stage, "sentences");
});

test("center の動詞が級の段階を超えれば落ちる（1 回目から作り直す）", () => {
  // throw は A2。3級（A1）では中心に使えない
  const s = clone(EASY);
  s.description = `A boy is throwing a ball. ${s.description}`;
  s.checklist[0] = check("boy_throw", "center", "a boy is throwing a ball", [
    "boy",
  ]);
  const items = EASY_ITEMS.map((i) =>
    i.key === "boy" ? item("boy", "person_throw_boy_a") : i,
  );
  const problems = verifyItems("eiken-3", s, items, PARTS);
  assert.deepEqual(codes(problems), ["verb_level"]);
  assert.equal(problems[0].stage, "sentences");
  assert.equal(
    problems[0].message,
    "center の項目 boy_throw の動詞（throw は A2）が級の範囲に無い。eiken-3 の中心の動作は CEFR-J A1 まで",
  );
  // 準2級（A2）なら通る
  assert.deepEqual(codes(verifyItems("eiken-pre2", s, items, PARTS)), []);
});

test("同じポーズでも、やさしい動詞で言えば下の級で通る（wipe は B2、clean は A1）", () => {
  const scene = (accept: string): SceneSentences => ({
    name: "カフェ",
    description: `${accept}. A man is drinking coffee. There is a cup on the table.`,
    checklist: [
      check("woman", "center", accept, ["woman", "table"]),
      check("man", "center", "a man is drinking coffee", ["man"]),
      check("cup", "detail", "there is a cup on the table", ["cup"]),
    ],
  });
  const items = [
    ground,
    item("table", "table"),
    item("woman", "person_wipe_woman_a"),
    item("man", "person_drink_adult_a"),
    item("cup", "cup"),
  ];
  assert.deepEqual(
    all("eiken-3", scene("A woman is cleaning the table"), items),
    [],
  );
  for (const grade of ["eiken-3", "eiken-pre2", "eiken-2"] as const) {
    assert.deepEqual(
      codes(
        verifyItems(grade, scene("A woman is wiping the table"), items, PARTS),
      ),
      ["verb_level"],
      grade,
    );
  }
});

test("detail・reason・link の項目は、ポーズの動詞を見ない", () => {
  // man_read（detail）は座って読む人。立つ人に替えても、detail では落とさない
  const s = clone(EXAMPLE_SENTENCES);
  s.checklist = s.checklist.filter((c) => c.kind !== "center");
  const items = EXAMPLE_ITEMS.map((i) =>
    i.key === "man" ? item("man", "person_stand_adult_a") : i,
  );
  assert.deepEqual(verifyItems("eiken-pre2", s, items, PARTS), []);
});

test("呼び名が items に無い center は、ポーズを見ずに呼び名の理由だけを返す", () => {
  const items = EASY_ITEMS.filter((i) => i.key !== "boy");
  assert.deepEqual(codes(verifyItems("eiken-3", EASY, items, PARTS)), [
    "ref_not_in_items",
  ]);
});

test("英文と部品の理由をまとめて返す", () => {
  const s = clone(EASY);
  s.checklist[2].accept = "there is a blue ball";
  const items = EASY_ITEMS.filter((i) => i.key !== "ball");
  assert.deepEqual(codes(all("eiken-3", s, items)), [
    "accept_not_in_description",
    "ref_not_in_items",
  ]);
});
