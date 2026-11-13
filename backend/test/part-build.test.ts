// 部品表 → USDZ の組み立て（src/parts/build.ts）と形の検査（src/parts/check.ts）
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildMesh, topHeight, toUsdz } from "../src/parts/build";
import { checkBuilt, floatingPrims, parseRecipe } from "../src/parts/check";
import {
  MATERIAL_NAMES,
  RECIPE_JSON_SCHEMA,
  type Recipe,
  type TraceOp,
  toTraceOps,
} from "../src/parts/recipe";
import { PARTS } from "../src/scenes/parts";

const fixture = (id: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/part-recipes/${id}.json`, import.meta.url),
      "utf8",
    ),
  ) as { id: string; ops: TraceOp[] };

// parts.py を Blender で回して記録した部品表（試作 part-builder-spike の trace/out/parts_table の写し）と、
// 試作の組み立て（own.ts）が出した三角形の数
const KNOWN: Record<string, number> = {
  person_stand_woman_a: 3476,
  animal_run_dog_a: 3896,
  chair: 792,
  person_carry_veg_clerk_a: 6684,
  bicycle: 1040,
};

for (const [id, tris] of Object.entries(KNOWN)) {
  test(`${id} を部品表から組むと、外接箱が index.json の size と 2 mm 以内、三角形の数が試作と同じ`, () => {
    const mesh = buildMesh(fixture(id).ops);
    const want = PARTS.find((p) => p.id === id)?.size;
    assert.ok(want, `${id} が index.json に無い`);
    for (let a = 0; a < 3; a++) {
      assert.ok(
        Math.abs(mesh.size[a] - want[a]) <= 0.002,
        `${id} の ${a} 軸: ${mesh.size[a]} と ${want[a]}`,
      );
    }
    assert.equal(mesh.tris, tris);
    // 原点は外接箱の底面の中心
    let minY = Number.POSITIVE_INFINITY;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < mesh.P.length; i += 3) {
      minY = Math.min(minY, mesh.P[i + 1]);
      minX = Math.min(minX, mesh.P[i]);
      maxX = Math.max(maxX, mesh.P[i]);
    }
    assert.ok(Math.abs(minY) < 1e-9);
    assert.ok(Math.abs(minX + maxX) < 1e-9);
  });
}

test("今の物の部品は浮いた基本形が無いと判定される（検査が今の部品を落とさない）", () => {
  for (const id of ["chair", "bicycle"]) {
    assert.deepEqual(floatingPrims(buildMesh(fixture(id).ops)), [], id);
  }
});

test("USDZ は無圧縮の zip で、中の USDA のデータが 64 バイト境界から始まる", () => {
  const mesh = buildMesh(fixture("chair").ops);
  const usdz = toUsdz("chair", mesh);
  const dv = new DataView(usdz.buffer, usdz.byteOffset, usdz.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint16(8, true), 0); // 無圧縮
  const nameLength = dv.getUint16(26, true);
  const extra = dv.getUint16(28, true);
  const dataStart = 30 + nameLength + extra;
  assert.equal(dataStart % 64, 0);
  const name = new TextDecoder().decode(usdz.slice(30, 30 + nameLength));
  assert.equal(name, "chair.usda");
  const head = new TextDecoder().decode(usdz.slice(dataStart, dataStart + 10));
  assert.equal(head, "#usda 1.0\n");
});

test("上に置ける面の高さは、上を向いた面の最も広い高さ（テーブルは天板）", () => {
  const recipe: Recipe = {
    ops: [
      { op: "box", size: [1.2, 0.75, 0.04], loc: [0, 0, 0.7], mat: "table" },
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map(
          (sy) =>
            ({
              op: "cyl",
              r1: 0.03,
              r2: 0.03,
              depth: 0.68,
              loc: [sx * 0.55, sy * 0.33, 0.34],
              mat: "table_leg",
            }) as const,
        ),
      ),
      // 天板の上の小さな花瓶（天板より高いが、面積は小さい）
      {
        op: "cyl",
        r1: 0.05,
        r2: 0.05,
        depth: 0.2,
        loc: [0, 0, 0.82],
        mat: "pot",
      },
    ],
  };
  const mesh = buildMesh(toTraceOps(recipe));
  assert.equal(topHeight(mesh), 0.72);
  assert.deepEqual(checkBuilt(mesh, { size: [1.2, 0.92, 0.75] }), []);
});

test("検査は、知らない op・知らない材質・数の外れた値を落とす", () => {
  const bad = (ops: unknown[]) => parseRecipe(ops).problems.map((p) => p.code);
  assert.deepEqual(bad([]), ["schema"]);
  assert.deepEqual(bad([{ op: "blob", r: 0.1, loc: [0, 0, 0], mat: "leaf" }]), [
    "op",
  ]);
  assert.deepEqual(
    bad([{ op: "sphere", r: 0.1, loc: [0, 0, 0], mat: "gold_shiny" }]),
    ["material"],
  );
  assert.deepEqual(
    bad([{ op: "sphere", r: -0.1, loc: [0, 0, 0], mat: "leaf" }]),
    ["schema"],
  );
  assert.deepEqual(
    bad([{ op: "box", size: [0.1, 0.1], loc: [0, 0, 0], mat: "wood" }]),
    ["schema"],
  );
});

test("検査は、基本形・三角形・材質の多すぎる部品表を落とす", () => {
  const sphere = (mat: string) => ({
    op: "sphere",
    r: 0.1,
    loc: [0, 0, 0.1],
    mat,
  });
  const codes = (ops: unknown[]) =>
    parseRecipe(ops).problems.map((p) => p.code);
  assert.ok(codes(Array(121).fill(sphere("leaf"))).includes("ops"));
  assert.ok(
    codes(
      Array(10).fill({
        op: "sphere",
        r: 0.1,
        loc: [0, 0, 0.1],
        mat: "leaf",
        segs: 64,
      }),
    ).includes("tris"),
  );
  assert.ok(
    codes(MATERIAL_NAMES.slice(0, 11).map((m) => sphere(m))).includes(
      "materials",
    ),
  );
});

test("検査は、頼んだ寸法から外れた形と、浮いた基本形を落とす", () => {
  const recipe: Recipe = {
    ops: [
      { op: "box", size: [0.4, 0.4, 0.4], loc: [0, 0, 0.2], mat: "cardboard" },
      // 箱から 30 cm 離れて浮いた球
      { op: "sphere", r: 0.05, loc: [0, 0, 0.95], mat: "ball" },
    ],
  };
  const mesh = buildMesh(toTraceOps(recipe));
  const problems = checkBuilt(mesh, { size: [0.4, 0.4, 0.4] });
  assert.deepEqual(
    problems.map((p) => p.code),
    ["size", "floating"],
  );
  assert.match(problems[1].message, /#1\b/);
  // 寸法の差は 35% か 2 cm まで
  const box = buildMesh(toTraceOps({ ops: [recipe.ops[0]] }));
  assert.deepEqual(checkBuilt(box, { size: [0.3, 0.3, 0.55] }), []);
  assert.deepEqual(
    checkBuilt(box, { size: [0.25, 0.4, 0.4] }).map((p) => p.code),
    ["size"],
  );
});

test("Claude に渡す JSON Schema の基本形は、zod の部品表が受け付ける形", () => {
  const items = RECIPE_JSON_SCHEMA.properties.ops.items.anyOf;
  assert.equal(items.length, 6);
  for (const item of items) {
    // 必須の項目だけで作った基本形が zod を通る
    const op = item.properties.op.const;
    const sample: Record<string, unknown> = { op };
    for (const key of item.required) {
      if (key === "op") continue;
      if (key === "mat") sample.mat = "wood";
      else if (key === "points")
        sample.points = [
          [0, 0, 0],
          [0.1, 0, 0],
          [0, 0, 0.1],
        ];
      else if (key === "size")
        sample.size = op === "slab" ? [0.2, 0.2] : [0.2, 0.2, 0.2];
      else if (["loc", "a"].includes(key)) sample[key] = [0, 0, 0];
      else if (key === "b") sample[key] = [0, 0, 0.2];
      else sample[key] = 0.1;
    }
    assert.deepEqual(parseRecipe([sample]).problems, [], op);
  }
});
