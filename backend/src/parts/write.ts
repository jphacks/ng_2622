import Anthropic from "@anthropic-ai/sdk";
import {
  type CreateMessage,
  DEFAULT_SCENE_MODEL,
  type Effort,
  effortOf,
} from "../scenes/generate";
import { LIMITS, type Problem } from "./check";
import { MATERIALS, RECIPE_JSON_SCHEMA } from "./recipe";
import samplesJson from "./samples.json";

// Claude に部品表を書かせる。入力は注文（PartOrder）と、同じ category の今の部品の部品表（見本、samples.json）。
// 見本は parts.py を Blender で回して記録した部品表（試作 part-builder-spike の trace/out/parts_table）から、
// category ごとに短いものを 2〜3 個選んだもの（植物の blob は球に置き換えた）。
// 構造化出力（json_schema）で書かせ、形の検査（check.ts）に落ちたら、落ちた理由を付けて 1 回だけ書き直させる（make.ts）

export const PART_CATEGORIES = [
  "thing",
  "furniture",
  "food",
  "plant",
  "vehicle",
] as const;
export type PartCategory = (typeof PART_CATEGORIES)[number];

/** 作る部品の注文（workshop.ts の PartOrder と同じ形） */
export type Order = {
  id: string;
  category: PartCategory;
  label: string;
  words: string[];
  size: [number, number, number];
  description: string;
  top?: boolean;
};

export type PartsClaudeEnv = {
  CLAUDE_API_KEY?: string;
  // 部品表を書かせるモデルと effort。無ければ場面の生成と同じ（CLAUDE_SCENE_*、既定 claude-sonnet-5-5 の low）
  CLAUDE_PART_MODEL?: string;
  CLAUDE_PART_EFFORT?: string;
  CLAUDE_SCENE_MODEL?: string;
  CLAUDE_SCENE_EFFORT?: string;
};

type Sample = {
  id: string;
  label: string;
  words: string[];
  size: number[];
  ops: unknown[];
};
const SAMPLES = samplesJson as Record<PartCategory, Sample[]>;

const materialList = Object.entries(MATERIALS)
  .map(([name, m]) => `${name} ${m.hex}${m.metal > 0 ? " metal" : ""}`)
  .join(", ");

/** system（全部の注文で同じなので cache_control を付ける） */
export const PART_SYSTEM = `You design small 3D props for a picture-description game for Japanese English learners. You write a recipe: a list of simple primitives that a program assembles into a low-poly 3D model. The look is cute, simple and toy-like, the same style as the sample recipes.

Coordinates (Blender): meters, Z is up, the front of the object faces -Y (toward the viewer), X is the width. Build the object standing on the ground plane z = 0, centered at x = 0, y = 0. The program moves the bounding box so that its bottom center is the origin.
The ordered size is [width, height, depth] = [extent along X, extent along Z, extent along Y]. The bounding box of all primitives must match it within about 15%.

Primitives (all lengths in meters, rot = Euler angles in radians around X, Y, Z applied in XYZ order):
- box: size [x, y, z] full lengths, loc = center. bevel rounds the edges (use about 10-25% of the smallest side for soft shapes, 0 for sharp ones).
- cyl: cylinder or cone along Z, loc = center, depth = height, r1 = bottom radius, r2 = top radius (r2 = 0 is a cone). segs = number of sides (default 16; 8-12 for thin ones, up to 32 for large round ones). A few sides make prisms: segs 3 is a triangular prism, 4 a square one, 6 a hexagonal one. Use rot to lay it down, e.g. rot [1.5708, 0, 0] points it along Y. Its caps are closed; to show an open container, put a thin dark disc just below the rim.
- sphere: radius r at loc. scale [sx, sy, sz] makes an ellipsoid whose half-extents are r*sx, r*sy, r*sz (its front surface is at y = loc.y - r*sy). segs default 20 (8-12 for small ones).
- limb: tapered tube from point a (radius r1) to point b (radius r2). Best for handles, legs, rods, poles, arcs made of several limbs, and frames at any angle.
- slab: flat plate with rounded corners, size [x, y], z_top = height of its top face, thickness, radius = corner radius, center [x, y].
- poly: one flat polygon through 3 or more points (in order, on one plane). For flat thin shapes such as signs, labels, flags or blades. It has no thickness.

Rules:
- Every primitive must touch or overlap another one, so the object is one connected piece (nothing floats in the air). Parts that rest on something must sit exactly on it.
- Use at most ${LIMITS.maxOps} primitives (usually 5-40), at most ${LIMITS.maxMaterials} materials and about ${LIMITS.maxTris} triangles in total. Prefer few, well-placed primitives with clear, readable silhouettes. Small details (buttons, holes, screens, labels) must sit slightly in front of the surface they decorate (a few millimeters), not hidden inside it: compute where that surface is from the sizes.
- Choose materials only from this list (name and color; pick by color, the names are just labels): ${materialList}.
- If the order is a real person or their name, a weapon (gun, sword, bomb and the like), violence or injury, or anything sexual, do not build it: set decision to "refuse", explain briefly in reason, and leave ops empty. Ordinary things (kitchen tools, sports equipment, toys, food, vehicles, furniture, plants) are fine.
- reason: one short English sentence about how you built the shape (or why you refused).`;

const sizeText = (s: number[]) =>
  `width ${s[0]} m (X), height ${s[1]} m (Z), depth ${s[2]} m (Y)`;

/** 注文の本文（見本と注文） */
export const orderMessage = (order: Order): string => {
  const samples = SAMPLES[order.category] ?? SAMPLES.thing;
  const lines = [
    `Sample recipes of existing ${order.category} props (same style):`,
    ...samples.map(
      (s) =>
        `- ${s.id} (${s.words.join(", ")}), size ${sizeText(s.size)}:\n${JSON.stringify(s.ops)}`,
    ),
    "",
    "Order:",
    `- id: ${order.id}`,
    `- category: ${order.category}`,
    `- words: ${order.words.join(", ")}`,
    `- description: ${order.description}`,
    `- size: ${sizeText(order.size)}`,
  ];
  if (order.top)
    lines.push(
      "- Other objects will be put on its top surface, so make the top flat.",
    );
  return lines.join("\n");
};

/** 書き直しの頼み（前の答えと落ちた理由） */
export const retryMessage = (problems: Problem[]): string =>
  `Your recipe failed the checks:\n${problems.map((p) => `- ${p.message}`).join("\n")}\nWrite the whole recipe again with these problems fixed.`;

export type RecipeCall = {
  /** Claude の答え（JSON を読んだもの。形はまだ確かめていない） */
  json: unknown;
  /** Claude の答えの本文（書き直しのときに assistant として返す） */
  text: string;
  usage: Anthropic.Usage;
  model: string;
  ms: number;
};

export class PartWriteError extends Error {
  constructor(
    readonly kind: "refused" | "invalid" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

export type WriteDeps = { create?: CreateMessage; now?: () => number };

export const partModel = (
  env: PartsClaudeEnv,
): { model: string; effort: Effort } => ({
  model: env.CLAUDE_PART_MODEL || env.CLAUDE_SCENE_MODEL || DEFAULT_SCENE_MODEL,
  effort: effortOf(env.CLAUDE_PART_EFFORT || env.CLAUDE_SCENE_EFFORT),
});

const clientOf = (env: PartsClaudeEnv, deps: WriteDeps): CreateMessage => {
  if (deps.create) return deps.create;
  if (!env.CLAUDE_API_KEY)
    throw new PartWriteError("unavailable", "CLAUDE_API_KEY が要る");
  // SDK の再送は使わない（maxRetries 0）。書き直しは make.ts が 1 回だけ決める
  const client = new Anthropic({ apiKey: env.CLAUDE_API_KEY, maxRetries: 0 });
  return (params, options) => client.messages.create(params, options);
};

/**
 * Claude を 1 回呼び、部品表の答えを返す。history は前の回の [注文, 答え, 書き直しの頼み]（無ければ 1 回目）
 */
export async function callRecipe(
  env: PartsClaudeEnv,
  messages: Anthropic.MessageParam[],
  deps: WriteDeps = {},
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<RecipeCall> {
  const create = clientOf(env, deps);
  const { model, effort } = partModel(env);
  const now = deps.now ?? Date.now;
  const t0 = now();
  let response: Anthropic.Message;
  try {
    response = await create(
      {
        model,
        max_tokens: 16000,
        output_config: {
          effort,
          format: { type: "json_schema", schema: RECIPE_JSON_SCHEMA },
        },
        system: [
          {
            type: "text",
            text: PART_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages,
      },
      { timeout: options.timeoutMs ?? 60_000, signal: options.signal },
    );
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError)
      throw new PartWriteError("unavailable", "Claude の応答が遅すぎた");
    if (e instanceof Anthropic.APIError)
      throw new PartWriteError(
        "unavailable",
        `Claude の API が失敗した（${e.status ?? "接続できない"}）`,
      );
    throw new PartWriteError(
      "unavailable",
      e instanceof Error ? e.message : String(e),
    );
  }
  if (response.stop_reason === "refusal")
    throw new PartWriteError("refused", "Claude が断った");
  if (response.stop_reason !== "end_turn")
    throw new PartWriteError(
      "invalid",
      `Claude が途中で止まった（${response.stop_reason}）`,
    );
  const block = response.content.find((b) => b.type === "text");
  if (block?.type !== "text")
    throw new PartWriteError("invalid", "Claude の応答に本文が無い");
  let json: unknown;
  try {
    json = JSON.parse(block.text);
  } catch {
    throw new PartWriteError("invalid", "Claude の応答が JSON でない");
  }
  return {
    json,
    text: block.text,
    usage: response.usage,
    model,
    ms: now() - t0,
  };
}

/** 1 回の呼び出しの費用（USD）。Sonnet 5.5 の値段（入力 $2・出力 $10・キャッシュの読み $0.10・書き $2.50 / 100 万トークン） */
export const costOf = (u: Anthropic.Usage): number =>
  ((u.input_tokens ?? 0) * 2 +
    (u.output_tokens ?? 0) * 10 +
    (u.cache_read_input_tokens ?? 0) * 0.1 +
    (u.cache_creation_input_tokens ?? 0) * 2.5) /
  1e6;
