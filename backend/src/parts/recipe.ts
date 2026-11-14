import { z } from "zod";
import materialsJson from "./materials.json";

// 部品表（部品の形の作り方）。Claude はこれだけを書き、組み立て（build.ts）が USDZ にする。
// 基本形は scripts/scene/common.py の Part の box・cyl・sphere・limb・slab・poly と同じ引数（parts.py を Blender で回して記録した形）。
// 座標は Blender（Z が上、正面は -Y、メートル）。組み立てのときに、プロトコル（Y が上、正面は +Z）に直す。
// 決めたことの正本は docs/design/part-generation.md

export type Vec3 = [number, number, number];

/** 材質の名前と色など（parts.py の make_materials()。scripts/scene/export_materials.py が書き出す） */
export type Material = {
  hex: string;
  /** リニアの色 */
  base: Vec3;
  rough: number;
  metal: number;
  emit: number;
  alpha: number;
};
export const MATERIALS = materialsJson as unknown as Record<string, Material>;
export const MATERIAL_NAMES = Object.keys(MATERIALS) as [string, ...string[]];

export const SHAPE_OPS = [
  "box",
  "cyl",
  "sphere",
  "limb",
  "slab",
  "poly",
] as const;
export type ShapeOpName = (typeof SHAPE_OPS)[number];

/** 基本形の 1 つ。p は Part の番号（Claude の部品表では書かない。1 つの Part にまとめる） */
export type ShapeOp =
  | {
      op: "box";
      size: Vec3;
      loc: Vec3;
      mat: string;
      rot?: Vec3;
      bevel?: number;
      segments?: number;
    }
  | {
      op: "cyl";
      r1: number;
      r2: number;
      depth: number;
      loc: Vec3;
      mat: string;
      rot?: Vec3;
      segs?: number;
      smooth?: boolean;
    }
  | {
      op: "sphere";
      r: number;
      loc: Vec3;
      mat: string;
      scale?: Vec3;
      rot?: Vec3;
      segs?: number;
      smooth?: boolean;
    }
  | {
      op: "limb";
      a: Vec3;
      b: Vec3;
      r1: number;
      r2: number;
      mat: string;
      segs?: number;
    }
  | {
      op: "slab";
      size: number | [number, number];
      z_top: number;
      thickness: number;
      radius: number;
      mat: string;
      segments?: number;
      center?: [number, number];
    }
  | { op: "poly"; points: Vec3[]; mat: string; smooth?: boolean };

/**
 * parts.py の記録の形（Part ごとの番号 p と、Part の始まり part・終わり finish を持つ）。
 * 今の部品を組み直して確かめるときに使う。Claude の部品表は toTraceOps で 1 つの Part に包む
 */
export type TraceOp =
  | { op: "part"; p: number; name?: string }
  | (ShapeOp & { p: number })
  | {
      op: "finish";
      p: number;
      loc?: number[];
      rot_z?: number;
      scale?: number;
      rot?: Vec3;
    };

// ---------- zod（受け取った部品表を確かめる） ----------

const num = z.number().finite();
const len = z.number().finite().positive();
const vec3 = z.tuple([num, num, num]);
const mat = z.enum(MATERIAL_NAMES);
// 分割の数。三角形の数の上限は check.ts でも見る
const segs = z.int().min(3).max(64);

const Box = z.strictObject({
  op: z.literal("box"),
  size: z.tuple([len, len, len]),
  loc: vec3,
  mat,
  rot: vec3.optional(),
  bevel: z.number().finite().min(0).optional(),
  segments: z.int().min(1).max(8).optional(),
});
const Cyl = z.strictObject({
  op: z.literal("cyl"),
  r1: z.number().finite().min(0),
  r2: z.number().finite().min(0),
  depth: len,
  loc: vec3,
  mat,
  rot: vec3.optional(),
  segs: segs.optional(),
  smooth: z.boolean().optional(),
});
const Sphere = z.strictObject({
  op: z.literal("sphere"),
  r: len,
  loc: vec3,
  mat,
  scale: z.tuple([len, len, len]).optional(),
  rot: vec3.optional(),
  segs: segs.optional(),
  smooth: z.boolean().optional(),
});
// a と b が同じ点だと向きが決まらず、形の全部の点が NaN になる。1 mm 以上離す
const MIN_LIMB_LENGTH = 0.001;
const Limb = z
  .strictObject({
    op: z.literal("limb"),
    a: vec3,
    b: vec3,
    r1: z.number().finite().min(0),
    r2: z.number().finite().min(0),
    mat,
    segs: segs.optional(),
  })
  .refine(
    (o) =>
      Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1], o.b[2] - o.a[2]) >=
      MIN_LIMB_LENGTH,
    { message: "a and b must be at least 1 mm apart", path: ["b"] },
  );
const Slab = z.strictObject({
  op: z.literal("slab"),
  size: z.union([len, z.tuple([len, len])]),
  z_top: num,
  thickness: len,
  radius: z.number().finite().min(0),
  mat,
  segments: z.int().min(1).max(16).optional(),
  center: z.tuple([num, num]).optional(),
});
const Poly = z.strictObject({
  op: z.literal("poly"),
  points: z.array(vec3).min(3).max(64),
  mat,
  smooth: z.boolean().optional(),
});

export const ShapeOpSchema = z.discriminatedUnion("op", [
  Box,
  Cyl,
  Sphere,
  Limb,
  Slab,
  Poly,
]);

/** Claude が書く部品表。ops は基本形の並び（1 つの Part） */
export const RecipeSchema = z.object({ ops: z.array(ShapeOpSchema).min(1) });
export type Recipe = { ops: ShapeOp[] };

/** Claude の部品表を、組み立てが読む記録の形（1 つの Part）に包む */
export const toTraceOps = (recipe: Recipe): TraceOp[] => [
  { op: "part", p: 0 },
  ...recipe.ops.map((o) => ({ ...o, p: 0 }) as TraceOp),
  { op: "finish", p: 0 },
];

// ---------- Claude に渡す JSON Schema ----------
// structured outputs は数の範囲（minimum など）と配列の長さ（minItems は 0 と 1 だけ）を書けないので、
// それらは上の zod で確かめる。材質の enum は $defs に 1 つだけ置き、基本形ごとに $ref で引く

const V3 = {
  type: "array",
  items: { type: "number" },
  description: "[x, y, z] in meters (Blender axes: Z up, front is -Y)",
};
const N = { type: "number" };
const MAT = { $ref: "#/$defs/material" };
const shape = (
  op: ShapeOpName,
  description: string,
  required: Record<string, unknown>,
  optional: Record<string, unknown> = {},
) => ({
  type: "object",
  description,
  properties: {
    op: { type: "string", const: op },
    ...required,
    ...optional,
  },
  required: ["op", ...Object.keys(required)],
  additionalProperties: false,
});

export const RECIPE_JSON_SCHEMA = {
  type: "object",
  properties: {
    decision: {
      type: "string",
      enum: ["build", "refuse"],
      description:
        "refuse when the order is a real person's name, a weapon, violence, or something sexual; otherwise build",
    },
    reason: {
      type: "string",
      description:
        "one short English sentence: why it is refused, or how the shape is made",
    },
    ops: {
      type: "array",
      description: "the primitives (empty when refused)",
      items: {
        anyOf: [
          shape(
            "box",
            "box centered at loc. size = [x, y, z] full lengths. bevel rounds the edges (m)",
            { size: V3, loc: V3, mat: MAT },
            { rot: V3, bevel: N },
          ),
          shape(
            "cyl",
            "cylinder or cone along Z, centered at loc. r1 = bottom radius, r2 = top radius (0 makes a cone), depth = height",
            { r1: N, r2: N, depth: N, loc: V3, mat: MAT },
            { rot: V3, segs: { type: "integer" } },
          ),
          shape(
            "sphere",
            "sphere of radius r at loc. scale stretches it per axis (an ellipsoid)",
            { r: N, loc: V3, mat: MAT },
            { scale: V3, rot: V3, segs: { type: "integer" } },
          ),
          shape(
            "limb",
            "tapered tube from point a (radius r1) to point b (radius r2). For handles, legs, rods and frames in any direction",
            { a: V3, b: V3, r1: N, r2: N, mat: MAT },
            { segs: { type: "integer" } },
          ),
          shape(
            "slab",
            "flat plate with rounded corners. size = [x, y], z_top = height of its top face, radius = corner radius",
            {
              size: { type: "array", items: { type: "number" } },
              z_top: N,
              thickness: N,
              radius: N,
              mat: MAT,
            },
            { center: { type: "array", items: { type: "number" } } },
          ),
          shape(
            "poly",
            "one flat polygon through the points (3 or more, in order, on one plane). For thin flat shapes such as signs, flags or blades of a fan",
            { points: { type: "array", items: V3 }, mat: MAT },
          ),
        ],
      },
    },
  },
  required: ["decision", "reason", "ops"],
  additionalProperties: false,
  $defs: { material: { type: "string", enum: MATERIAL_NAMES } },
} as const;

/** Claude の答え（RECIPE_JSON_SCHEMA の形） */
export const RecipeAnswerSchema = z.object({
  decision: z.enum(["build", "refuse"]),
  reason: z.string(),
  ops: z.array(z.unknown()),
});
