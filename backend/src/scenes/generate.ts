import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  type Difficulty,
  FACINGS,
  MOTIONS,
  PATHS,
  type Part,
  RELATIONS,
  type ScenePlan,
  ZONES,
} from "./types";

// POST /scenes/generate の中身。Claude に「関係」を JSON Schema の形で書かせる（座標は compose.ts が計算する）。
// 呼び方の正本は docs/design/scene-protocol.md の「Claude に書かせる形と呼び方」

export const DEFAULT_SCENE_MODEL = "claude-sonnet-5-5";
const DEFAULT_SCENE_EFFORT = "low";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

// 知らない値は既定に戻す（採点の claude.ts と同じ）
const effortOf = (raw: string | undefined): Effort =>
  raw && EFFORTS.includes(raw) ? (raw as Effort) : DEFAULT_SCENE_EFFORT;

export type GenerateEnv = {
  CLAUDE_API_KEY?: string;
  // 生成に使う Claude のモデルと effort。無ければ Sonnet 5.5 の low
  CLAUDE_SCENE_MODEL?: string;
  CLAUDE_SCENE_EFFORT?: string;
};

/** 失敗の種類。refused: Claude が断った、invalid: 途中で止まった・形が変、unavailable: タイムアウト・API の失敗・キーが無い */
export type GenerateFailure = "refused" | "invalid" | "unavailable";

export class SceneGenerationError extends Error {
  constructor(
    readonly kind: GenerateFailure,
    message: string,
  ) {
    super(message);
  }
}

// 難易度の中身（docs/design/scene-protocol.md の「難易度の中身（推測）」）
const LEVELS: Record<Difficulty, string> = {
  easy: "level A (beginner). Verbs like stand, walk, run, sit, eat, read. 4 sentences in the description, 4 elements, 4-6 items (including the ground and the wall). Simple relations (on, under, next_to).",
  normal:
    "level B (intermediate). Verbs like lean, reach, pick up, check a watch, talk on the phone, carry. 6 sentences, 6 elements, 6-10 items. Use several different relations.",
  hard: "level C (advanced). Verbs like glance, stroll, crouch, wait, push. 8 sentences, 8 elements, 10-15 items. Several people doing different things, relations such as between, across, along and behind, and some motion.",
};

// テーマを省いたときに Claude が選ぶ一覧。今の部品で作れる場所だけ
export const THEMES = [
  "公園（park）",
  "カフェ（cafe）",
  "店（store, supermarket）",
  "駅（train station）",
  "台所（kitchen）",
  "教室（classroom）",
  "部屋（living room, bedroom）",
  "図書館（library）",
  "砂浜（beach）",
  "道（street, crossing）",
  "バス停（bus stop）",
  "校庭（playground）",
] as const;

const describePart = (p: Part) => {
  const fields = [
    p.id,
    p.label,
    p.category,
    `words: ${p.words.map((w) => w.word).join(", ")}`,
    p.pose ? `pose: ${p.pose}` : null,
    `size(w,h,d): ${p.size.join(", ")}`,
    p.anchors ? `anchors: ${JSON.stringify(p.anchors)}` : null,
  ];
  return `- ${fields.filter(Boolean).join(" | ")}`;
};

const EXAMPLE_EASY = {
  name: "リンゴが落ちる公園",
  description:
    "A sunny park. A red apple is falling from a tree. A man is walking past the tree, and a red ball is on the grass.",
  elements: [
    {
      id: "place",
      label: "公園で",
      points: 15,
      accept: "park, garden, lawn, grass",
    },
    {
      id: "apple_fall",
      label: "リンゴが木から落ちている",
      points: 35,
      accept: "an apple is falling from the tree",
      partial: "mentions an apple or the tree, without saying it is falling",
    },
    {
      id: "man_walk",
      label: "男の人が歩いている",
      points: 25,
      accept: "a man is walking (past the tree)",
      partial: "mentions a man or a person, without saying he is walking",
    },
    {
      id: "ball",
      label: "赤いボール",
      points: 15,
      accept: "a red ball (on the grass)",
      partial: "a ball, without the color",
    },
  ],
  items: [
    { key: "grass", part: "grass_patch", place: { relation: "ground" } },
    {
      key: "tree",
      part: "tree",
      place: { relation: "ground", zone: "back" },
    },
    {
      key: "apple",
      part: "apple_red",
      place: { relation: "under", target: "tree" },
      motion: { type: "fall", duration: 1.2 },
    },
    {
      key: "man",
      part: "person_walk_adult_a",
      place: { relation: "in_front_of", target: "tree" },
      motion: { type: "move", toward: "left", duration: 6 },
    },
    {
      key: "ball",
      part: "ball_red",
      place: { relation: "ground", zone: "front_right" },
    },
  ],
};

const EXAMPLE_NORMAL = {
  name: "カフェで本を読む女の人",
  description:
    "A small cafe. A woman is sitting on a chair at a table. A book and a cup of coffee are on the table. A man is standing next to the table, talking on the phone.",
  elements: [
    { id: "place", label: "カフェで", points: 10, accept: "cafe, coffee shop" },
    {
      id: "woman_sit",
      label: "女の人が椅子に座っている",
      points: 20,
      accept: "a woman is sitting on a chair (at the table)",
      partial: "mentions a woman or a person, without saying she is sitting",
    },
    {
      id: "book_on_table",
      label: "テーブルの上に本がある",
      points: 15,
      accept: "a book is on the table",
      partial: "mentions a book, without saying where it is",
    },
    {
      id: "cup",
      label: "コーヒーのカップ",
      points: 10,
      accept: "a cup of coffee (on the table)",
      partial: "a cup or a drink",
    },
    {
      id: "man_phone",
      label: "男の人が電話をしている",
      points: 20,
      accept: "a man is talking on the phone",
      partial: "mentions a man standing, without the phone",
    },
    {
      id: "machine",
      label: "自動販売機",
      points: 15,
      accept: "a vending machine",
      partial: "a machine or a box",
    },
  ],
  items: [
    { key: "floor", part: "floor_wood", place: { relation: "ground" } },
    { key: "wall", part: "wall_window", place: { relation: "ground" } },
    {
      key: "table",
      part: "table",
      place: { relation: "ground", zone: "center" },
    },
    {
      key: "chair",
      part: "chair",
      place: { relation: "behind", target: "table" },
      facing: "table",
    },
    {
      key: "woman",
      part: "person_sit_woman_a",
      place: { relation: "sit_on", target: "chair" },
    },
    { key: "book", part: "book", place: { relation: "on", target: "table" } },
    { key: "cup", part: "cup", place: { relation: "on", target: "table" } },
    {
      key: "man",
      part: "person_phone_adult_a",
      place: { relation: "next_to", target: "table" },
      facing: "camera",
    },
    {
      key: "machine",
      part: "vending_machine",
      place: { relation: "ground", zone: "back_left" },
    },
  ],
};

export const buildSystem = (
  parts: Part[],
) => `You design small 3D scenes for an English speaking game for Japanese learners.
Players look at the scene for a few seconds and describe it in English. They score points for each "element" they describe.
Build one scene of the requested difficulty and theme, using only the parts listed below. If no theme is given, choose one from the theme list. You do not write coordinates: you choose parts and how they relate to each other, and the program computes the positions.

# Scene
- The scene is an 8 m x 8 m square seen from the front (the camera side). Always start with exactly one ground part (category ground, 8 m x 8 m) placed with relation "ground" and no zone.
- Pick the ground that fits the place:
  - indoors: floor_wood (a home, a living room, a cafe, a restaurant, an office), floor_tile (a kitchen, a bathroom, a supermarket, a store, a hospital), floor_carpet (a bedroom, a hotel, a library), floor_classroom (a classroom, a school).
  - outdoors: grass_patch (a park, a garden, a lawn), sand_beach (a beach), sidewalk_stone (a street, a sidewalk, a town, a bus stop), ground_dirt (a playground, a sports field, a farm, a camp), road_patch (a road, a crossing), platform_station (a train station).
  - Never use grass_patch, sand_beach or ground_dirt indoors.
- Indoor scenes have one background wall: put it right after the ground with relation "ground" and no facing. The program always stands it at the back edge, facing the camera. Choose wall_kitchen_tile (a kitchen), wall_store_shelves (a supermarket, a store, a shop), wall_blackboard (a classroom), or wall_window (any other room). Outdoor scenes have no background wall. Do not use wall, window or clock indoors; the background walls already have windows, tiles, a blackboard or shelves. Nothing can go behind the background wall.
- In a kitchen, put kitchen_counter with relation "ground" and zone "back" (in front of the tiled wall); a pan or a pot can go on it.
- Train station: the ground is platform_station. Its back part (the back zones) is the railway track; the platform is the center and front. If there is a train, put it right after the ground with relation "ground" and zone "back"; it stands on the track. Put everything else on the platform (center, front, left, right; never a back zone) and away from the train, so nobody stands on the track or inside the train. A station has no background wall.
- zone: the scene is split into 3 x 3 zones. front is near the camera, back is far. left and right are as seen from the camera. Use zones to spread things out; keep the main action in center or front.
- Keep every item visible: do not hide small things inside or behind big ones.
- People and animals should usually face the camera or each other, so players can see what they do. To seat someone at a table, put the chair behind the table facing the table; then the person faces the camera.
- There is no relation to hang things on a wall. A door may stand on the ground at the back.

# Relations (place.relation)
- ground: on the ground in the zone (zone defaults to center).
- on: on top of target (on a table, on a box; on a bench or sofa means on its seat).
- in: inside target (only containers such as a box or a bag).
- under: under target (under a table, under a tree).
- above: floating just above target.
- next_to: beside target (left or right). Use for "beside" and "next to".
- in_front_of / behind: in front of / behind target, as target faces.
- near: close to target.
- between: between target and target2.
- sit_on: a sitting person (pose sit or write) sits on target (chair, bench, sofa, seat, bed). Only parts with anchors.hip can sit, and only on parts with anchors.seat.
target and target2 are keys of other items. Place an item only after its target in the list.

# Facing (optional)
camera (default), left, right, away, or the key of an item to face (e.g. a chair facing the table).

# Motion (optional, at most one per item)
- fall: falls straight down to the ground (an apple falling from a tree: relation under the tree + fall).
- move: moves in a straight line. toward: the key of an item or a zone to move to. path: "across" crosses the toward item (a road), "along" moves along it.
- rotate: spins around. sway: sways from side to side (a tree in the wind).
duration is seconds (fall about 1.2, move 4-8, rotate 3-6, sway 2).
Actions of people come from their pose (see the pose column, e.g. walk, run, sit, read, eat, carry, phone, hold, put, drink, write, look). Pick the part whose pose matches the action.

# Order of writing: description first, then elements, then items
- name: a short Japanese title of the scene.
- description: write it first. Plain English sentences that a player should say about the scene, one fact or action per sentence (the number of sentences depends on the difficulty). Every sentence must be true in the scene you then build: each person, animal, thing and relation it mentions must be an item. The grader uses it.
- elements: what players should describe, made from the description. id: short snake_case. label: short Japanese. accept: English wording that gets full points. partial (optional): English wording for half points.
  Give relations and actions (a dog running to a ball) more points than single nouns. Points are relative weights; the program scales them to a total of 90.
- items: last, the parts and relations that show exactly the description. Do not add people or actions that the description does not mention; a few background things are fine.

# Difficulty
${Object.entries(LEVELS)
  .map(([d, c]) => `- ${d}: ${c}`)
  .join("\n")}
The verbs a scene can show come from the poses of the people and animal parts. When no pose fits a verb of the level, make the scene harder with more complex relations (between, across, along, behind) and more sentences instead of using a verb the scene does not show.

# Themes (choose one when the request has no theme)
${THEMES.map((t) => `- ${t}`).join("\n")}
If the theme cannot be made with these parts, make the closest everyday scene you can with them.

# Parts (id | label | category | words | pose | size in meters | anchors)
${parts.map(describePart).join("\n")}

# Examples
Request: 難しさ: easy / テーマ: 公園
${JSON.stringify(EXAMPLE_EASY)}

Request: 難しさ: normal / テーマ: カフェ
${JSON.stringify(EXAMPLE_NORMAL)}`;

/** Claude に書かせる形。部品の ID は enum にして、一覧に無い部品が返らないようにする */
export const planSchema = (parts: Part[]) => ({
  type: "object",
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          points: { type: "integer" },
          accept: { type: "string" },
          partial: { type: "string" },
        },
        required: ["id", "label", "points", "accept"],
        additionalProperties: false,
      },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          part: { type: "string", enum: parts.map((p) => p.id) },
          place: {
            type: "object",
            properties: {
              relation: { type: "string", enum: [...RELATIONS] },
              target: { type: "string" },
              target2: { type: "string" },
              zone: { type: "string", enum: [...ZONES] },
            },
            required: ["relation"],
            additionalProperties: false,
          },
          facing: {
            type: "string",
            description: `${FACINGS.join(", ")}, or the key of an item to face`,
          },
          motion: {
            type: "object",
            properties: {
              type: { type: "string", enum: [...MOTIONS] },
              toward: {
                type: "string",
                description: "the key of an item or a zone",
              },
              path: { type: "string", enum: [...PATHS] },
              duration: { type: "number" },
            },
            required: ["type", "duration"],
            additionalProperties: false,
          },
        },
        required: ["key", "part", "place"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "description", "elements", "items"],
  additionalProperties: false,
});

// 返ってきた JSON を確かめる形（schema と同じ。部品の ID は compose.ts が一覧と突き合わせる）
const Plan = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        key: z.string().min(1),
        part: z.string(),
        place: z.object({
          relation: z.enum(RELATIONS),
          target: z.string().optional(),
          target2: z.string().optional(),
          zone: z.enum(ZONES).optional(),
        }),
        facing: z.string().optional(),
        motion: z
          .object({
            type: z.enum(MOTIONS),
            toward: z.string().optional(),
            path: z.enum(PATHS).optional(),
            duration: z.number(),
          })
          .optional(),
      }),
    )
    .min(1),
  elements: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().trim().min(1),
        points: z.number(),
        accept: z.string().trim().min(1),
        partial: z.string().optional(),
      }),
    )
    .min(1),
});

/** 生成の口への入力。theme を省けば、指示の中のテーマの一覧から Claude が選ぶ */
export type GenerateInput = { difficulty: Difficulty; theme?: string };

export const userMessage = (input: GenerateInput) =>
  `難しさ: ${input.difficulty}\nテーマ: ${input.theme ?? "一覧から選ぶ"}`;

export type GenerateResult = {
  plan: ScenePlan;
  model: string;
  attempts: number;
  usage: Anthropic.Usage[];
};

/** 失敗を種類に分け、やり直すかを決める。やり直すのは、形が違う・途中で止まった・5xx・接続の失敗だけ。
 * 断られた（refusal）・4xx（429 を含む）・タイムアウトはやり直さない */
export const classify = (
  e: unknown,
): { error: SceneGenerationError; retry: boolean } => {
  if (e instanceof SceneGenerationError) {
    return { error: e, retry: e.kind === "invalid" };
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return {
      error: new SceneGenerationError("unavailable", "Claude の応答が遅すぎた"),
      retry: false,
    };
  }
  if (e instanceof Anthropic.APIError) {
    const status = e.status;
    return {
      error: new SceneGenerationError(
        "unavailable",
        `Claude の API が失敗した（${status ?? "接続できない"}）`,
      ),
      retry: status === undefined || status >= 500,
    };
  }
  return {
    error: new SceneGenerationError(
      "unavailable",
      e instanceof Error ? e.message : String(e),
    ),
    retry: false,
  };
};

type CreateMessage = (
  params: Anthropic.MessageCreateParamsNonStreaming,
  options: { timeout: number; signal?: AbortSignal },
) => Promise<Anthropic.Message>;

const callOnce = async (
  create: CreateMessage,
  timeout: number,
  signal: AbortSignal | undefined,
  model: string,
  effort: Effort,
  system: string,
  schema: Record<string, unknown>,
  input: GenerateInput,
) => {
  const response = await create(
    {
      model,
      max_tokens: 8000,
      output_config: {
        effort,
        format: { type: "json_schema", schema },
      },
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage(input) }],
    },
    { timeout, signal },
  );
  if (response.stop_reason === "refusal") {
    throw new SceneGenerationError("refused", "Claude が断った");
  }
  if (response.stop_reason !== "end_turn") {
    throw new SceneGenerationError(
      "invalid",
      `Claude が途中で止まった（${response.stop_reason}）`,
    );
  }
  const text = response.content.find((b) => b.type === "text");
  if (text?.type !== "text") {
    throw new SceneGenerationError("invalid", "Claude の応答に本文が無い");
  }
  let json: unknown;
  try {
    json = JSON.parse(text.text);
  } catch {
    throw new SceneGenerationError("invalid", "Claude の応答が JSON でない");
  }
  const parsed = Plan.safeParse(json);
  if (!parsed.success) {
    throw new SceneGenerationError("invalid", "Claude の応答の形が違う");
  }
  return { plan: parsed.data as ScenePlan, usage: response.usage };
};

/** 各回の timeout（ms）。待合で待たせないので短くしない */
export const ATTEMPT_TIMEOUT_MS = 60_000;

/**
 * 呼び方の上書き。部屋の中で作るときは待たせないよう短い timeout で 1 回だけにする（既定は作り置き向け）。
 * signal で途中で止められる（ホストが抜けたとき）
 */
export type GenerateOptions = {
  /** 各回の timeout（ms）。既定は ATTEMPT_TIMEOUT_MS */
  timeoutMs?: number;
  /** 何回まで呼ぶか。既定は 2（1 回やり直す） */
  maxAttempts?: number;
  signal?: AbortSignal;
};

/**
 * 難易度（とテーマ）から場面の関係を書かせる。各回の timeout は 60 秒。
 * 形が違う・途中で止まった・5xx・接続の失敗のときだけ 1 回やり直す。だめなら SceneGenerationError を投げる。
 * options で timeout・回数・止める signal を変えられる。deps はテストで Claude を差し替えるためのもの
 */
export async function generatePlan(
  env: GenerateEnv,
  parts: Part[],
  input: GenerateInput,
  deps: { create?: CreateMessage } = {},
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  if (!env.CLAUDE_API_KEY) {
    throw new SceneGenerationError("unavailable", "CLAUDE_API_KEY が要る");
  }
  const model = env.CLAUDE_SCENE_MODEL || DEFAULT_SCENE_MODEL;
  const effort = effortOf(env.CLAUDE_SCENE_EFFORT);
  // SDK の再送は使わない（maxRetries 0）。やり直しはここで決める
  const create =
    deps.create ??
    (() => {
      const client = new Anthropic({
        apiKey: env.CLAUDE_API_KEY,
        maxRetries: 0,
      });
      return (
        params: Anthropic.MessageCreateParamsNonStreaming,
        callOptions: { timeout: number; signal?: AbortSignal },
      ) => client.messages.create(params, callOptions);
    })();
  const system = buildSystem(parts);
  const schema = planSchema(parts);
  const timeout = options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? 2;
  let last: SceneGenerationError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await callOnce(
        create,
        timeout,
        options.signal,
        model,
        effort,
        system,
        schema,
        input,
      );
      return {
        plan: result.plan,
        model,
        attempts: attempt,
        usage: [result.usage],
      };
    } catch (e) {
      const { error, retry } = classify(e);
      last = error;
      console.error(`場面の生成に失敗（${attempt} 回目）`, error.message);
      // 止められたら（APIUserAbortError は status が無く、やり直す側に分かれる）やり直さない
      if (!retry || options.signal?.aborted) break;
    }
  }
  throw last as SceneGenerationError;
}
