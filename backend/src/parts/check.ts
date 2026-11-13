import type { BuiltMesh } from "./build";
import {
  type Recipe,
  RecipeSchema,
  SHAPE_OPS,
  type ShapeOp,
  type Vec3,
} from "./recipe";

// 部品表と組んだ形の検査（形だけ。AI に画像を見せる検査はしない）。値の決めの正本は docs/design/part-generation.md。
// 落ちた理由（problems）は英語で書き、Claude に書き直させるときにそのまま渡す

export const LIMITS = {
  /** 基本形の数の上限（同梱の物は多くて本棚の 115。人は 100 前後） */
  maxOps: 120,
  /** 三角形の数の上限（同梱の物は多くて 3,300、人は 6,800） */
  maxTris: 6000,
  /** 材質の数の上限（同梱の物は多くて電車の 9） */
  maxMaterials: 10,
  /** 頼んだ寸法との差の目安（軸ごと）。差が頼んだ寸法の 35% か 2 cm の大きい方を超えたら落とす */
  sizeTolerance: 0.35,
  sizeFloor: 0.02,
  /** 浮いた基本形の検査で、外接箱を膨らませる幅。部品の最も長い辺の 2% か 5 mm の大きい方 */
  touchRatio: 0.02,
  touchFloor: 0.005,
} as const;

export type ProblemCode =
  | "schema"
  | "op"
  | "material"
  | "ops"
  | "tris"
  | "materials"
  | "size"
  | "floating";

export type Problem = { code: ProblemCode; message: string };

const issueText = (issue: { path: PropertyKey[]; message: string }): string => {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
};

/** 基本形 1 つの三角形の数の見積もり（組む前に、多すぎる部品表を落とす） */
export const estimateTris = (o: ShapeOp): number => {
  switch (o.op) {
    case "box": {
      if (!o.bevel || o.bevel <= 0) return 12;
      const s = Math.max(1, o.segments ?? 3);
      return 8 * s * s + 24 * s + 12;
    }
    case "cyl":
    case "limb": {
      const n = o.segs ?? (o.op === "cyl" ? 16 : 12);
      return 4 * n;
    }
    case "sphere": {
      const u = o.segs ?? 20;
      const v = Math.max(8, Math.floor((u * 2) / 3));
      return 2 * u * (v - 1);
    }
    case "slab": {
      const ring = 4 * ((o.segments ?? 10) + 1);
      return 4 * ring;
    }
    case "poly":
      return o.points.length - 2;
  }
};

/**
 * Claude の答えの ops を確かめ、部品表にする。op と材質が enum の中か、数の範囲、基本形の数、三角形の数の見積もり
 */
export const parseRecipe = (
  ops: unknown,
): { recipe?: Recipe; problems: Problem[] } => {
  const problems: Problem[] = [];
  if (!Array.isArray(ops) || ops.length === 0) {
    return {
      problems: [{ code: "schema", message: "ops must not be empty" }],
    };
  }
  if (ops.length > LIMITS.maxOps) {
    problems.push({
      code: "ops",
      message: `too many primitives: ${ops.length} (at most ${LIMITS.maxOps})`,
    });
  }
  const parsed = RecipeSchema.safeParse({ ops });
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 8)) {
      const [, index, key] = issue.path;
      const op = (ops[Number(index)] as { op?: unknown } | undefined)?.op;
      let code: ProblemCode = "schema";
      if (key === "mat") code = "material";
      else if (
        key === "op" ||
        (typeof op === "string" &&
          !(SHAPE_OPS as readonly string[]).includes(op))
      )
        code = "op";
      problems.push({ code, message: issueText(issue) });
    }
    return { problems };
  }
  const recipe = parsed.data as Recipe;
  const tris = recipe.ops.reduce((n, o) => n + estimateTris(o), 0);
  if (tris > LIMITS.maxTris) {
    problems.push({
      code: "tris",
      message: `too many triangles: about ${tris} (at most ${LIMITS.maxTris}). Use fewer segments or fewer primitives`,
    });
  }
  const mats = new Set(recipe.ops.map((o) => o.mat));
  if (mats.size > LIMITS.maxMaterials) {
    problems.push({
      code: "materials",
      message: `too many materials: ${mats.size} (at most ${LIMITS.maxMaterials})`,
    });
  }
  return problems.length > 0 ? { problems } : { recipe, problems };
};

const AXES = ["width (x)", "height", "depth"] as const;

/** 組んだ形の検査: 三角形の数、頼んだ寸法との差、浮いた基本形 */
export const checkBuilt = (
  mesh: BuiltMesh,
  order: { size: Vec3 },
): Problem[] => {
  const problems: Problem[] = [];
  if (mesh.tris > LIMITS.maxTris) {
    problems.push({
      code: "tris",
      message: `too many triangles: ${mesh.tris} (at most ${LIMITS.maxTris})`,
    });
  }
  const off: string[] = [];
  for (let a = 0; a < 3; a++) {
    const want = order.size[a];
    const got = mesh.size[a];
    if (
      Math.abs(got - want) >
      Math.max(LIMITS.sizeTolerance * want, LIMITS.sizeFloor)
    ) {
      off.push(`${AXES[a]} is ${got.toFixed(3)} m but should be about ${want}`);
    }
  }
  if (off.length > 0) {
    problems.push({
      code: "size",
      message: `the bounding box is off: ${off.join("; ")}. In Blender axes, x = width, z = height, y = depth`,
    });
  }
  const floating = floatingPrims(mesh);
  if (floating.length > 0) {
    problems.push({
      code: "floating",
      message: `primitives ${floating.map((i) => `#${i}`).join(", ")} (0-based index in ops) do not touch the rest of the object. Move or resize them so that every primitive touches or overlaps another`,
    });
  }
  return problems;
};

/**
 * 浮いた基本形（ほかとつながらない基本形）の番号。基本形ごとの外接箱を少し膨らませ、重なるものをつなぐ。
 * 最も大きいまとまり（基本形の数。同じなら最も低い点を持つ方）に入らないものを返す
 */
export const floatingPrims = (mesh: BuiltMesh): number[] => {
  const boxes = new Map<number, number[]>(); // 基本形 → [lx, ly, lz, hx, hy, hz]
  let start = 0;
  for (let f = 0; f < mesh.counts.length; f++) {
    const prim = mesh.fprim[f];
    let b = boxes.get(prim);
    if (!b) {
      b = [
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ];
      boxes.set(prim, b);
    }
    for (let k = 0; k < mesh.counts[f]; k++) {
      const v = mesh.idx[start + k] * 3;
      for (let a = 0; a < 3; a++) {
        b[a] = Math.min(b[a], mesh.P[v + a]);
        b[a + 3] = Math.max(b[a + 3], mesh.P[v + a]);
      }
    }
    start += mesh.counts[f];
  }
  const prims = [...boxes.keys()].sort((x, y) => x - y);
  if (prims.length <= 1) return [];
  const margin = Math.max(
    LIMITS.touchFloor,
    LIMITS.touchRatio * Math.max(...mesh.size),
  );
  const parent = new Map<number, number>(prims.map((p) => [p, p]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    parent.set(x, r);
    return r;
  };
  for (let i = 0; i < prims.length; i++) {
    const a = boxes.get(prims[i]) as number[];
    for (let j = i + 1; j < prims.length; j++) {
      const b = boxes.get(prims[j]) as number[];
      let touch = true;
      for (let k = 0; k < 3; k++) {
        if (a[k] - margin > b[k + 3] || b[k] - margin > a[k + 3]) {
          touch = false;
          break;
        }
      }
      if (touch) parent.set(find(prims[i]), find(prims[j]));
    }
  }
  const groups = new Map<number, { prims: number[]; low: number }>();
  for (const p of prims) {
    const r = find(p);
    const g = groups.get(r) ?? { prims: [], low: Number.POSITIVE_INFINITY };
    g.prims.push(p);
    g.low = Math.min(g.low, (boxes.get(p) as number[])[1]);
    groups.set(r, g);
  }
  if (groups.size === 1) return [];
  const main = [...groups.values()].sort(
    (x, y) => y.prims.length - x.prims.length || x.low - y.low,
  )[0];
  return prims.filter((p) => !main.prims.includes(p));
};
