// AI で場面を作る口（POST /scenes/generate）と、配置の JSON の型。
// 形の正本は docs/design/scene-protocol.md の「配置の JSON」と「Claude に書かせる形と呼び方」

export type Vec3 = [number, number, number];

/** 部品のメタデータ（parts.json の 1 件。形は scene-protocol.md の「部品のメタデータ」） */
export type Part = {
  id: string;
  version: number;
  file: string;
  category: string;
  words: { word: string; pos: string }[];
  pose?: string;
  size: Vec3;
  label: string;
  anchors?: { top?: number; seat?: Vec3; hip?: Vec3 };
};

export const DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** 9 区画。front はカメラ側（+Z）、back は奥（-Z）、left は -X */
export const ZONES = [
  "back_left",
  "back",
  "back_right",
  "left",
  "center",
  "right",
  "front_left",
  "front",
  "front_right",
] as const;
export type Zone = (typeof ZONES)[number];

export const RELATIONS = [
  "ground",
  "on",
  "in",
  "under",
  "above",
  "next_to",
  "in_front_of",
  "behind",
  "near",
  "between",
  "sit_on",
] as const;
export type Relation = (typeof RELATIONS)[number];

export const FACINGS = ["camera", "left", "right", "away"] as const;
export const MOTIONS = ["fall", "move", "rotate", "sway"] as const;
export const PATHS = ["across", "along"] as const;

/** Claude が書く場面（座標なし。部品どうしの関係だけ） */
export type ScenePlan = {
  name: string;
  description: string;
  items: PlanItem[];
  elements: SceneElementInput[];
};

export type PlanItem = {
  key: string;
  part: string;
  place: {
    relation: Relation;
    target?: string;
    target2?: string;
    zone?: Zone;
  };
  /** camera・left・right・away か、向く相手の key */
  facing?: string;
  motion?: {
    type: (typeof MOTIONS)[number];
    /** 行き先の key か区画 */
    toward?: string;
    path?: (typeof PATHS)[number];
    duration: number;
  };
};

export type SceneElementInput = {
  id: string;
  label: string;
  points: number;
  accept: string;
  partial?: string;
};

export type Motion = {
  type: (typeof MOTIONS)[number];
  to?: Vec3;
  angle?: number;
  duration: number;
  delay?: number;
  loop?: boolean;
};

export type LayoutItem = {
  key: string;
  part: string;
  position: Vec3;
  yaw?: number;
  scale?: number;
  motion?: Motion;
};

/** 配置の JSON（protocol scenenglish.scene/1） */
export type SceneLayout = {
  protocol: "scenenglish.scene/1";
  id: string;
  name: string;
  difficulty: Difficulty;
  description: string;
  elements: SceneElementInput[];
  extraMax: number;
  items: LayoutItem[];
};
