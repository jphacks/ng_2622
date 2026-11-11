// 場面が似すぎないようにする材料と数え方（src/scenes/variety.ts）のテスト
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLE_ITEMS, EXAMPLE_SENTENCES } from "../src/scenes/generate-v2";
import { PARTS } from "../src/scenes/parts";
import type { PlanItem, ScenePlanV2 } from "../src/scenes/types";
import {
  causesOf,
  countCauses,
  MAX_SAME_CAUSE,
  missingSeedNeeds,
  overusedCauses,
  reasonSeeds,
  summarizeScene,
} from "../src/scenes/variety";

const RAINY: ScenePlanV2 = { ...EXAMPLE_SENTENCES, items: EXAMPLE_ITEMS };
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
// 転んだ人を助ける場面（理由の原因は人）と、投げたボールを犬が追う場面（つながりの原因は物と人）
const PARK: ScenePlanV2 = {
  name: "公園",
  description:
    "A man is helping a woman because she has fallen down. A boy threw a ball, so the dog is running to get it.",
  checklist: [
    {
      id: "why_help",
      kind: "reason",
      label: "助けている理由",
      accept: "a man is helping a woman because she has fallen down",
      refs: ["man", "woman"],
    },
    {
      id: "ball_dog",
      kind: "link",
      label: "犬が走る",
      accept: "a boy threw a ball, so the dog is running to get it / x",
      refs: ["dog", "ball", "boy"],
    },
  ],
  items: [
    ground,
    item("man", "person_help_up_adult_a"),
    item("woman", "person_fallen_woman_a"),
    item("dog", "animal_run_dog_a"),
    item("ball", "ball_red"),
    item("boy", "person_throw_boy_a"),
  ],
};

test("理由にできる見える出来事は、今の部品で描けるものを全部並べる", () => {
  // 材料に書いたポーズと部品が、今の一覧から消えていない
  assert.deepEqual(missingSeedNeeds(PARTS), []);
  const seeds = reasonSeeds(PARTS).split("\n");
  assert.ok(seeds.length >= 20, `${seeds.length} 個`);
  for (const line of seeds) assert.match(line, /^- .+ -> .+/);
  // 雨と転んだ人だけにならないよう、ほかの原因が先に並ぶ
  assert.ok(!seeds[0].includes("rain") && !seeds[0].includes("fallen"));
  assert.ok(seeds.at(-1)?.includes("rain (outdoor scenes only)"));
  // 部品の ID は出さない
  assert.ok(!reasonSeeds(PARTS).includes("_a"));
});

test("部品が無い出来事は並べない", () => {
  const few = PARTS.filter((p) => p.id !== "rain" && p.pose !== "wake");
  const seeds = reasonSeeds(few);
  assert.ok(!/\brain\b/.test(seeds));
  assert.ok(!seeds.includes("wakes him"));
  assert.ok(seeds.includes("a boy throws a ball"));
  assert.deepEqual(missingSeedNeeds(few).sort(), ["rain", "wake"]);
});

test("場面の要約: 名前・中心の動作・理由（別の言い方は 1 つ目だけ）", () => {
  assert.equal(
    summarizeScene(EXAMPLE_SENTENCES),
    "雨のバス停: a girl is holding an umbrella; a boy is running; a man is reading a book | reason: a boy is running to the bus stop because it is raining",
  );
  // 理由の無い級は中心だけ
  assert.equal(
    summarizeScene({
      name: "公園",
      description: "",
      checklist: [EXAMPLE_SENTENCES.checklist[0]],
    }),
    "公園: a girl is holding an umbrella",
  );
});

test("理由の原因: 行動する人以外の refs。物は部品の id、人はポーズ", () => {
  assert.deepEqual(causesOf(RAINY, PARTS), ["rain"]);
  assert.deepEqual(causesOf(PARK, PARTS), ["fallen", "ball_red", "throw"]);
  // items に無い呼び名は数えない
  assert.deepEqual(causesOf({ ...RAINY, items: [] }, PARTS), []);
});

test("原因ごとの場面の数を数え、上限を超えた原因を多い順に返す", () => {
  assert.equal(MAX_SAME_CAUSE, 3);
  const scenes = [RAINY, RAINY, RAINY, RAINY, PARK, PARK];
  assert.deepEqual(Object.fromEntries(countCauses(scenes, PARTS)), {
    rain: 4,
    fallen: 2,
    ball_red: 2,
    throw: 2,
  });
  assert.deepEqual(overusedCauses(scenes, PARTS), [
    { cause: "rain", count: 4 },
  ]);
  assert.deepEqual(overusedCauses(scenes.slice(1), PARTS), []);
  assert.deepEqual(overusedCauses(scenes, PARTS, 1), [
    { cause: "rain", count: 4 },
    { cause: "ball_red", count: 2 },
    { cause: "fallen", count: 2 },
    { cause: "throw", count: 2 },
  ]);
});
