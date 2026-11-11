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
  /** 離れて相手とやり取りするポーズの間合い。両方が持つときは、この距離で向かい合う */
  range?: "far";
  /** 顔を向けている側（r は hand_r の側）と、反対側を向く部品の id */
  gaze?: "r" | "l";
  mirror?: string;
  anchors?: {
    top?: number;
    seat?: Vec3;
    hip?: Vec3;
    hand_l?: Vec3;
    hand_r?: Vec3;
    feet?: Vec3;
    head?: Vec3;
    canopy?: Vec3;
    spots?: Record<string, Vec3>;
    /** テーブルの席（床の上の椅子の位置）。名前は seat_<front|back|end>_<番号> */
    seats?: Record<string, Vec3>;
  };
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
  "seat_at",
  "relate",
  "thrown_by",
] as const;
export type Relation = (typeof RELATIONS)[number];

/**
 * relate の 4 要素。人と人、人と物の位置関係はすべてこの組み合わせで書く。
 * link: 相手につなぐ体の点（hand は手を相手に届かせる、body は体ごと離れて立つ、under は相手が持つ傘の下に入る）
 * side: 相手のどちら側か。相手に正面があれば相手の体が基準、無ければカメラから見た向き。any は計算で選ぶ
 * distance: 体の表面どうしの間合い。touch・beside・talk・approach・far
 * turn: 自分の向き。toward は相手へ、away は相手に背を向ける、same は相手と同じ向き
 */
export const LINKS = ["hand", "body", "under"] as const;
export const SIDES = ["any", "front", "back", "left", "right"] as const;
export const DISTANCES = [
  "touch",
  "beside",
  "talk",
  "approach",
  "far",
] as const;
export const TURNS = ["toward", "away", "same"] as const;

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
    /** on・relate で使う、相手の名前付きの場所（stove など） */
    spot?: string;
    link?: (typeof LINKS)[number];
    side?: (typeof SIDES)[number];
    distance?: (typeof DISTANCES)[number];
    turn?: (typeof TURNS)[number];
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
