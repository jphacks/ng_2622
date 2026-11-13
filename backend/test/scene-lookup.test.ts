// 部品を ID の規約で引く 2 回目（scenes/lookup.ts）と、苦手の種類の選び方（scenes/weak.ts）のテスト
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PartOrder } from "../src/parts/workshop";
import {
  bundledThing,
  nearestLiving,
  parseLivingId,
  resolveParts,
} from "../src/scenes/lookup";
import { PARTS } from "../src/scenes/parts";
import type { Part, PlanItem } from "../src/scenes/types";
import { pickFocus } from "../src/scenes/weak";

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

  // 武器・規約の形でない ID・同梱と重なる注文は断る
  for (const order of [
    { ...LAMP, id: "toy_gun", words: ["gun"] },
    { ...LAMP, id: "Lamp-1" },
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
    );
  }
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
