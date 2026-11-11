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
  verifyPlaces,
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

// eiken-2 の通る場面（中心 4・理由 1・つながり 1・細部 2、人と動物は 4）
const HARD: SceneSentences = {
  name: "ボールを追う犬",
  description:
    "A boy threw a ball, so the dog is running across the grass to get it. A woman has fallen down next to her bicycle. A man is helping her because she has fallen down. There is a bench behind them. The bicycle is lying on the ground.",
  checklist: [
    check("boy_throw", "center", "a boy threw a ball", ["boy"]),
    check("dog_run", "center", "the dog is running", ["dog"]),
    check("woman_fall", "center", "a woman has fallen down", ["woman"]),
    check("man_help", "center", "a man is helping her", ["man", "woman"]),
    check(
      "why_help",
      "reason",
      "a man is helping her because she has fallen down",
      ["man", "woman"],
    ),
    check(
      "ball_dog",
      "link",
      "a boy threw a ball, so the dog is running across the grass to get it",
      ["dog", "ball", "boy"],
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
    "rain",
    "bench",
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
  s.checklist = s.checklist.filter((c) => c.id !== "man_sit");
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
  // 準2級（A2）なら動詞では落ちない
  assert.ok(
    !codes(verifyItems("eiken-pre2", s, items, PARTS)).includes("verb_level"),
  );
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
      ).filter((c) => c.startsWith("verb")),
      ["verb_level"],
      grade,
    );
  }
});

test("detail の動詞は級の段階を見ない（段階を見るのは center だけ）", () => {
  // hold は A2。3級でも、detail なら段階では落とさない
  const s: SceneSentences = {
    ...EASY,
    description: `${EASY.description} The girl is holding a box.`,
    checklist: [
      EASY.checklist[1],
      check("girl", "center", "a girl is carrying a box", ["girl"]),
      check("hold", "detail", "the girl is holding a box", ["girl"]),
    ],
  };
  s.description = `A girl is carrying a box. ${s.description}`;
  const items = [
    ...EASY_ITEMS.filter((i) => i.key !== "boy"),
    item("girl", "person_carry_girl_a"),
  ];
  assert.deepEqual(all("eiken-3", s, items), []);
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

test("立っているポーズの人は、何をしていても「立っている」と言える（段階は stand の A2）", () => {
  const scene = (accept: string): SceneSentences => ({
    name: "部屋",
    description: `${accept}. A boy is looking at it. A man is eating because it is raining. It is raining. There is a table.`,
    checklist: [
      check("girl", "center", accept, ["girl", "table"]),
      check("boy", "center", "a boy is looking at it", ["boy"]),
      check("man", "center", "a man is eating", ["man"]),
      check("why", "reason", "a man is eating because it is raining", [
        "man",
        "rain",
      ]),
      check("rain", "detail", "it is raining", ["rain"]),
      check("table", "detail", "there is a table", ["table"]),
    ],
  });
  const items = (girl: string) => [
    ground,
    item("rain", "rain"),
    item("table", "table"),
    item("girl", girl),
    item("boy", "person_look_boy_a"),
    item("man", "person_eat_adult_a"),
  ];
  const standing = scene("A girl is standing next to the table");
  // 手をかざして見る女の子・スマホを見る人も、立っている
  for (const part of ["person_look_girl_a", "person_phone_adult_a"]) {
    const problems = verifyItems("eiken-pre2", standing, items(part), PARTS);
    assert.ok(!codes(problems).includes("verb_mismatch"), part);
    assert.ok(!codes(problems).includes("verb_level"), part);
  }
  // 走っている人・座っている人は「立っている」と言えない
  for (const part of ["person_run_phone_girl_a", "person_sit_girl_a"]) {
    assert.ok(
      codes(verifyItems("eiken-pre2", standing, items(part), PARTS)).includes(
        "verb_mismatch",
      ),
      part,
    );
  }
});

test("3級では standing は段階で落ち、waiting・looking なら通る", () => {
  const scene = (accept: string): SceneSentences => ({
    ...EASY,
    description: `${accept}. ${EASY.description}`,
    checklist: [
      check("boy", "center", accept, ["boy"]),
      EASY.checklist[1],
      EASY.checklist[2],
    ],
  });
  const items = EASY_ITEMS.map((i) =>
    i.key === "boy" ? item("boy", "person_stand_boy_a") : i,
  );
  assert.deepEqual(
    verifyItems("eiken-3", scene("A boy is standing"), items, PARTS).map(
      (p) => p.message,
    ),
    [
      "center の項目 boy の動詞（stand は A2）が級の範囲に無い。eiken-3 の中心の動作は CEFR-J A1 まで",
    ],
  );
  assert.deepEqual(all("eiken-3", scene("A boy is waiting"), items), []);
  assert.deepEqual(
    all("eiken-3", scene("A boy is looking at a dog"), items),
    [],
  );
});

test("座っているポーズの人は「座っている」と言える（拍手する人など）", () => {
  const s: SceneSentences = {
    ...EASY,
    description: `A man is sitting. ${EASY.description}`,
    checklist: [
      check("man", "center", "a man is sitting", ["man"]),
      EASY.checklist[1],
      EASY.checklist[2],
    ],
  };
  const items = [
    ...EASY_ITEMS.filter((i) => i.key !== "boy"),
    item("man", "person_clap_adult_a"),
  ];
  assert.deepEqual(all("eiken-3", s, items), []);
});

test("同じ人が 2 つの center の主役なら落ちる（1 回目から作り直す）", () => {
  const s = clone(HARD);
  // 助けている男の人に、もう 1 つ動作を持たせる
  s.description = `${s.description} The man is holding her hand.`;
  s.checklist[2] = check("man_hold", "center", "the man is holding her hand", [
    "man",
    "woman",
  ]);
  const problems = verifyItems("eiken-2", s, HARD_ITEMS, PARTS);
  assert.deepEqual(codes(problems), ["actor_twice"]);
  assert.equal(problems[0].stage, "sentences");
  assert.equal(
    problems[0].message,
    "man が center の項目 man_hold と man_help の両方の主役になっている。1 人につき動作は 1 つにし、2 つ目は detail にするか別の人にする",
  );
});

test("別の center の相手として出てくるだけなら落ちない（主役は refs の先頭の人）", () => {
  // woman は woman_fall の主役で、man_help では相手
  assert.deepEqual(verifyItems("eiken-2", HARD, HARD_ITEMS, PARTS), []);
});

test("reason・link の refs に行動する人や動物がいなければ落ちる", () => {
  const s = clone(HARD);
  s.checklist[4].refs = ["bench", "bicycle"];
  const problems = verifyItems("eiken-2", s, HARD_ITEMS, PARTS);
  assert.deepEqual(codes(problems), ["reason_without_actor"]);
  assert.equal(problems[0].stage, "sentences");
  assert.equal(
    problems[0].message,
    "reason の項目 why_help の refs（bench, bicycle）に、行動する人や動物がいない",
  );
});

test("人と動物の数が級の範囲を外れれば落ちる（動物も 1 人と数える）", () => {
  // 3級は 1〜2。3 人目を足すと落ちる
  const many = [...EASY_ITEMS, item("woman", "person_walk_woman_a")];
  assert.deepEqual(
    verifyItems("eiken-3", EASY, many, PARTS).map((p) => p.message),
    ["人と動物が 3（boy, dog, woman）。eiken-3 は 1〜2"],
  );
  // 準2級はちょうど 3。1 人足りないと落ちる
  const few = EXAMPLE_ITEMS.filter((i) => i.key !== "girl");
  const s = clone(EXAMPLE_SENTENCES);
  s.checklist[0].refs = ["boy"];
  const problems = verifyItems("eiken-pre2", s, few, PARTS);
  assert.ok(
    problems.some(
      (p) =>
        p.code === "people_count" &&
        p.stage === "sentences" &&
        p.message === "人と動物が 2（man, boy）。eiken-pre2 は 3",
    ),
  );
  // 2級は 3〜4。背景に足した 5 人目で落ちる
  const five = [...HARD_ITEMS, item("girl", "person_stand_girl_a")];
  assert.deepEqual(codes(verifyItems("eiken-2", HARD, five, PARTS)), [
    "people_count",
  ]);
});

test("accept の形: 動詞の無い切れ端・主語から始まらない accept は落ちる", () => {
  const withDetail = (accept: string) => {
    const s = clone(EASY);
    s.description = `${s.description} A boy is running to the train, waiting with a basket.`;
    s.checklist[2] = check("d", "detail", accept, ["ball"]);
    return codes(verifySentences("eiken-3", s, PARTS));
  };
  assert.deepEqual(withDetail("to the train"), ["accept_no_verb"]);
  assert.deepEqual(withDetail("waiting with a basket"), ["accept_no_subject"]);
  // detail は there で始めてよい
  assert.deepEqual(withDetail("there is a red ball on the grass"), []);
  // 天気の it も detail では通る
  assert.deepEqual(verifySentences("eiken-pre2", EXAMPLE_SENTENCES, PARTS), []);
});

test("accept の形: center・reason・link の主語が代名詞なら落ちる", () => {
  const s = clone(HARD);
  s.description = `${s.description} She is looking at the boy. He is helping her because she has fallen down.`;
  s.checklist[2] = check("woman_look", "center", "she is looking at the boy", [
    "woman",
  ]);
  s.checklist[4].accept = "he is helping her because she has fallen down";
  const problems = verifySentences("eiken-2", s, PARTS);
  assert.deepEqual(codes(problems), ["accept_pronoun", "accept_pronoun"]);
  assert.equal(
    problems[0].message,
    "center の項目 woman_look の accept「she is looking at the boy」の主語が代名詞（she）。a girl のように名詞で書く（description のその文も）",
  );
  // because から始まる理由は、主語から始まっていない
  s.checklist[4].accept = "because she has fallen down";
  assert.deepEqual(codes(verifySentences("eiken-2", s, PARTS)).slice(1), [
    "accept_no_subject",
  ]);
});

test("center の主語の人にその動作ができなければ、部品を選ぶ前に落ちる", () => {
  const scene = (accept: string, ref: string): SceneSentences => ({
    ...EASY,
    description: `${accept}. ${EASY.description}`,
    checklist: [
      check("who", "center", accept, [ref]),
      EASY.checklist[1],
      EASY.checklist[2],
    ],
  });
  const messages = (accept: string, ref: string) =>
    verifySentences("eiken-3", scene(accept, ref), PARTS).map((p) => p.message);
  // drink は woman・man だけ
  assert.deepEqual(messages("A girl is drinking from a cup", "girl"), [
    "center の項目 who: girl にできる動作に drink が無い（できるのは man, woman）。できる人に替えるか、girl にできる動作にする",
  ]);
  // fallen は woman だけ。has は助動詞なので、hold のポーズの have とは見ない
  assert.deepEqual(
    codes(
      verifySentences(
        "eiken-3",
        scene("A girl has fallen down", "girl"),
        PARTS,
      ),
    ),
    ["who_cannot"],
  );
  assert.deepEqual(messages("A woman is drinking from a cup", "woman"), []);
  assert.deepEqual(messages("A woman has fallen down", "woman"), []);
  // 物を持っている（have が動作）は girl にできる
  assert.deepEqual(messages("A girl has a box", "girl"), []);
  // 文の先頭の人が主語。old man は man と別の人
  assert.deepEqual(messages("An old man is feeding a bird", "old_man"), []);
  assert.deepEqual(
    codes(
      verifySentences(
        "eiken-3",
        scene("An old man is reading a book", "old_man"),
        PARTS,
      ),
    ),
    ["who_cannot"],
  );
  assert.deepEqual(messages("A man is helping a woman", "man"), []);
  // 一覧に無い呼び方（teacher）と、parts を渡さないときは確かめない
  assert.deepEqual(messages("A teacher is drinking tea", "teacher"), []);
  assert.deepEqual(
    verifySentences("eiken-3", scene("A girl is drinking", "girl")),
    [],
  );
});

test("has fallen の has は、hold のポーズの動詞（have）とは見ない", () => {
  const s: SceneSentences = {
    ...EASY,
    description: `A woman has fallen down. ${EASY.description}`,
    checklist: [
      check("fall", "center", "a woman has fallen down", ["woman"]),
      EASY.checklist[1],
      EASY.checklist[2],
    ],
  };
  const items = (part: string) => [
    ...EASY_ITEMS.filter((i) => i.key !== "boy"),
    item("woman", part),
  ];
  assert.deepEqual(
    codes(
      verifyItems("eiken-pre2", s, items("person_hold_woman_a"), PARTS),
    ).filter((c) => c.startsWith("verb")),
    ["verb_mismatch"],
  );
  assert.ok(
    !codes(
      verifyItems("eiken-pre2", s, items("person_fallen_woman_a"), PARTS),
    ).includes("verb_mismatch"),
  );
});

test("人が持っている物を、別の部品としてもう一度置くと落ちる", () => {
  // 傘を持つ女の子の上に、別の傘（どの項目も指していない）
  const extra = [...EXAMPLE_ITEMS, item("umbrella", "umbrella")];
  const problems = verifyItems("eiken-pre2", EXAMPLE_SENTENCES, extra, PARTS);
  assert.deepEqual(codes(problems), ["held_thing"]);
  assert.equal(problems[0].stage, "items");
  assert.equal(
    problems[0].message,
    "girl の部品 person_umbrella_girl_a は umbrella を持っている。別の部品 umbrella（umbrella）を置かない",
  );
  // かごを持つ人の横の床に、別のかご
  const s = clone(EXAMPLE_SENTENCES);
  const basket = [
    ...EXAMPLE_ITEMS.map((i) =>
      i.key === "girl" ? item("girl", "person_basket_woman_a") : i,
    ),
    item("basket", "basket"),
  ];
  assert.ok(
    codes(verifyItems("eiken-pre2", s, basket, PARTS)).includes("held_thing"),
  );
});

test("持ち物を呼び名にした項目が、持っている人も指していれば 1 回目から作り直す", () => {
  const s = clone(EXAMPLE_SENTENCES);
  s.checklist[0].refs = ["girl", "umbrella"];
  const items = [...EXAMPLE_ITEMS, item("umbrella", "umbrella")];
  const problems = verifyItems("eiken-pre2", s, items, PARTS);
  assert.deepEqual(codes(problems), ["held_thing"]);
  assert.equal(problems[0].stage, "sentences");
  assert.ok(problems[0].message.includes("項目 girl_umbrella"));
});

test("持っている人と関係の無い項目が指す物・uses の物・持ち物と違う物は落とさない", () => {
  // 傘を持つ女の子とは別に、ベンチの傘を言う細部がある
  const s = clone(EXAMPLE_SENTENCES);
  s.description = `${s.description} There is an umbrella on the bench.`;
  s.checklist[4] = check(
    "umbrella",
    "detail",
    "there is an umbrella on the bench",
    ["umbrella", "bench"],
  );
  const items = [...EXAMPLE_ITEMS, item("umbrella", "umbrella")];
  assert.deepEqual(verifyItems("eiken-pre2", s, items, PARTS), []);
  // 皿を並べる男の子（holds: plates、uses: plate）と、テーブルの皿
  const plates = [
    ...EXAMPLE_ITEMS.map((i) =>
      i.key === "boy" ? item("boy", "person_set_plates_boy_a") : i,
    ),
    item("plate", "plate"),
    item("ball", "ball_red"),
  ];
  assert.ok(
    !codes(
      verifyItems("eiken-pre2", EXAMPLE_SENTENCES, plates, PARTS),
    ).includes("held_thing"),
  );
});

test("屋内の床の場面に雨があれば落ちる（屋外の地面なら通る）", () => {
  const indoors = EXAMPLE_ITEMS.map((i) =>
    i.key === "ground" ? { ...i, part: "floor_tile" } : i,
  );
  const problems = verifyItems("eiken-pre2", EXAMPLE_SENTENCES, indoors, PARTS);
  assert.deepEqual(codes(problems), ["rain_indoors"]);
  // 英文が雨を言っているので、1 回目から作り直す
  assert.equal(problems[0].stage, "sentences");
  assert.equal(
    problems[0].message,
    "屋内の床（floor_tile）の場面に雨（rain）がある。雨は屋外の場面だけにし、屋内では雨を理由にしない",
  );
  // 英文に雨が無いのに 2 回目が足したら、2 回目だけ作り直す
  const dry = [...EASY_ITEMS, item("rain", "rain")].map((i) =>
    i.key === "ground" ? { ...i, part: "floor_wood" } : i,
  );
  const added = verifyItems("eiken-3", EASY, dry, PARTS);
  assert.deepEqual(
    added.map((p) => [p.code, p.stage]),
    [["rain_indoors", "items"]],
  );
  assert.deepEqual(
    verifyItems("eiken-pre2", EXAMPLE_SENTENCES, EXAMPLE_ITEMS, PARTS),
    [],
  );
});

// ここから、作り置きを試して絵と見比べたときに見つかった食い違い（2026-11-11）の実例

test("同じ accept を 2 つの項目に使うと落ちる（教室: center と detail が同じ文）", () => {
  const s: SceneSentences = {
    name: "教室で手をあげる",
    description:
      "A boy is raising his hand in the classroom. A woman is writing on the blackboard. A girl is writing at a desk. The woman is writing on the blackboard because the boy is raising his hand. There is a chair next to the desk.",
    checklist: [
      check("boy_raise", "center", "a boy is raising his hand", ["boy"]),
      check("woman_write", "center", "a woman is writing on the blackboard", [
        "woman",
      ]),
      check("girl_write", "center", "a girl is writing at a desk", ["girl"]),
      check(
        "why",
        "reason",
        "the woman is writing on the blackboard because the boy is raising his hand",
        ["woman", "boy"],
      ),
      check("chair", "detail", "there is a chair next to the desk", ["chair"]),
      check("girl_desk", "detail", "a girl is writing at a desk", ["girl"]),
    ],
  };
  const problems = verifySentences("eiken-pre2", s, PARTS);
  assert.deepEqual(
    problems.map((p) => p.message),
    [
      "detail の項目 girl_desk の accept「a girl is writing at a desk」が、項目 girl_write の accept と同じか、その一部。項目ごとに別の事実にする",
    ],
  );
  // center の文の一部だけの detail も落ちる
  s.checklist[5].accept = "a girl is writing";
  assert.deepEqual(codes(verifySentences("eiken-pre2", s, PARTS)), [
    "duplicate_accept",
  ]);
  // " / " の別の言い方が同じでも落ちる
  s.checklist[5].accept = "the girl has a pen / a girl is writing at a desk";
  s.description = `${s.description} The girl has a pen.`;
  assert.deepEqual(codes(verifySentences("eiken-pre2", s, PARTS)), [
    "duplicate_accept",
  ]);
  // 別の事実なら通る。reason が center の文を含むのは落とさない
  s.checklist[5].accept = "the girl has a pen";
  assert.deepEqual(verifySentences("eiken-pre2", s, PARTS), []);
});

test("center に場所を足した detail と、同じ文の center どうし", () => {
  // 場所を足した長い文は別の事実（どこで）なので落とさない
  const s = clone(HARD);
  s.description = `${s.description} A woman has fallen down on the grass.`;
  s.checklist[6] = check(
    "where",
    "detail",
    "a woman has fallen down on the grass",
    ["woman"],
  );
  assert.deepEqual(verifySentences("eiken-2", s, PARTS), []);
  // center が同じ文なら、後ろのほうを落とす
  s.checklist[1] = { ...s.checklist[0], id: "again" };
  assert.deepEqual(
    verifySentences("eiken-2", s, PARTS).map((p) => [
      p.code,
      p.message.startsWith("center の項目 again の accept"),
    ]),
    [["duplicate_accept", true]],
  );
});

test("壁に掛けられない物を「on the wall」と言うと落ちる（教室の時計）", () => {
  const s: SceneSentences = {
    name: "教室の女の子と男の子",
    description:
      "A girl is writing at a desk. A boy is sleeping at his desk. There is a clock on the wall.",
    checklist: [
      check("girl_write", "center", "a girl is writing", ["girl"]),
      check("boy_sleep", "center", "a boy is sleeping", ["boy"]),
      check("clock_wall", "detail", "there is a clock on the wall", ["clock"]),
    ],
  };
  const items: PlanItem[] = [
    { key: "ground", part: "floor_classroom", place: { relation: "ground" } },
    { key: "wall", part: "wall_blackboard", place: { relation: "ground" } },
    item("desk1", "table_small"),
    {
      key: "chair1",
      part: "chair",
      place: { relation: "seat_at", target: "desk1" },
    },
    {
      key: "girl",
      part: "person_write_girl_a",
      place: { relation: "sit_on", target: "chair1" },
    },
    {
      key: "chair2",
      part: "chair",
      place: { relation: "ground", zone: "right" },
    },
    {
      key: "boy",
      part: "person_sleep_teen_a",
      place: { relation: "sit_on", target: "chair2" },
    },
    // 実例では、時計が机の上に置かれていた
    { key: "clock", part: "clock", place: { relation: "on", target: "desk1" } },
  ];
  const problems = verifyItems("eiken-3", s, items, PARTS);
  assert.deepEqual(codes(problems), ["on_the_wall"]);
  assert.equal(problems[0].stage, "sentences");
  assert.ok(problems[0].message.includes("clock が壁にある"));
  // 背景の壁そのもの（黒板つきの壁）を言うのは通る
  s.description = s.description.replace("a clock", "a blackboard");
  s.checklist[2] = check(
    "board",
    "detail",
    "there is a blackboard on the wall",
    ["wall"],
  );
  assert.deepEqual(verifyItems("eiken-3", s, items.slice(0, -1), PARTS), []);
});

test("detail の主語も代名詞にできない（he is sitting on a chair・she is drinking from a cup）", () => {
  for (const accept of [
    "he is sitting on a chair",
    "she is drinking from a cup",
  ]) {
    const s = clone(EASY);
    s.description = `${s.description} ${accept}.`;
    s.checklist[2] = check("d", "detail", accept, ["boy"]);
    const problems = verifySentences("eiken-3", s, PARTS);
    assert.deepEqual(codes(problems), ["accept_pronoun"], accept);
    assert.ok(problems[0].message.startsWith("detail の項目 d "));
  }
  // 天気の it は通る。天気でない it は落ちる
  const s = clone(EASY);
  s.description = `${s.description} It is raining. It is on the grass.`;
  s.checklist[2] = check("d", "detail", "it is raining", ["ball"]);
  assert.deepEqual(verifySentences("eiken-3", s, PARTS), []);
  s.checklist[2] = check("d", "detail", "it is on the grass", ["ball"]);
  assert.deepEqual(codes(verifySentences("eiken-3", s, PARTS)), [
    "accept_pronoun",
  ]);
});

test("人が主語の detail の動作が、その人のポーズに無ければ落ちる（座る女の人が飲んでいる）", () => {
  const s: SceneSentences = {
    name: "公園のボール遊び",
    description:
      "A boy is throwing a ball in the park. A dog is running across the grass because the boy threw the ball. A woman is sitting on the bench. The woman is drinking from a cup. There is a tree behind the bench.",
    checklist: [
      check("boy_throw", "center", "a boy is throwing a ball", ["boy", "ball"]),
      check("dog_run", "center", "a dog is running across the grass", ["dog"]),
      check("woman_sit", "center", "a woman is sitting on the bench", [
        "woman",
        "bench",
      ]),
      check(
        "why_dog",
        "reason",
        "a dog is running across the grass because the boy threw the ball",
        ["dog", "boy", "ball"],
      ),
      check("woman_cup", "detail", "the woman is drinking from a cup", [
        "woman",
      ]),
      check("tree_behind", "detail", "there is a tree behind the bench", [
        "tree",
        "bench",
      ]),
    ],
  };
  const items: PlanItem[] = [
    ground,
    { key: "tree", part: "tree", place: { relation: "ground", zone: "back" } },
    {
      key: "bench",
      part: "bench",
      place: { relation: "in_front_of", target: "tree" },
    },
    {
      key: "woman",
      part: "person_sit_woman_a",
      place: { relation: "sit_on", target: "bench" },
    },
    {
      key: "boy",
      part: "person_throw_boy_a",
      place: { relation: "ground", zone: "left" },
    },
    {
      key: "ball",
      part: "ball_red",
      place: { relation: "thrown_by", target: "boy" },
    },
    {
      key: "dog",
      part: "animal_run_dog_a",
      place: { relation: "ground", zone: "front_right" },
    },
  ];
  const problems = verifyItems("eiken-pre2", s, items, PARTS);
  assert.deepEqual(codes(problems), ["action_mismatch"]);
  assert.equal(problems[0].stage, "sentences");
  assert.ok(
    problems[0].message.startsWith(
      "detail の項目 woman_cup の accept「the woman is drinking from a cup」の動詞（drink）が、woman の部品 person_sit_woman_a のポーズ",
    ),
  );
  // 場所だけの detail（動詞は姿勢）は通る
  s.description = s.description.replace(
    "The woman is drinking from a cup.",
    "The woman is sitting under a tree.",
  );
  s.checklist[4] = check(
    "woman_tree",
    "detail",
    "the woman is sitting under a tree",
    ["woman", "tree"],
  );
  assert.deepEqual(verifyScene("eiken-pre2", { ...s, items }, PARTS), []);
});

test("reason の行動が、その人のポーズに無ければ落ちる（黒板に書く先生が質問している）", () => {
  const scene = (reason: string): SceneSentences => ({
    name: "教室で手をあげる",
    description: `A boy is raising his hand in the classroom. A woman is writing on the blackboard. A girl is writing at a desk. ${reason}. There is a desk in front of the boy. There is a chair next to the girl.`,
    checklist: [
      check("boy_raise", "center", "a boy is raising his hand", ["boy"]),
      check("woman_write", "center", "a woman is writing on the blackboard", [
        "woman",
        "blackboard",
      ]),
      check("girl_write", "center", "a girl is writing", ["girl"]),
      check("why", "reason", reason, ["woman", "boy"]),
      check("desk", "detail", "there is a desk in front of the boy", ["desk1"]),
      check("chair", "detail", "there is a chair next to the girl", ["chair2"]),
    ],
  });
  const items: PlanItem[] = [
    { key: "ground", part: "floor_classroom", place: { relation: "ground" } },
    {
      key: "blackboard",
      part: "wall_blackboard",
      place: { relation: "ground" },
    },
    {
      key: "woman",
      part: "person_blackboard_woman_a",
      place: { relation: "relate", target: "blackboard", link: "hand" },
    },
    {
      key: "desk1",
      part: "table_small",
      place: { relation: "ground", zone: "front_left" },
    },
    {
      key: "chair1",
      part: "chair",
      place: { relation: "seat_at", target: "desk1" },
    },
    {
      key: "boy",
      part: "person_raise_hand_boy_a",
      place: { relation: "sit_on", target: "chair1" },
    },
    {
      key: "desk2",
      part: "table_small",
      place: { relation: "ground", zone: "front_right" },
    },
    {
      key: "chair2",
      part: "chair",
      place: { relation: "seat_at", target: "desk2" },
    },
    {
      key: "girl",
      part: "person_write_girl_a",
      place: { relation: "sit_on", target: "chair2" },
    },
  ];
  const bad = verifyItems(
    "eiken-pre2",
    scene("The woman is asking the boy a question because he raised his hand"),
    items,
    PARTS,
  );
  assert.deepEqual(codes(bad), ["action_mismatch"]);
  assert.equal(bad[0].stage, "sentences");
  assert.ok(
    bad[0].message.startsWith(
      "reason の項目 why の行動「The woman is asking the boy a question」の動詞（ask）が、woman の部品 person_blackboard_woman_a のポーズ",
    ),
  );
  // 行動が center と同じ動作なら通る。because の後ろ（原因の側）の動詞は見ない
  assert.deepEqual(
    verifyScene(
      "eiken-pre2",
      {
        ...scene(
          "The woman is writing on the blackboard because the boy asked a question",
        ),
        items,
      },
      PARTS,
    ),
    [],
  );
  // 主語は呼び方で探す。refs の順が逆でも、woman の部品で確かめる
  const swapped = scene(
    "The woman is asking the boy a question because he raised his hand",
  );
  swapped.checklist[3].refs = ["boy", "woman"];
  assert.deepEqual(codes(verifyItems("eiken-pre2", swapped, items, PARTS)), [
    "action_mismatch",
  ]);
});

test("link の行動は、文のどこかにその人のポーズの動詞があればよい", () => {
  assert.deepEqual(verifyItems("eiken-2", HARD, HARD_ITEMS, PARTS), []);
  const s = clone(HARD);
  s.description = `${s.description} A boy threw a ball, so the dog is jumping to get it.`;
  s.checklist[5].accept = "a boy threw a ball, so the dog is jumping to get it";
  // 主語は先頭の boy（throw のポーズ）。throw があるので通る
  assert.deepEqual(verifyItems("eiken-2", s, HARD_ITEMS, PARTS), []);
  s.description = `${s.description} The dog is sleeping so that it can rest.`;
  s.checklist[5].accept = "the dog is sleeping so that it can rest";
  assert.deepEqual(codes(verifyItems("eiken-2", s, HARD_ITEMS, PARTS)), [
    "action_mismatch",
  ]);
});

test("「歩道の上」と言う人が、重ねた道路の上に置かれていれば落ちる（座標に直して確かめる）", () => {
  const s: SceneSentences = {
    name: "道の自転車と転んだ女の人",
    description:
      "A woman has fallen down on the sidewalk. A bicycle is lying next to her. A girl is standing next to the road.",
    checklist: [
      check("woman_fallen", "center", "a woman has fallen down", ["woman"]),
      check("girl_stand", "center", "a girl is standing next to the road", [
        "girl",
        "road",
      ]),
      check(
        "woman_place",
        "detail",
        "a woman has fallen down on the sidewalk",
        ["woman", "sidewalk"],
      ),
    ],
  };
  const items = (zone: "center" | "front"): PlanItem[] => [
    { key: "sidewalk", part: "sidewalk_stone", place: { relation: "ground" } },
    {
      key: "road",
      part: "road_patch",
      place: { relation: "ground", zone: "back" },
    },
    {
      key: "woman",
      part: "person_fallen_woman_a",
      place: { relation: "ground", zone },
    },
    {
      key: "bicycle",
      part: "bicycle_down",
      place: { relation: "next_to", target: "woman" },
    },
    {
      key: "girl",
      part: "person_stand_girl_a",
      place: { relation: "ground", zone: "front_left" },
    },
  ];
  // 実例: 道路（奥行き 5.5 m）を奥に置くと真ん中の区画まで覆うので、真ん中の人は道路の上
  const problems = verifyPlaces(
    "eiken-pre2",
    { ...s, items: items("center") },
    PARTS,
  );
  assert.deepEqual(
    problems.map((p) => [p.code, p.stage, p.message]),
    [
      [
        "place_mismatch",
        "items",
        "項目 woman_place の accept「a woman has fallen down on the sidewalk」は woman が sidewalk の上にいると言うが、置いた位置は road（road_patch）の上。woman を sidewalk の上に置く",
      ],
    ],
  );
  // 手前の区画なら歩道の上。next to the road の項目は見ない
  assert.deepEqual(
    verifyPlaces("eiken-pre2", { ...s, items: items("front") }, PARTS),
    [],
  );
  // 道路の上と言うなら、真ん中で通る
  const onRoad = clone(s);
  onRoad.checklist[2] = check(
    "p",
    "detail",
    "a woman has fallen down on the road",
    ["woman", "road"],
  );
  assert.deepEqual(
    verifyPlaces("eiken-pre2", { ...onRoad, items: items("center") }, PARTS),
    [],
  );
});

test("場所の確かめは、部品までの裏取りを通った場面だけに掛ける", () => {
  // 地面が 1 枚だけの場面は、どこにいてもその上
  assert.deepEqual(
    verifyPlaces("eiken-3", { ...EASY, items: EASY_ITEMS }, PARTS),
    [],
  );
  // 英文で落ちる場面は、場所の理由を足さない
  const s = clone(EASY);
  s.checklist[2].accept = "there is a blue ball";
  assert.deepEqual(codes(all("eiken-3", s, EASY_ITEMS)), [
    "accept_not_in_description",
  ]);
});
