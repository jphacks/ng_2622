// ポーズの動詞と段階の表（src/scenes/pose-verbs.ts）と、級の定数（src/scenes/grades.ts）のテスト
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checklistSize,
  GRADES,
  grammarUpTo,
  kindsOf,
  withinLevel,
} from "../src/scenes/grades";
import { PARTS } from "../src/scenes/parts";
import {
  actionVocabulary,
  POSE_VERBS,
  poseLevel,
  poseVerbsIn,
  poseVerbsOf,
  postureOf,
  thingVocabulary,
  VERB_LEVELS,
  verbForms,
  verbLevel,
  verbsAbove,
} from "../src/scenes/pose-verbs";
import { GRADE_IDS } from "../src/scenes/types";

const living = PARTS.filter(
  (p) => p.category === "person" || p.category === "animal",
);
const part = (id: string) => {
  const p = PARTS.find((x) => x.id === id);
  assert.ok(p, `${id} が無い`);
  return p;
};

test("級の定数: CEFR・人の数・文の数・checklist の数が決定のとおり", () => {
  assert.deepEqual(Object.keys(GRADES), [...GRADE_IDS]);
  assert.deepEqual(
    GRADE_IDS.map((id) => GRADES[id].cefr),
    ["A1", "A2", "B1"],
  );
  assert.deepEqual(
    GRADE_IDS.map((id) => [GRADES[id].people.min, GRADES[id].people.max]),
    [
      [1, 2],
      [3, 3],
      [3, 4],
    ],
  );
  assert.deepEqual(
    GRADE_IDS.map((id) => [GRADES[id].sentences, GRADES[id].words]),
    [
      [3, 20],
      [5, 40],
      [6, 60],
    ],
  );
  assert.deepEqual(GRADES["eiken-3"].checklist, {
    center: 2,
    reason: 0,
    link: 0,
    detail: 1,
  });
  assert.deepEqual(GRADES["eiken-pre2"].checklist, {
    center: 3,
    reason: 1,
    link: 0,
    detail: 2,
  });
  assert.deepEqual(GRADES["eiken-2"].checklist, {
    center: 4,
    reason: 1,
    link: 1,
    detail: 2,
  });
  assert.deepEqual(GRADE_IDS.map(checklistSize), [3, 6, 8]);
});

test("級の定数: 文法は級ごとに 5〜8 個で、下の級の文法は上の級でも使える", () => {
  for (const id of GRADE_IDS) {
    const n = GRADES[id].grammar.length;
    assert.ok(n >= 5 && n <= 8, `${id} の文法が ${n} 個`);
  }
  const [low, mid, high] = GRADE_IDS.map(grammarUpTo);
  assert.deepEqual(mid.slice(0, low.length), low);
  assert.deepEqual(high.slice(0, mid.length), mid);
  assert.ok(high.length > mid.length && mid.length > low.length);
});

test("級の定数: その級に出てくる種類だけを返す", () => {
  assert.deepEqual(kindsOf("eiken-3"), ["center", "detail"]);
  assert.deepEqual(kindsOf("eiken-pre2"), ["center", "reason", "detail"]);
  assert.deepEqual(kindsOf("eiken-2"), ["center", "reason", "link", "detail"]);
});

test("段階の比べ方: 下の段階は上の段階に入る", () => {
  assert.ok(withinLevel("A1", "A1"));
  assert.ok(withinLevel("A1", "B1"));
  assert.ok(!withinLevel("A2", "A1"));
  assert.ok(!withinLevel("B2", "B1"));
});

test("人と動物の部品のポーズは、全部が表にある", () => {
  const missing = [
    ...new Set(living.map((p) => p.pose ?? `(${p.id} にポーズが無い)`)),
  ].filter((pose) => !POSE_VERBS[pose]);
  assert.deepEqual(missing, []);
});

test("表のポーズは、全部が今の部品にある（消えた部品の行を残さない）", () => {
  const poses = new Set(living.map((p) => p.pose));
  assert.deepEqual(
    Object.keys(POSE_VERBS).filter((pose) => !poses.has(pose)),
    [],
  );
});

test("表の動詞は全部に段階があり、どのポーズも 1 つ以上の動詞を持つ", () => {
  for (const [pose, { verbs, phrase }] of Object.entries(POSE_VERBS)) {
    assert.ok(verbs.length > 0, `${pose} の動詞が無い`);
    assert.ok(phrase.length > 0, `${pose} の言い方が無い`);
    for (const v of verbs) assert.ok(v in VERB_LEVELS, `${v} の段階が無い`);
  }
});

test("どの級にも、中心に使えるポーズがある（上の級ほど増える）", () => {
  const count = (id: (typeof GRADE_IDS)[number]) =>
    new Set(
      living
        .filter((p) => withinLevel(poseLevel(p), GRADES[id].cefr))
        .map((p) => p.pose),
    ).size;
  const [low, mid, high] = GRADE_IDS.map(count);
  assert.ok(low >= 20, `eiken-3 で使えるポーズが ${low} 種類`);
  assert.ok(mid >= low && high >= mid);
});

test("ポーズの段階は、いちばんやさしい動詞の段階", () => {
  // wipe は B2 だが clean（A1）で言える
  assert.equal(poseLevel(part("person_wipe_woman_a")), "A1");
  // 傘を差しかけるのは share（A1）でも言える
  assert.equal(poseLevel(part("person_umbrella_girl_a")), "A1");
  assert.equal(poseLevel(part("person_throw_boy_a")), "A1");
  assert.equal(poseLevel(part("person_wake_woman_a")), "A2");
});

test("表に無いポーズは、部品の words の動詞を使う。動詞も表に無ければ B2", () => {
  const known = {
    pose: "dance_new",
    words: [
      { word: "girl", pos: "noun" },
      { word: "run", pos: "verb" },
    ],
  };
  assert.deepEqual(poseVerbsOf(known), [{ verb: "run", level: "A1" }]);
  const unknown = {
    pose: "juggle",
    words: [
      { word: "man", pos: "noun" },
      { word: "juggle", pos: "verb" },
    ],
  };
  assert.deepEqual(poseVerbsOf(unknown), [{ verb: "juggle", level: "B2" }]);
  assert.equal(poseLevel(unknown), "B2");
  assert.equal(poseLevel({ words: [] }), "B2");
  assert.equal(verbLevel("juggle"), "B2");
});

test("動詞の形: -s・-ing・-ed・子音を重ねる形・不規則な形", () => {
  const has = (verb: string, forms: string[]) => {
    const all = verbForms(verb);
    for (const f of forms) assert.ok(all.has(f), `${verb} の形に ${f} が無い`);
  };
  has("run", ["run", "runs", "running", "ran"]);
  has("sit", ["sitting", "sat"]);
  has("write", ["writing", "writes", "wrote", "written"]);
  has("carry", ["carries", "carried", "carrying"]);
  has("clap", ["clapping", "clapped"]);
  has("wipe", ["wiping", "wiped"]);
  has("throw", ["throwing", "threw", "thrown"]);
  has("fall", ["falling", "fell", "fallen"]);
  has("catch", ["catches", "caught"]);
  has("look", ["looking", "looked"]);
  assert.ok(!verbForms("look").has("lookking"));
});

test("文の中のポーズの動詞を、形を変えても見つける", () => {
  const run = part("person_run_boy_a");
  assert.deepEqual(
    poseVerbsIn("A boy is running to the bus stop.", run).map((v) => v.verb),
    ["run"],
  );
  assert.deepEqual(
    poseVerbsIn("The boy ran away", run).map((v) => v.verb),
    ["run"],
  );
  assert.deepEqual(poseVerbsIn("a boy is standing", run), []);
  // 語の一部では当たらない（brunch の run）
  assert.deepEqual(poseVerbsIn("a boy is at brunch", run), []);
});

test("1 回目に渡す語彙: 動作ごとに動詞・段階・できる人が並び、部品の一覧よりずっと小さい", () => {
  const actions = actionVocabulary(PARTS);
  assert.ok(actions.includes("- run | run A1, hurry A2, rush B1, chase B2 | "));
  assert.ok(
    actions.includes("- blow out candles (sitting) | blow A1, sit A1 | girl"),
  );
  // 左右の違いだけのポーズは 1 行
  assert.equal(
    actions.split("\n").filter((l) => l.startsWith("- sit and look")).length,
    1,
  );
  // 部品の ID は出さない
  assert.ok(!actions.includes("person_"));
  const things = thingVocabulary(PARTS);
  for (const w of ["bench", "rain", "juice (こぼれたジュース)", "bus stop"]) {
    assert.ok(things.includes(w), `${w} が無い`);
  }
  assert.ok(!things.includes("man"));
  assert.ok(
    actions.length + things.length < JSON.stringify(PARTS).length / 5,
    "語彙が大きすぎる",
  );
});

test("姿勢: 座るポーズは腰の基準点を持つ人、立つポーズは走る・歩く・倒れる・ひざをつく以外の人", () => {
  const poses = (posture: "sit" | "stand" | null) =>
    [
      ...new Set(
        living.filter((p) => postureOf(p) === posture).map((p) => p.pose),
      ),
    ].sort();
  assert.deepEqual(poses("sit"), [
    "blow",
    "clap",
    "raise_hand",
    "read_sit",
    "sit",
    "sit_look_l",
    "sit_look_r",
    "sleep",
    "write",
  ]);
  // 立ちでも座りでもない: 動物と、走る・歩く・倒れる・ひざをつく人
  assert.deepEqual(poses(null), [
    "fallen",
    "kneel_build",
    "peck",
    "rest",
    "run",
    "run_bag",
    "run_phone",
    "run_umbrella",
    "walk",
  ]);
  // 残りは全部立ち。どのポーズも 1 つの姿勢に決まる
  const standing = poses("stand");
  assert.equal(standing.length, Object.keys(POSE_VERBS).length - 9 - 9);
  for (const pose of ["stand", "look", "phone", "wipe", "throw", "cook"]) {
    assert.ok(standing.includes(pose), pose);
  }
  // 犬の run は動物なので null、人の run も null
  assert.equal(postureOf(part("animal_sit_dog_a")), null);
  assert.equal(postureOf(part("person_run_boy_a")), null);
});

test("姿勢の動詞（stand・sit）は、表に書いていなくても言える動詞に入る", () => {
  const verbs = (id: string) => poseVerbsOf(part(id)).map((v) => v.verb);
  assert.ok(!POSE_VERBS.look.verbs.includes("stand"));
  assert.ok(verbs("person_look_girl_a").includes("stand"));
  assert.ok(verbs("person_phone_adult_a").includes("stand"));
  assert.ok(verbs("person_clap_adult_a").includes("sit"));
  assert.ok(verbs("person_sleep_teen_a").includes("sit"));
  // 表に元からあれば重ねない
  assert.equal(
    verbs("person_stand_boy_a").filter((v) => v === "stand").length,
    1,
  );
  // 走る人・転んだ人・動物には stand を足さない
  for (const id of [
    "person_run_boy_a",
    "person_walk_adult_a",
    "person_fallen_woman_a",
    "person_kneel_build_boy_a",
    "animal_run_dog_a",
  ]) {
    assert.ok(!verbs(id).includes("stand"), id);
  }
  // 転んだ人はうつ伏せに倒れている: lie で言え、sit とは言わない
  assert.ok(verbs("person_fallen_woman_a").includes("lie"));
  assert.ok(!verbs("person_fallen_woman_a").includes("sit"));
  assert.match(POSE_VERBS.fallen.phrase, /lying/);
  // stand は A2 のまま
  assert.deepEqual(
    poseVerbsIn("a girl is standing", part("person_look_girl_a")),
    [{ verb: "stand", level: "A2" }],
  );
});

test("級で中心に使えない動詞の一覧は、上の級ほど短い", () => {
  const [low, mid, high] = (["A1", "A2", "B1"] as const).map((l) =>
    verbsAbove(l, PARTS),
  );
  for (const v of ["stand", "throw", "hold", "wipe"])
    assert.ok(low.includes(v));
  assert.ok(!low.includes("run") && !low.includes("wait"));
  assert.ok(!mid.includes("stand") && mid.includes("wake"));
  assert.deepEqual(high, [
    "chase",
    "clap",
    "kneel",
    "peck",
    "poke",
    "sweep",
    "trip",
    "wipe",
  ]);
  assert.ok(low.length > mid.length && mid.length > high.length);
});
