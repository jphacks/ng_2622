import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  DISTANCES,
  FACINGS,
  LINKS,
  MOTIONS,
  PATHS,
  type Part,
  RELATIONS,
  SIDES,
  TURNS,
  ZONES,
} from "./types";

// 場面の生成で使う共通の物（モデルと effort・失敗の種類・テーマ・場面の決まり・items の形・呼び方の上書き）。
// 生成の本体は generate-v2.ts（英文を先に書く 2 段の生成）。座標は compose.ts が計算する

export const DEFAULT_SCENE_MODEL = "claude-sonnet-5-5";
const DEFAULT_SCENE_EFFORT = "low";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

// 知らない値は既定に戻す（採点の claude.ts と同じ）
export const effortOf = (raw: string | undefined): Effort =>
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

/** 場面・関係・向き・動きの決まり。2 段の生成の 2 回目（generate-v2.ts）の指示に入れる */
export const SCENE_RULES = `# Scene
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
Actions of people come from their pose (see the pose column, e.g. walk, run, sit, read, eat, carry, phone, hold, put, drink, write, look). Pick the part whose pose matches the action.`;

/** items の形。2 段の生成の 2 回目に書かせる */
export const itemsSchema = (parts: Part[]) => ({
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
          spot: { type: "string" },
          link: { type: "string", enum: [...LINKS] },
          side: { type: "string", enum: [...SIDES] },
          distance: { type: "string", enum: [...DISTANCES] },
          turn: { type: "string", enum: [...TURNS] },
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
});

/** 返ってきた items を確かめる形（itemsSchema と同じ） */
export const PlanItems = z
  .array(
    z.object({
      key: z.string().min(1),
      part: z.string(),
      place: z.object({
        relation: z.enum(RELATIONS),
        target: z.string().optional(),
        target2: z.string().optional(),
        zone: z.enum(ZONES).optional(),
        spot: z.string().optional(),
        link: z.enum(LINKS).optional(),
        side: z.enum(SIDES).optional(),
        distance: z.enum(DISTANCES).optional(),
        turn: z.enum(TURNS).optional(),
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
  .min(1);

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

export type CreateMessage = (
  params: Anthropic.MessageCreateParamsNonStreaming,
  options: { timeout: number; signal?: AbortSignal },
) => Promise<Anthropic.Message>;

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
