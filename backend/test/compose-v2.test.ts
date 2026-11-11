// /2 の配置の JSON を作る関数（src/scenes/compose-v2.ts）のテスト
import assert from "node:assert/strict";
import { test } from "node:test";
import { composeItems } from "../src/scenes/compose";
import { composeLayoutV2 } from "../src/scenes/compose-v2";
import { EXAMPLE_ITEMS, EXAMPLE_SENTENCES } from "../src/scenes/generate-v2";
import { PARTS } from "../src/scenes/parts";
import type { PlanItem, ScenePlanV2 } from "../src/scenes/types";

const PLAN: ScenePlanV2 = { ...EXAMPLE_SENTENCES, items: EXAMPLE_ITEMS };
const META = { id: "gen-0123456789", grade: "eiken-pre2" } as const;

test("上の階層は /2 の形（elements・extraMax は無く、checklist がある）", () => {
  const layout = composeLayoutV2(PLAN, PARTS, META);
  assert.deepEqual(Object.keys(layout), [
    "protocol",
    "id",
    "name",
    "difficulty",
    "description",
    "checklist",
    "items",
  ]);
  assert.equal(layout.protocol, "scenenglish.scene/2");
  assert.equal(layout.id, "gen-0123456789");
  assert.equal(layout.name, "雨のバス停");
  assert.equal(layout.difficulty, "eiken-pre2");
  assert.equal(layout.description, EXAMPLE_SENTENCES.description);
  assert.deepEqual(layout.checklist, EXAMPLE_SENTENCES.checklist);
  // 重みは保存しない
  for (const c of layout.checklist) {
    assert.deepEqual(Object.keys(c), ["id", "kind", "label", "accept", "refs"]);
  }
});

test("items は、Claude が書いた関係と計算した座標の両方を持つ", () => {
  const layout = composeLayoutV2(PLAN, PARTS, META);
  assert.deepEqual(
    layout.items.map((i) => i.key),
    EXAMPLE_ITEMS.map((i) => i.key),
  );
  for (const [n, item] of layout.items.entries()) {
    assert.deepEqual(item.place, EXAMPLE_ITEMS[n].place);
    assert.equal(item.position.length, 3);
  }
  const man = layout.items.find((i) => i.key === "man");
  assert.deepEqual(man?.place, { relation: "sit_on", target: "bench" });
});

test("座標は composeItems（compose.ts）が計算したもの", () => {
  const v2 = composeLayoutV2(PLAN, PARTS, META);
  const placed = composeItems(PLAN.items, PARTS);
  assert.deepEqual(
    v2.items.map((i) => [i.key, i.part, i.position, i.yaw]),
    placed.map((i) => [i.key, i.part, i.position, i.yaw]),
  );
});

test("動きは 1 つの motion に、座標（to）と関係（toward・path）を並べる", () => {
  const layout = composeLayoutV2(PLAN, PARTS, META);
  const boy = layout.items.find((i) => i.key === "boy");
  assert.equal(boy?.motion?.type, "move");
  assert.equal(boy?.motion?.toward, "bench");
  assert.equal(boy?.motion?.duration, 5);
  assert.equal(boy?.motion?.to?.length, 3);
  // 動きの無い部品に motion は付かない
  assert.equal(layout.items.find((i) => i.key === "man")?.motion, undefined);
});

test("facing は書いてあれば残し、無ければ欄を作らない", () => {
  const items: PlanItem[] = [
    { key: "ground", part: "grass_patch", place: { relation: "ground" } },
    {
      key: "man",
      part: "person_walk_adult_a",
      place: { relation: "ground", zone: "center" },
      facing: "left",
    },
    { key: "tree", part: "tree", place: { relation: "ground", zone: "back" } },
  ];
  const layout = composeLayoutV2({ ...PLAN, items }, PARTS, META);
  assert.equal(layout.items[1].facing, "left");
  assert.ok(!("facing" in layout.items[2]));
});

test("一覧に無い部品は飛ばし、残りの関係と座標がずれない", () => {
  const items: PlanItem[] = [
    EXAMPLE_ITEMS[0],
    { key: "cat", part: "animal_cat_a", place: { relation: "ground" } },
    ...EXAMPLE_ITEMS.slice(1),
  ];
  const layout = composeLayoutV2({ ...PLAN, items }, PARTS, META);
  assert.deepEqual(
    layout.items.map((i) => [i.key, i.place]),
    EXAMPLE_ITEMS.map((i) => [i.key, i.place]),
  );
});

test("JSON にして読み戻しても同じ（undefined の欄を残さない）", () => {
  const layout = composeLayoutV2(PLAN, PARTS, META);
  assert.deepEqual(JSON.parse(JSON.stringify(layout)), layout);
});
