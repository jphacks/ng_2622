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
  /** 手に持っている物（英語。別の部品として置かなくてよい）と、その動作に要るほかの部品の id */
  holds?: string;
  uses?: string[];
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

// 配置の JSON（scenenglish.scene/2。英文を先に書く 2 段の生成で作る）。
// 形の正本は docs/design/scene-protocol.md の「配置の JSON v2」

/** 級。難易度の値（start の difficulty・場面の difficulty・作り置きの一覧のキー）は、ここ 1 か所で決める */
export const GRADE_IDS = ["eiken-3", "eiken-pre2", "eiken-2"] as const;
export type GradeId = (typeof GRADE_IDS)[number];

/** 級の値として知らないもの（前の版で保存した部屋の easy など）を寄せる先 */
export const DEFAULT_GRADE: GradeId = "eiken-3";

/** 級の値でなければ DEFAULT_GRADE にする。保存された状態から読んだ値に使う */
export const toGradeId = (value: string): GradeId =>
  (GRADE_IDS as readonly string[]).includes(value)
    ? (value as GradeId)
    : DEFAULT_GRADE;

export const CHECKLIST_KINDS = ["center", "reason", "link", "detail"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];

/** チェックリストの 1 項目。形は採点（backend/src/scoring/）と同じ。重みは保存しない */
export type ChecklistItem = {
  id: string;
  kind: ChecklistKind;
  /** 振り返りに出す日本語 */
  label: string;
  /** 「言えた」とする英語の言い方。description に含める */
  accept: string;
  /** 項目が指す items の key。reason・link は原因と行動の 2 つ以上 */
  refs: string[];
};

/** 1 回目に Claude が書く英文の部分（部品の一覧は見ない。refs は呼び名） */
export type SceneSentences = {
  name: string;
  description: string;
  checklist: ChecklistItem[];
};

/** 2 段で Claude が書いた場面（座標なし）。1 回目の英文の部分と、2 回目の items */
export type ScenePlanV2 = SceneSentences & { items: PlanItem[] };

/**
 * 配置の動き。座標の動きに、Claude が書いた動きの関係（toward・path）を並べる。
 * 1 つの部品に動きは 1 つなので、欄を分けると type と duration が二重になる
 */
export type MotionV2 = Motion & {
  /** 行き先の key か区画（Claude が書いた関係） */
  toward?: string;
  path?: (typeof PATHS)[number];
};

/** 置く部品。Claude が書いた関係（place・facing）と、計算した座標（position・yaw）の両方を持つ */
export type LayoutItemV2 = {
  key: string;
  part: string;
  place: PlanItem["place"];
  facing?: string;
  position: Vec3;
  yaw?: number;
  scale?: number;
  motion?: MotionV2;
};

/** 配置の JSON（protocol scenenglish.scene/2） */
export type SceneLayoutV2 = {
  protocol: "scenenglish.scene/2";
  id: string;
  name: string;
  difficulty: GradeId;
  description: string;
  checklist: ChecklistItem[];
  items: LayoutItemV2[];
};
