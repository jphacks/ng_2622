// 関係 → 座標の計算（src/scenes/compose.ts）のテスト。pnpm test で動かす
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ABOVE_GAP,
  composeLayout,
  EXTRA_MAX,
  GAP,
  HALF,
  MIN_MOVE,
  normalizePoints,
  zoneCenter,
} from "../src/scenes/compose";
import parts from "../src/scenes/parts.json" with { type: "json" };
import type {
  LayoutItem,
  Part,
  PlanItem,
  SceneElementInput,
} from "../src/scenes/types";

const PARTS = parts as Part[];
const part = (id: string) => PARTS.find((p) => p.id === id) as Part;

const ELEMENTS: SceneElementInput[] = [
  { id: "a", label: "あ", points: 1, accept: "a" },
];

const compose = (items: PlanItem[], elements = ELEMENTS) =>
  composeLayout(
    { name: " テスト ", description: " A test. ", items, elements },
    PARTS,
    { id: "gen-test000000", difficulty: "easy" },
  );

const toOf = (item: LayoutItem) => item.motion?.to ?? [Number.NaN, 0, 0];

const byKey = (items: LayoutItem[], key: string) =>
  items.find((i) => i.key === key) as LayoutItem;

const close = (actual: number, expected: number, msg?: string) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-3,
    `${msg ?? ""} ${actual} ≠ ${expected}`,
  );

const GRASS: PlanItem = {
  key: "grass",
  part: "grass_patch",
  place: { relation: "ground" },
};

/** 上から見た外接する箱（yaw が 0・±90・180 のとき） */
const box = (item: LayoutItem) => {
  const s = part(item.part).size;
  const turned = Math.abs(Math.abs(item.yaw ?? 0) - 90) < 1e-6;
  const [w, d] = turned ? [s[2], s[0]] : [s[0], s[2]];
  return {
    x0: item.position[0] - w / 2,
    x1: item.position[0] + w / 2,
    z0: item.position[2] - d / 2,
    z1: item.position[2] + d / 2,
  };
};
const overlap = (a: LayoutItem, b: LayoutItem) => {
  const p = box(a);
  const q = box(b);
  return p.x0 < q.x1 && q.x0 < p.x1 && p.z0 < q.z1 && q.z0 < p.z1;
};

describe("区画と地面", () => {
  test("9 区画の真ん中", () => {
    assert.deepEqual(zoneCenter("center"), [0, 0]);
    const [x, z] = zoneCenter("front_left");
    close(x, -8 / 3);
    close(z, 8 / 3, "front はカメラ側（+Z）");
    close(zoneCenter("back")[1], -8 / 3);
    close(zoneCenter("right")[0], 8 / 3);
  });

  test("地面の部品は真ん中に敷き、はみ出さない", () => {
    const layout = compose([
      GRASS,
      {
        key: "road",
        part: "road_patch",
        place: { relation: "ground", zone: "back" },
      },
    ]);
    assert.deepEqual(byKey(layout.items, "grass").position, [0, 0, 0]);
    // 道路は奥行き 5.5 m なので、奥の区画でも z は -(4 - 2.75) まで
    assert.deepEqual(byKey(layout.items, "road").position, [0, 0, -1.25]);
  });

  test("背景の壁は区画・向きにかかわらず奥の端に付け、後から置く物は壁の手前に出す", () => {
    const layout = compose([
      { key: "floor", part: "floor_wood", place: { relation: "ground" } },
      {
        key: "wall",
        part: "wall_window",
        place: { relation: "ground", zone: "front_left" },
        facing: "table",
      },
      {
        key: "table",
        part: "table",
        place: { relation: "ground", zone: "back" },
      },
    ]);
    const wall = byKey(layout.items, "wall");
    // z = -4 + 奥行き 0.28 / 2
    assert.deepEqual(wall.position, [0, 0, -3.86]);
    assert.equal(wall.yaw, undefined, "表（+Z）をカメラに向ける");
    const table = byKey(layout.items, "table");
    assert.ok(!overlap(wall, table));
    assert.ok(box(table).z0 >= box(wall).z1, "机は壁の手前");
  });

  test("ground は区画の真ん中に置き、同じ区画の物は size で重ならないよう並べる", () => {
    const layout = compose([
      GRASS,
      {
        key: "b1",
        part: "bench",
        place: { relation: "ground", zone: "back_left" },
      },
      {
        key: "b2",
        part: "bench",
        place: { relation: "ground", zone: "back_left" },
      },
      {
        key: "b3",
        part: "bench",
        place: { relation: "ground", zone: "back_left" },
      },
    ]);
    const [b1, b2, b3] = ["b1", "b2", "b3"].map((k) => byKey(layout.items, k));
    const [cx, cz] = zoneCenter("back_left");
    close(b1.position[0], Math.round(cx / 0.25) * 0.25, "1 つ目は区画の真ん中");
    close(b1.position[2], Math.round(cz / 0.25) * 0.25);
    assert.equal(b1.position[1], 0);
    assert.ok(!overlap(b1, b2) && !overlap(b1, b3) && !overlap(b2, b3));
  });

  test("知らない target は無視して区画の真ん中に置く", () => {
    const layout = compose([
      GRASS,
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "on", target: "nothing", zone: "front" },
      },
    ]);
    const ball = byKey(layout.items, "ball");
    assert.equal(ball.position[1], 0);
    close(ball.position[0], 0);
    close(ball.position[2], 2.75, "front の真ん中 8/3 に近い格子の点");
  });

  test("x・z は -4〜4 に収める（部品がはみ出さない範囲）", () => {
    const layout = compose([
      GRASS,
      {
        key: "car",
        part: "car",
        place: { relation: "ground", zone: "front_right" },
      },
      {
        key: "car2",
        part: "car",
        place: { relation: "next_to", target: "car" },
      },
      {
        key: "car3",
        part: "car",
        place: { relation: "next_to", target: "car2" },
      },
    ]);
    for (const item of layout.items) {
      const b = box(item);
      assert.ok(b.x0 >= -HALF - 1e-6 && b.x1 <= HALF + 1e-6, `${item.key} x`);
      assert.ok(b.z0 >= -HALF - 1e-6 && b.z1 <= HALF + 1e-6, `${item.key} z`);
    }
  });
});

describe("上・中・下", () => {
  test("on: 机の上のリンゴの y は机の top（0.72）", () => {
    const layout = compose([
      GRASS,
      { key: "table", part: "table", place: { relation: "ground" } },
      {
        key: "apple",
        part: "apple_red",
        place: { relation: "on", target: "table" },
      },
    ]);
    const table = byKey(layout.items, "table");
    const apple = byKey(layout.items, "apple");
    close(apple.position[1], 0.72);
    close(apple.position[0], table.position[0]);
    close(apple.position[2], table.position[2]);
  });

  test("on: 同じ机の上の物は重ならないよう並べ、机からはみ出さない", () => {
    const layout = compose([
      GRASS,
      { key: "table", part: "table", place: { relation: "ground" } },
      { key: "book", part: "book", place: { relation: "on", target: "table" } },
      { key: "cup", part: "cup", place: { relation: "on", target: "table" } },
      {
        key: "bottle",
        part: "bottle",
        place: { relation: "on", target: "table" },
      },
    ]);
    const table = box(byKey(layout.items, "table"));
    const things = ["book", "cup", "bottle"].map((k) => byKey(layout.items, k));
    for (const t of things) {
      close(t.position[1], 0.72);
      const b = box(t);
      assert.ok(b.x0 >= table.x0 - 1e-6 && b.x1 <= table.x1 + 1e-6);
      assert.ok(b.z0 >= table.z0 - 1e-6 && b.z1 <= table.z1 + 1e-6);
    }
    assert.ok(!overlap(things[0], things[1]));
    assert.ok(!overlap(things[0], things[2]));
    assert.ok(!overlap(things[1], things[2]));
  });

  test("on: top が無く seat がある相手（ベンチ）は、座面の点の上に置く", () => {
    const layout = compose([
      GRASS,
      { key: "bench", part: "bench", place: { relation: "ground" } },
      { key: "bag", part: "bag", place: { relation: "on", target: "bench" } },
    ]);
    const bag = byKey(layout.items, "bag");
    // bench の seat は [0, 0.482, 0.08]。高さ（背もたれの上 0.937）ではない
    close(bag.position[1], 0.482);
    close(bag.position[0], 0);
    close(bag.position[2], 0.08);
  });

  test("on: top も seat も無い相手は size の高さの上", () => {
    const layout = compose([
      GRASS,
      {
        key: "machine",
        part: "vending_machine",
        place: { relation: "ground" },
      },
      { key: "cup", part: "cup", place: { relation: "on", target: "machine" } },
    ]);
    close(byKey(layout.items, "cup").position[1], 1.8);
  });

  test("on: 箱の上は箱の top（0.35）", () => {
    const layout = compose([
      GRASS,
      { key: "box", part: "box", place: { relation: "ground" } },
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "on", target: "box" },
      },
    ]);
    close(byKey(layout.items, "ball").position[1], 0.35);
  });

  test("in: 相手の真ん中", () => {
    const layout = compose([
      GRASS,
      { key: "box", part: "box", place: { relation: "ground", zone: "left" } },
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "in", target: "box" },
      },
    ]);
    assert.deepEqual(
      byKey(layout.items, "ball").position,
      byKey(layout.items, "box").position,
    );
  });

  test("under: 机の下は真ん中の床、木の下は幹を避けて手前", () => {
    const layout = compose([
      GRASS,
      {
        key: "table",
        part: "table",
        place: { relation: "ground", zone: "left" },
      },
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "under", target: "table" },
      },
      {
        key: "tree",
        part: "tree",
        place: { relation: "ground", zone: "back_right" },
      },
      {
        key: "dog",
        part: "animal_run_dog_a",
        place: { relation: "under", target: "tree" },
      },
    ]);
    const table = byKey(layout.items, "table");
    assert.deepEqual(byKey(layout.items, "ball").position, table.position);
    const tree = byKey(layout.items, "tree");
    const dog = byKey(layout.items, "dog");
    close(dog.position[0], tree.position[0]);
    assert.equal(dog.position[1], 0);
    assert.ok(dog.position[2] > tree.position[2], "幹より手前（+Z）");
  });

  test("above: 相手の高さ＋0.3 m の真上", () => {
    const layout = compose([
      GRASS,
      { key: "table", part: "table", place: { relation: "ground" } },
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "above", target: "table" },
      },
    ]);
    const ball = byKey(layout.items, "ball");
    close(ball.position[1], 0.72 + ABOVE_GAP);
    close(ball.position[0], 0);
  });
});

describe("横・前・後ろ・近く・あいだ", () => {
  const base: PlanItem[] = [
    GRASS,
    { key: "tree", part: "tree", place: { relation: "ground" } },
  ];
  const tree = part("tree").size;

  test("next_to: 相手の size ＋ 10 cm の隙間で横（まず右）", () => {
    const layout = compose([
      ...base,
      {
        key: "bike",
        part: "bicycle",
        place: { relation: "next_to", target: "tree" },
      },
    ]);
    const bike = byKey(layout.items, "bike");
    close(bike.position[0], tree[0] / 2 + part("bicycle").size[0] / 2 + GAP);
    close(bike.position[2], 0);
    assert.equal(bike.position[1], 0);
  });

  test("next_to: 2 つ目は反対の側", () => {
    const layout = compose([
      ...base,
      {
        key: "b1",
        part: "bench",
        place: { relation: "next_to", target: "tree" },
      },
      {
        key: "b2",
        part: "bench",
        place: { relation: "next_to", target: "tree" },
      },
    ]);
    const d = tree[0] / 2 + part("bench").size[0] / 2 + GAP;
    close(byKey(layout.items, "b1").position[0], d);
    close(byKey(layout.items, "b2").position[0], -d);
  });

  test("in_front_of: 相手の正面（yaw 0 なら +Z、カメラ側）", () => {
    const layout = compose([
      ...base,
      {
        key: "girl",
        part: "person_stand_girl_a",
        place: { relation: "in_front_of", target: "tree" },
      },
    ]);
    const girl = byKey(layout.items, "girl");
    close(girl.position[0], 0);
    close(
      girl.position[2],
      tree[2] / 2 + part("person_stand_girl_a").size[2] / 2 + GAP,
    );
  });

  test("behind: 相手の後ろ（-Z）", () => {
    const layout = compose([
      ...base,
      {
        key: "box",
        part: "box",
        place: { relation: "behind", target: "tree" },
      },
    ]);
    close(
      byKey(layout.items, "box").position[2],
      -(tree[2] / 2 + part("box").size[2] / 2 + GAP),
    );
  });

  test("in_front_of: 左を向いた相手の前は -X", () => {
    const layout = compose([
      GRASS,
      {
        key: "man",
        part: "person_stand_adult_a",
        place: { relation: "ground" },
        facing: "left",
      },
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "in_front_of", target: "man" },
      },
    ]);
    const man = byKey(layout.items, "man");
    assert.equal(man.yaw, -90);
    const ball = byKey(layout.items, "ball");
    // 左を向くと、男の人の幅（x）は奥行き 0.38 になる
    close(ball.position[0], -(0.38 / 2 + 0.24 / 2 + GAP));
  });

  test("in_front_of: 相手の向きが後ろに書かれた部品で決まるときも、向いた側に置く", () => {
    const layout = compose([
      GRASS,
      {
        key: "dog",
        part: "animal_run_dog_a",
        place: { relation: "in_front_of", target: "man" },
      },
      {
        key: "man",
        part: "person_stand_adult_a",
        place: { relation: "ground", zone: "right" },
        facing: "ball",
      },
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "ground", zone: "left" },
      },
    ]);
    const man = byKey(layout.items, "man");
    const dog = byKey(layout.items, "dog");
    assert.equal(man.yaw, -90, "左のボールを向く");
    assert.ok(dog.position[0] < man.position[0], "男の人の前（-X）");
    close(dog.position[2], man.position[2]);
  });

  test("near: 斜め前に隙間を空けて置く", () => {
    const layout = compose([
      ...base,
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "near", target: "tree" },
      },
    ]);
    const ball = byKey(layout.items, "ball");
    close(ball.position[0], tree[0] / 2 + 0.12 + GAP);
    close(ball.position[2], tree[2] / 2 + 0.12 + GAP);
  });

  test("between: 2 つの相手の真ん中", () => {
    const layout = compose([
      GRASS,
      { key: "t1", part: "tree", place: { relation: "ground", zone: "left" } },
      { key: "t2", part: "tree", place: { relation: "ground", zone: "right" } },
      {
        key: "dog",
        part: "animal_run_dog_a",
        place: { relation: "between", target: "t1", target2: "t2" },
      },
    ]);
    const t1 = byKey(layout.items, "t1");
    const t2 = byKey(layout.items, "t2");
    const dog = byKey(layout.items, "dog");
    close(dog.position[0], (t1.position[0] + t2.position[0]) / 2);
    close(dog.position[2], (t1.position[2] + t2.position[2]) / 2);
  });

  test("机の上の物の横に置く人は、地面に立つ", () => {
    const layout = compose([
      GRASS,
      { key: "table", part: "table", place: { relation: "ground" } },
      {
        key: "apple",
        part: "apple_red",
        place: { relation: "on", target: "table" },
      },
      {
        key: "cup",
        part: "cup",
        place: { relation: "next_to", target: "apple" },
      },
      {
        key: "man",
        part: "person_stand_adult_a",
        place: { relation: "next_to", target: "apple" },
      },
    ]);
    close(byKey(layout.items, "cup").position[1], 0.72, "小物は同じ机の上");
    const man = byKey(layout.items, "man");
    assert.equal(man.position[1], 0);
    assert.ok(!overlap(man, byKey(layout.items, "table")), "机と重ならない");
  });

  test("相手は後に書かれていても先に置く", () => {
    const layout = compose([
      GRASS,
      {
        key: "apple",
        part: "apple_red",
        place: { relation: "on", target: "table" },
      },
      {
        key: "table",
        part: "table",
        place: { relation: "ground", zone: "right" },
      },
    ]);
    assert.deepEqual(
      layout.items.map((i) => i.key),
      ["grass", "apple", "table"],
      "items の順は書かれた順のまま",
    );
    close(byKey(layout.items, "apple").position[1], 0.72);
  });
});

describe("座る・向き", () => {
  test("sit_on: 椅子の seat に人の hip を合わせる", () => {
    const layout = compose([
      GRASS,
      { key: "chair", part: "chair", place: { relation: "ground" } },
      {
        key: "man",
        part: "person_sit_adult_a",
        place: { relation: "sit_on", target: "chair" },
      },
    ]);
    // seat [0, 0.46, 0]、hip [0, 0.48, -0.2] → 人の原点は [0, -0.02, 0.2]
    assert.deepEqual(byKey(layout.items, "man").position, [0, -0.02, 0.2]);
  });

  test("sit_on: 回した椅子でも seat と hip が合う", () => {
    const layout = compose([
      GRASS,
      {
        key: "chair",
        part: "chair",
        place: { relation: "ground" },
        facing: "right",
      },
      {
        key: "woman",
        part: "person_sit_woman_a",
        place: { relation: "sit_on", target: "chair" },
      },
    ]);
    const chair = byKey(layout.items, "chair");
    const woman = byKey(layout.items, "woman");
    assert.equal(chair.yaw, 90);
    assert.equal(woman.yaw, 90, "椅子と同じ向き");
    // 右（+X）を向くと、腰の点 [0, 0.48, -0.175] は [-0.175, 0.48, 0] になる
    close(woman.position[0], chair.position[0] + 0.175);
    close(woman.position[1], 0.46 - 0.48);
    close(woman.position[2], chair.position[2]);
  });

  test("sit_on: ベンチに 2 人なら左右に分けて座る", () => {
    const layout = compose([
      GRASS,
      { key: "bench", part: "bench", place: { relation: "ground" } },
      {
        key: "a",
        part: "person_sit_adult_a",
        place: { relation: "sit_on", target: "bench" },
      },
      {
        key: "b",
        part: "person_sit_woman_a",
        place: { relation: "sit_on", target: "bench" },
      },
    ]);
    const a = byKey(layout.items, "a");
    const b = byKey(layout.items, "b");
    close(a.position[0], -0.3);
    close(b.position[0], 0.3);
    close(a.position[2], 0.08 + 0.2);
    close(b.position[2], 0.08 + 0.175);
  });

  test("sit_on: 座るポーズでない人は横に立つ", () => {
    const layout = compose([
      GRASS,
      { key: "bench", part: "bench", place: { relation: "ground" } },
      {
        key: "man",
        part: "person_stand_adult_a",
        place: { relation: "sit_on", target: "bench" },
      },
    ]);
    const man = byKey(layout.items, "man");
    assert.equal(man.position[1], 0);
    close(
      man.position[0],
      0.8 + part("person_stand_adult_a").size[0] / 2 + GAP,
    );
  });

  test("facing: camera は 0（書かない）、left -90、right 90、away 180、相手の key はその向き", () => {
    const layout = compose([
      GRASS,
      {
        key: "a",
        part: "person_stand_adult_a",
        place: { relation: "ground", zone: "left" },
        facing: "camera",
      },
      {
        key: "b",
        part: "person_stand_adult_a",
        place: { relation: "ground", zone: "back" },
        facing: "away",
      },
      {
        key: "c",
        part: "person_stand_adult_a",
        place: { relation: "ground", zone: "right" },
        facing: "a",
      },
    ]);
    assert.equal(byKey(layout.items, "a").yaw, undefined);
    assert.equal(byKey(layout.items, "b").yaw, 180);
    // c は右の区画から左の区画の a を向く → -X → yaw -90
    assert.equal(byKey(layout.items, "c").yaw, -90);
  });
});

describe("動き", () => {
  test("fall: 木から落ちるリンゴは木の高さの 0.62 から（仕様の例の位置）", () => {
    const layout = compose([
      GRASS,
      { key: "tree", part: "tree", place: { relation: "ground" } },
      {
        key: "apple",
        part: "apple_red",
        place: { relation: "under", target: "tree" },
        motion: { type: "fall", duration: 1.2 },
      },
    ]);
    const apple = byKey(layout.items, "apple");
    const s = part("tree").size;
    close(apple.position[0], 0.16 * s[0]);
    close(apple.position[1], 0.62 * s[1]);
    close(apple.position[2], 0.125 * s[2]);
    assert.deepEqual(apple.motion, { type: "fall", duration: 1.2 });
  });

  test("fall: 地面に置いた物は持ち上げてから落とす", () => {
    const layout = compose([
      GRASS,
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "ground" },
        motion: { type: "fall", duration: 1 },
      },
    ]);
    close(byKey(layout.items, "ball").position[1], 2);
  });

  test("move toward: 相手の手前で止まり、進む向きを向く", () => {
    const layout = compose([
      GRASS,
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "ground", zone: "left" },
      },
      {
        key: "dog",
        part: "animal_run_dog_a",
        place: { relation: "ground", zone: "right" },
        motion: { type: "move", toward: "ball", duration: 4 },
      },
    ]);
    const ball = byKey(layout.items, "ball");
    const dog = byKey(layout.items, "dog");
    const to = toOf(dog);
    assert.equal(dog.motion?.type, "move");
    assert.ok(
      to[0] > ball.position[0] && to[0] < dog.position[0],
      "ボールの手前",
    );
    close(to[2], dog.position[2]);
    assert.equal(dog.yaw, -90, "左（-X）へ進む");
  });

  test("move toward 区画: 区画の真ん中へ", () => {
    const layout = compose([
      GRASS,
      {
        key: "man",
        part: "person_walk_adult_a",
        place: { relation: "ground", zone: "right" },
        motion: { type: "move", toward: "left", duration: 6 },
      },
    ]);
    const man = byKey(layout.items, "man");
    close(toOf(man)[0], -8 / 3);
    assert.equal(man.yaw, -90);
  });

  test("move across: 道路を短い辺の向き（z）に、奥から手前へ横切る", () => {
    const layout = compose([
      { key: "road", part: "road_patch", place: { relation: "ground" } },
      {
        key: "man",
        part: "person_walk_adult_a",
        place: { relation: "ground", zone: "left" },
        motion: { type: "move", toward: "road", path: "across", duration: 6 },
      },
    ]);
    const man = byKey(layout.items, "man");
    const to = toOf(man);
    assert.ok(man.position[2] < -2.75, "道路の奥の外から");
    assert.ok(to[2] > 2.75, "道路の手前の外へ");
    close(to[0], man.position[0]);
    assert.equal(man.yaw, undefined, "カメラ側へ歩くので yaw 0");
  });

  test("move along: 道路の長い辺（x）に沿って端から端へ", () => {
    const layout = compose([
      { key: "road", part: "road_patch", place: { relation: "ground" } },
      {
        key: "car",
        part: "car",
        place: { relation: "on", target: "road" },
        motion: { type: "move", toward: "road", path: "along", duration: 5 },
      },
    ]);
    const car = byKey(layout.items, "car");
    const to = toOf(car);
    close(Math.abs(car.position[0] - to[0]) > 4 ? 1 : 0, 1, "端から端へ");
    close(to[2], car.position[2]);
    assert.ok(Math.abs(car.yaw ?? 0) === 90, "進む向き（±X）を向く");
  });

  test("move: 動くものは facing より進む向きを向く", () => {
    const layout = compose([
      GRASS,
      {
        key: "man",
        part: "person_walk_adult_a",
        place: { relation: "ground", zone: "right" },
        facing: "camera",
        motion: { type: "move", toward: "left", duration: 6 },
      },
    ]);
    assert.equal(byKey(layout.items, "man").yaw, -90);
  });

  test("move: near に置いて同じ相手へ向かうときも、最低 1.5 m は動く", () => {
    const layout = compose([
      GRASS,
      { key: "ball", part: "ball_red", place: { relation: "ground" } },
      {
        key: "dog",
        part: "animal_run_dog_a",
        place: { relation: "near", target: "ball" },
        motion: { type: "move", toward: "ball", duration: 3 },
      },
    ]);
    const dog = byKey(layout.items, "dog");
    const to = toOf(dog);
    const moved = Math.hypot(to[0] - dog.position[0], to[2] - dog.position[2]);
    assert.ok(moved >= MIN_MOVE - 1e-3, `動く距離 ${moved}`);
    assert.ok(
      !overlap(dog, byKey(layout.items, "ball")),
      "出発点はボールに重ならない",
    );
    const yaw =
      (Math.atan2(to[0] - dog.position[0], to[2] - dog.position[2]) * 180) /
      Math.PI;
    close(dog.yaw ?? 0, Math.round(yaw * 10) / 10, "ボールの向き");
  });

  test("move: 出発点は他の部品の外接箱に入らない", () => {
    const layout = compose([
      GRASS,
      { key: "b1", part: "bench", place: { relation: "ground", zone: "left" } },
      {
        key: "b2",
        part: "bench",
        place: { relation: "ground", zone: "right" },
      },
      { key: "box", part: "box", place: { relation: "ground" } },
      {
        key: "dog",
        part: "animal_run_dog_a",
        place: { relation: "between", target: "b1", target2: "b2" },
        motion: { type: "move", toward: "front", duration: 3 },
      },
    ]);
    const dog = byKey(layout.items, "dog");
    for (const k of ["b1", "b2", "box"]) {
      assert.ok(!overlap(dog, byKey(layout.items, k)), `${k} に重ならない`);
    }
    const to = toOf(dog);
    assert.ok(
      Math.hypot(to[0] - dog.position[0], to[2] - dog.position[2]) >=
        MIN_MOVE - 1e-3,
    );
  });

  test("rotate・sway は duration だけ", () => {
    const layout = compose([
      GRASS,
      {
        key: "tree",
        part: "tree",
        place: { relation: "ground" },
        motion: { type: "sway", duration: 2 },
      },
      {
        key: "ball",
        part: "ball_red",
        place: { relation: "ground", zone: "front" },
        motion: { type: "rotate", duration: -1 },
      },
    ]);
    assert.deepEqual(byKey(layout.items, "tree").motion, {
      type: "sway",
      duration: 2,
    });
    assert.deepEqual(
      byKey(layout.items, "ball").motion,
      { type: "rotate", duration: 4 },
      "変な秒数は既定に",
    );
  });
});

describe("配点と上の階層", () => {
  test("配点は合計 90 の整数に直し、extraMax は 10", () => {
    const elements = normalizePoints([
      { id: "a", label: "a", points: 1, accept: "a" },
      { id: "b", label: "b", points: 1, accept: "b" },
      { id: "c", label: "c", points: 1, accept: "c" },
      { id: "d", label: "d", points: 4, accept: "d" },
    ]);
    assert.deepEqual(
      elements.map((e) => e.points),
      [14, 13, 13, 50],
    );
    const layout = compose(
      [GRASS],
      [
        { id: "x", label: "x", points: 0, accept: "x" },
        { id: "x", label: "y", points: 0, accept: "y" },
      ],
    );
    assert.deepEqual(
      layout.elements.map((e) => [e.id, e.points]),
      [
        ["x", 45],
        ["x_2", 45],
      ],
    );
    assert.equal(layout.extraMax, EXTRA_MAX);
  });

  test("0 点の要素も 1 点は持つ", () => {
    const elements = normalizePoints([
      { id: "a", label: "a", points: 100, accept: "a" },
      { id: "b", label: "b", points: 0, accept: "b" },
    ]);
    assert.deepEqual(
      elements.map((e) => e.points),
      [88, 2],
    );
  });

  test("上の階層と、一覧に無い部品・重なる key の扱い", () => {
    const layout = compose([
      GRASS,
      { key: "x", part: "no_such_part", place: { relation: "ground" } },
      { key: "ball", part: "ball_red", place: { relation: "ground" } },
      { key: "ball", part: "ball_red", place: { relation: "ground" } },
    ]);
    assert.equal(layout.protocol, "scenenglish.scene/1");
    assert.equal(layout.id, "gen-test000000");
    assert.equal(layout.name, "テスト");
    assert.equal(layout.description, "A test.");
    assert.equal(layout.difficulty, "easy");
    assert.deepEqual(
      layout.items.map((i) => i.key),
      ["grass", "ball", "ball_2"],
    );
  });
});
