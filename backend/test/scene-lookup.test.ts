// 部品を ID の規約で引く 2 回目（scenes/lookup.ts）と、苦手の種類の選び方（scenes/weak.ts）のテスト
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PartOrder } from "../src/parts/workshop";
import {
  bundledThing,
  MAX_NEW_PARTS,
  nearestLiving,
  notAThing,
  parseLivingId,
  resolveParts,
} from "../src/scenes/lookup";
import { PARTS } from "../src/scenes/parts";
import type { Part, PlanItem } from "../src/scenes/types";
import { pickFocus, WEAK_NEW_THINGS, weakText } from "../src/scenes/weak";

const LAMP: PartOrder = {
  id: "lamp_street",
  category: "thing",
  label: "街灯",
  words: ["lamp", "street lamp"],
  size: [0.4, 3, 0.4],
  description: "A tall black street lamp with a round white light.",
};

const madeMeta = (o: PartOrder, version = 1): Part => ({
  id: o.id,
  version,
  file: `parts/${o.id}/${version}.usdz`,
  category: o.category,
  words: o.words.map((word) => ({ word, pos: "noun" })),
  size: o.size,
  label: o.label,
});

test("狙う種類は、kinds のうちその級に有る最初の種類。級に無い種類は飛ばし、どれも無ければ center", () => {
  assert.equal(pickFocus("eiken-3", ["reason", "link", "detail"]), "detail");
  assert.equal(pickFocus("eiken-3", ["link", "center"]), "center");
  assert.equal(pickFocus("eiken-pre2", ["link", "reason"]), "reason");
  assert.equal(pickFocus("eiken-2", ["link", "reason"]), "link");
  assert.equal(pickFocus("eiken-3", ["reason", "link"]), "center");
  assert.equal(pickFocus("eiken-2", ["detail"]), "detail");
});

test("人・動物の ID は動作と誰に分け、同梱に無ければ誰と動作が最も近い部品に寄せる", () => {
  assert.deepEqual(parseLivingId("person_read_sit_man_a"), {
    category: "person",
    pose: "read_sit",
    who: "man",
  });
  assert.deepEqual(parseLivingId("person_stand_old_woman_a"), {
    category: "person",
    pose: "stand",
    who: "oldwoman",
  });
  assert.deepEqual(parseLivingId("person_stand_old_a"), {
    category: "person",
    pose: "stand",
    who: "oldman",
  });
  assert.deepEqual(parseLivingId("animal_bird_a"), {
    category: "animal",
    pose: "",
    who: "bird",
  });
  assert.equal(parseLivingId("ball_red"), null);
  const near = (id: string) => {
    const parsed = parseLivingId(id);
    assert.ok(parsed, id);
    return nearestLiving(parsed, PARTS)?.id;
  };
  assert.equal(near("person_read_sit_man_a"), "person_read_sit_adult_a");
  assert.equal(near("person_drink_man_a"), "person_drink_adult_a");
  assert.equal(near("person_cook_woman_a"), "person_cook_mother_a");
  // 誰を先に守る（女の子は女の子のまま、近い動作に）
  const girl = PARTS.find((p) => p.id === near("person_drink_girl_a"));
  assert.equal(girl?.words[0].word, "girl");
  assert.equal(near("animal_run_dog_a"), "animal_run_dog_a");
  assert.equal(near("animal_rest_dog_a"), "animal_sit_dog_a");
  assert.equal(near("animal_peck_bird_a"), "animal_bird_a");
  assert.equal(near("person_feed_oldman_a"), "person_feed_old_a");
});

test("物の ID は、同梱の名前に合えばそれ（ball → ball_red）。区別の違う物は合わない", () => {
  assert.equal(bundledThing("ball", PARTS)?.id, "ball_red");
  assert.equal(bundledThing("trash_can", PARTS)?.id, "trash_bin");
  assert.equal(bundledThing("phone", PARTS)?.id, "smartphone");
  assert.equal(bundledThing("table", PARTS)?.id, "table");
  assert.equal(bundledThing("apple_green", PARTS), undefined);
  assert.equal(bundledThing("teapot", PARTS), undefined);
});

test("規約で引く: 同梱・寄せる・前に作った部品（R2）・注文で作る・注文が無い・上限・断る物", async () => {
  const teapot = madeMeta({ ...LAMP, id: "teapot", words: ["teapot"] }, 2);
  const lookup = async (id: string) => (id === "teapot" ? teapot : null);
  const items: PlanItem[] = [
    { key: "g", part: "grass_patch", place: { relation: "ground" } },
    { key: "m", part: "person_drink_man_a", place: { relation: "ground" } },
    { key: "b", part: "ball", place: { relation: "ground" } },
    { key: "t", part: "teapot", place: { relation: "ground" } },
    { key: "l", part: "lamp_street", place: { relation: "ground" } },
  ];
  const ok = await resolveParts(items, [LAMP], PARTS, lookup);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(
    ok.items.map((i) => i.part),
    [
      "grass_patch",
      "person_drink_adult_a",
      "ball_red",
      "teapot",
      "lamp_street",
    ],
  );
  assert.deepEqual(
    ok.found.map((p) => p.id),
    ["teapot"],
  );
  assert.deepEqual(
    ok.orders.map((o) => o.id),
    ["lamp_street"],
  );

  // 注文が無い物
  const missing = await resolveParts(items, [], PARTS, lookup);
  assert.deepEqual(
    missing.problems.map((p) => p.code),
    ["unknown_part"],
  );
  assert.ok(missing.problems[0].message.includes("lamp_street"));

  // 上限（同梱に無い部品は 1 場面 4 個まで）
  const many = ["kite", "lamp", "vase", "drum", "fan"].map((id) => ({
    ...LAMP,
    id,
    words: [id],
  }));
  const tooMany = await resolveParts(
    many.map((o) => ({
      key: o.id,
      part: o.id,
      place: { relation: "ground" as const },
    })),
    many,
    PARTS,
    async () => null,
  );
  assert.deepEqual(
    tooMany.problems.map((p) => p.code),
    ["too_many_new_parts"],
  );

  // 武器（id・words・label・description のどこにあっても。部品を作る口と同じ網）・規約の形でない ID・地面（芝生など）・
  // 形の違う注文（words が 6 個）は、作る前に断る
  for (const order of [
    { ...LAMP, id: "toy_gun", words: ["gun"] },
    { ...LAMP, id: "toy", words: ["toy"], description: "A black toy pistol." },
    { ...LAMP, id: "toy_box", words: ["toy"], label: "おもちゃのピストル" },
    { ...LAMP, id: "Lamp-1" },
    { ...LAMP, id: "grass_tuft", words: ["grass"] },
    { ...LAMP, id: "lamp_big", words: ["a", "b", "c", "d", "e", "f"] },
  ]) {
    const refused = await resolveParts(
      [{ key: "x", part: order.id, place: { relation: "ground" } }],
      [order],
      PARTS,
      async () => null,
    );
    assert.deepEqual(
      refused.problems.map((p) => p.code),
      ["bad_part_order"],
      order.id,
    );
    assert.deepEqual(refused.orders, []);
  }
});

test("作れない物（武器など）は英文から書き直させ（stage sentences）、形の違う注文は 2 回目だけ書き直させる", async () => {
  const resolve = (order: PartOrder) =>
    resolveParts(
      [{ key: "x", part: order.id, place: { relation: "ground" } }],
      [order],
      PARTS,
      async () => null,
    );
  const weapon = await resolve({ ...LAMP, id: "sword", words: ["sword"] });
  assert.equal(weapon.problems[0].stage, "sentences");
  assert.ok(weapon.problems[0].message.includes("この物を使わない場面にする"));
  const shape = await resolve({ ...LAMP, id: "lamp_big", label: "" });
  assert.equal(shape.problems[0].stage, "items");
});

test("作れない道（canMake が false）では、注文があっても同梱に無い物は問題にし、前に作った部品も引かない", async () => {
  let looked = 0;
  const result = await resolveParts(
    [
      { key: "g", part: "grass_patch", place: { relation: "ground" } },
      { key: "l", part: "lamp_street", place: { relation: "ground" } },
    ],
    [LAMP],
    PARTS,
    async () => {
      looked++;
      return null;
    },
    4,
    false,
  );
  assert.deepEqual(
    result.problems.map((p) => p.code),
    ["unknown_part"],
  );
  assert.ok(result.problems[0].message.includes("部品を作れない"));
  assert.deepEqual(result.orders, []);
  assert.equal(looked, 0, "前に作った部品も引かない");
});

test("人・動物・建物を「物」として注文したら、作らずに英文から書き直させる（語の一部では断らない）", async () => {
  const resolve = (order: PartOrder) =>
    resolveParts(
      [{ key: "x", part: order.id, place: { relation: "ground" } }],
      [order],
      PARTS,
      async () => null,
    );
  for (const order of [
    { ...LAMP, id: "boy_small", words: ["boy"] },
    { ...LAMP, id: "cat", words: ["cat"] },
    { ...LAMP, id: "pet", words: ["kitten"] },
    { ...LAMP, id: "dog_brown", words: ["brown dog"] },
    { ...LAMP, id: "door_red", words: ["door"] },
    { ...LAMP, id: "house", words: ["house"] },
  ]) {
    const result = await resolve(order);
    assert.deepEqual(
      result.problems.map((p) => [p.code, p.stage]),
      [["bad_part_order", "sentences"]],
      order.id,
    );
    assert.deepEqual(result.orders, [], order.id);
  }
  // 語の一部・物の語は断らない（door mat・bus・menu）
  for (const order of [
    { ...LAMP, id: "mat_door", words: ["door mat"] },
    { ...LAMP, id: "bus", category: "vehicle" as const, words: ["bus"] },
    { ...LAMP, id: "menu_card", words: ["menu"] },
  ]) {
    const result = await resolve(order);
    assert.deepEqual(result.problems, [], order.id);
    assert.deepEqual(
      result.orders.map((o) => o.id),
      [order.id],
    );
  }
  // 生き物を断る文は、生きている人・動物そのものを置きたいときだけ person_・animal_ に書かせる（おもちゃ・食べ物は物でよい）
  const dog = await resolve({ ...LAMP, id: "dog_brown", words: ["brown dog"] });
  assert.ok(
    dog.problems[0].message.includes(
      "生きている人・動物そのものを置きたいときだけ",
    ),
  );
  assert.ok(dog.problems[0].message.includes("物として注文してよい"));
});

test("物かどうかは英語の主の名詞（words の各句の最後の語）で決める。おもちゃ・食べ物・道具・敷物は通し、生き物そのもの・建物・地面は断る", async () => {
  type Case = {
    id: string;
    words: string[];
    category?: PartOrder["category"];
  };
  const verdict = ({ id, words, category = "thing" }: Case) =>
    notAThing({ id, words, category }, PARTS)?.what ?? "ok";
  const pass: Case[] = [
    { id: "fish_tank", words: ["fish tank"] },
    { id: "bird_cage", words: ["bird cage"] },
    { id: "dog_bowl", words: ["dog bowl"] },
    { id: "student_desk", words: ["student desk"], category: "furniture" },
    { id: "teacher_desk", words: ["teacher desk"], category: "furniture" },
    { id: "mat_door", words: ["door mat"] },
    { id: "window_box", words: ["window box"] },
    { id: "chicken", words: ["chicken"], category: "food" },
    {
      id: "chicken_fried",
      words: ["fried chicken", "chicken"],
      category: "food",
    },
    { id: "fish", words: ["fish"], category: "food" },
    { id: "fish_grilled", words: ["grilled fish", "fish"], category: "food" },
    { id: "sushi", words: ["sushi", "fish"], category: "food" },
    { id: "goat_cheese", words: ["goat cheese"], category: "food" },
    { id: "teddy_bear", words: ["teddy bear"] },
    { id: "bear_teddy", words: ["teddy bear", "bear"] },
    { id: "duck_rubber", words: ["rubber duck"] },
    { id: "duck_rubber", words: ["rubber duck", "duck"] },
    { id: "horse_rocking", words: ["rocking horse"] },
    { id: "puppy_toy", words: ["toy puppy"] },
    { id: "mouse_computer", words: ["computer mouse"] },
    { id: "baby_stroller", words: ["baby stroller"] },
    { id: "carpet", words: ["carpet", "rug"] },
    { id: "rug_round", words: ["round rug"] },
    { id: "lamp_street", words: ["lamp", "street lamp"] },
    { id: "ball_beach", words: ["beach ball"] },
    { id: "bus", words: ["bus"], category: "vehicle" },
    { id: "boxes", words: ["boxes"] },
    // 家の形の物（家の前に様子・材質でない語が付く）
    { id: "house_bird", words: ["bird house"] },
    { id: "house_bird", words: ["bird house", "house"] },
    { id: "house_dog", words: ["dog house"] },
    { id: "house_doll", words: ["doll house"] },
    // 「X of Y」の主は X
    { id: "bucket_sand", words: ["bucket of sand"] },
    { id: "picture_house", words: ["picture of a house"] },
    { id: "statue_man", words: ["statue of a man"] },
    { id: "cup_tea", words: ["cup of tea"] },
  ];
  const refuse: [Case, string][] = [
    [{ id: "dog_brown", words: ["brown dog"] }, "living"],
    [{ id: "dog_brown", words: ["brown dog", "dog"] }, "living"],
    [{ id: "cat", words: ["cat"] }, "living"],
    [{ id: "cats", words: ["cats"] }, "living"],
    [{ id: "horse", words: ["horse"] }, "living"],
    [{ id: "man_old", words: ["old man"] }, "living"],
    [{ id: "puppies", words: ["little puppies"] }, "living"],
    [{ id: "chicken", words: ["chicken"] }, "living"],
    [{ id: "wall_brick", words: ["brick wall"] }, "building"],
    [{ id: "door_wooden", words: ["wooden door"] }, "building"],
    [{ id: "window_round", words: ["round window"] }, "building"],
    [{ id: "house", words: ["house"] }, "building"],
    [{ id: "house_brick", words: ["brick house"] }, "building"],
    [{ id: "house_big", words: ["big house", "home"] }, "building"],
    // 部屋は前に何が付いても部屋（living room・waiting room）
    [{ id: "room_living", words: ["living room"] }, "building"],
    [{ id: "windows", words: ["windows"] }, "building"],
    [{ id: "grass", words: ["grass"] }, "ground"],
    [{ id: "grass_tuft", words: ["grass tuft", "grass"] }, "ground"],
    [{ id: "lawn", words: ["green lawn"] }, "ground"],
    [{ id: "floor_wood", words: ["wooden floor"] }, "ground"],
    // words が無ければ id の先頭の語で決める
    [{ id: "dog_brown", words: [] }, "living"],
    [{ id: "wall_brick", words: [""] }, "building"],
  ];
  for (const c of pass) {
    assert.equal(verdict(c), "ok", c.words.join("/"));
    // 注文として通しても、部品を作る口と同じ網（refusedTerm・orderProblem）にかからない
    const order = {
      ...LAMP,
      id: c.id,
      words: c.words,
      category: c.category ?? "thing",
    };
    const result = await resolveParts(
      [{ key: "x", part: order.id, place: { relation: "ground" } }],
      [order],
      PARTS,
      async () => null,
    );
    assert.deepEqual(result.problems, [], c.words.join("/"));
  }
  for (const [c, what] of refuse) {
    assert.equal(verdict(c), what, `${c.id} ${c.words.join("/")}`);
  }
  // id と words が食い違えば words の主の名詞（fish_tank の words が tank なら物）
  assert.equal(verdict({ id: "fish_tank", words: ["tank"] }), "ok");
  assert.equal(verdict({ id: "fish", words: [] }), "living");
});

test("新しい物の数は、1 回目の指示・2 回目とコードの上限でそろえる（4 個）", () => {
  assert.equal(WEAK_NEW_THINGS, MAX_NEW_PARTS);
  assert.equal(MAX_NEW_PARTS, 4);
  const text = weakText({ kind: "center", habits: [] }, "eiken-3");
  assert.ok(text.includes("you may also use up to 4 concrete everyday things"));
});
