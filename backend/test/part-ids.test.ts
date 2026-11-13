// 部品の ID の規約（src/parts/ids.ts）
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isBundledPart,
  isObjectId,
  parsePartId,
  parsePartRef,
  partRef,
} from "../src/parts/ids";
import { PARTS } from "../src/scenes/parts";

test("同梱の部品の ID はすべて規約（物・人・動物）のどれかに合う", () => {
  const off = PARTS.filter((p) => parsePartId(p.id) === null).map((p) => p.id);
  assert.deepEqual(off, []);
  // 人と動物の category の部品は、人と動物の形
  for (const p of PARTS) {
    const kind = parsePartId(p.id)?.kind;
    if (p.category === "person") assert.equal(kind, "person", p.id);
    if (p.category === "animal") assert.equal(kind, "animal", p.id);
  }
});

test("ID を規約で分ける", () => {
  assert.deepEqual(parsePartId("person_raise_hand_boy_a"), {
    kind: "person",
    action: "raise_hand",
    who: "boy",
    variant: "a",
  });
  assert.deepEqual(parsePartId("animal_run_dog_a"), {
    kind: "animal",
    action: "run",
    species: "dog",
    variant: "a",
  });
  assert.deepEqual(parsePartId("animal_bird_a"), {
    kind: "animal",
    species: "bird",
    variant: "a",
  });
  assert.deepEqual(parsePartId("apple_red"), {
    kind: "object",
    noun: "apple",
    qualifier: "red",
  });
  assert.deepEqual(parsePartId("globe"), { kind: "object", noun: "globe" });
  for (const bad of ["Globe", "globe_2", "a_b_c_d", "person_x", "", "_a"]) {
    assert.equal(parsePartId(bad), null, bad);
  }
});

test("作る部品の ID は物の規約に合い、32 文字までで、person_・animal_ で始まらない", () => {
  assert.ok(isObjectId("umbrella_stand"));
  assert.ok(isObjectId("lunch_box_blue"));
  assert.ok(!isObjectId("lunch_box_blue_big"));
  assert.ok(!isObjectId("person_stand"));
  assert.ok(!isObjectId("animal_cat"));
  assert.ok(!isObjectId(`${"a".repeat(30)}_bc`));
  assert.ok(isBundledPart("chair"));
  assert.ok(!isBundledPart("umbrella_stand"));
});

test("配置の部品の参照（id か id@版）", () => {
  assert.deepEqual(parsePartRef("chair"), { id: "chair" });
  assert.deepEqual(parsePartRef("umbrella_stand@2"), {
    id: "umbrella_stand",
    version: 2,
  });
  assert.equal(parsePartRef("chair@0"), null);
  assert.equal(parsePartRef("chair@"), null);
  assert.equal(partRef("globe", 1), "globe@1");
});
