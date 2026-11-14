import parts from "../../../assets/parts/index.json";

// 配置の JSON（docs/design/scene-protocol.md の「配置の JSON v2」の items）と部品のメタデータ（assets/parts/index.json）から、
// 採点で Claude に渡す場面の情報を作る。部品ごとの名前・words・大きさ・座標・向き・動きと、生成で書いた関係（place など）を渡す

type LayoutItem = {
  key: string;
  part: string;
  position: [number, number, number];
  yaw?: number;
  scale?: number;
  motion?: {
    type: "fall" | "move" | "rotate" | "sway";
    to?: [number, number, number];
  };
};

/**
 * scenenglish.scene/2 の items の 1 つ。座標に加えて、生成で Claude が書いた関係（place・facing・動きの行き先）も残る。
 * ここでは採点で読む欄だけを最小限に書く（形の正本は docs/design/scene-protocol.md の「配置の JSON v2」）
 */
export type RelationItem = Omit<LayoutItem, "motion"> & {
  place?: {
    relation: string;
    target?: string;
    target2?: string;
    zone?: string;
    spot?: string;
    link?: string;
    side?: string;
    distance?: string;
    turn?: string;
  };
  // camera・left・right・away か、向く相手の key
  facing?: string;
  // 座標の動き（to）と関係の動き（toward・path）を同じ欄に並べる
  motion?: NonNullable<LayoutItem["motion"]> & {
    toward?: string;
    path?: string;
  };
};

/** 部品のメタデータのうち、採点で読む欄。作った部品（R2 のメタデータ）もこの形で渡す */
export type PartMeta = {
  id: string;
  category: string;
  words: { word: string; pos: string }[];
  pose?: string;
  size: number[];
  label: string;
  // 色はメタデータにあれば使う（今の index.json には無く、色は label や id に入っているものだけ）
  color?: unknown;
  colors?: unknown;
};

const catalog = new Map(
  (parts as PartMeta[]).map((p) => [p.id, p] as [string, PartMeta]),
);

// 座標の決まり（scene-protocol.md の「座標」）。左右・前後は見る向きで変わるので、どちらでも正解にする
const COORDINATES = `Coordinates: meters. Y is up and the ground is y = 0. The scene is an 8 m square centered at the origin (x and z from -4 to 4). The default camera looks from the +Z side, but players can rotate the scene freely. position is the bottom center of the thing. yaw is degrees around Y, counterclockwise seen from above; at yaw 0 the thing faces +Z. size is width (x), height (y), depth (z) after scale.`;

const num = (n: number) => Number(n.toFixed(2));
const vec = (v: number[]) => `[${v.map(num).join(", ")}]`;

const describeMotion = (m: NonNullable<LayoutItem["motion"]>) => {
  switch (m.type) {
    case "fall":
      return "falls straight down to the ground";
    case "move":
      return m.to ? `moves in a straight line to ${vec(m.to)}` : "moves";
    case "rotate":
      return "turns around and around";
    case "sway":
      return "sways from side to side";
  }
};

// 生成で書いた関係を 1 行にする。例: "sit_on bench"、"between tree and bench"、"relate woman (link hand, side front)"
const describePlace = (place: NonNullable<RelationItem["place"]>) => {
  const { relation, target, target2, ...rest } = place;
  const targets = [target, target2].filter(Boolean).join(" and ");
  const options = Object.entries(rest)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return [relation, targets, options && `(${options})`]
    .filter(Boolean)
    .join(" ");
};

const describeRelations = (item: RelationItem) => {
  const lines: string[] = [];
  if (item.place) lines.push(`  place: ${describePlace(item.place)}`);
  if (item.facing) lines.push(`  facing: ${item.facing}`);
  if (item.motion?.toward) {
    const path = item.motion.path ? ` (${item.motion.path} it)` : "";
    lines.push(`  moves toward: ${item.motion.toward}${path}`);
  }
  return lines;
};

const describeItem = (item: LayoutItem, meta: PartMeta) => {
  const scale = Math.min(4, Math.max(0.25, item.scale ?? 1));
  const words = meta.words.map((w) =>
    w.pos === "noun" ? w.word : `${w.word} (${w.pos})`,
  );
  const lines = [
    `- ${item.key}: ${meta.label} / ${meta.category}`,
    `  words: ${words.join(", ")}`,
  ];
  if (meta.pose) lines.push(`  pose: ${meta.pose}`);
  const color = meta.colors ?? meta.color;
  if (color !== undefined) lines.push(`  color: ${JSON.stringify(color)}`);
  lines.push(
    `  size: ${vec(meta.size.map((s) => s * scale))}`,
    `  position: ${vec(item.position)}`,
  );
  if (item.yaw) lines.push(`  yaw: ${num(item.yaw)}`);
  if (item.motion) lines.push(`  motion: ${describeMotion(item.motion)}`);
  return lines.join("\n");
};

// 関係の読み方。座標より読み違えにくいので、位置の関係はこちらを先に見させる
const RELATIONS = `Relations: place, facing and "moves toward" are how the scene was built; the positions were computed from them. Use them first to tell where things are, and the coordinates for the rest. place is a relation to the key of another thing (on, in, under, above, next_to, in_front_of, behind, near, between, sit_on, seat_at, relate, thrown_by), or "ground" with a zone of the square (front is the +Z side, back is -Z, left is -X). relate means the thing interacts with the target (link: the body part that reaches it; side, distance and turn: where it stands and which way it faces). facing is camera (+Z), left, right, away, or the key it faces.`;

/**
 * 場面の情報を英語の箇条書きにする。座標の行に、生成で書いた関係（place・facing・動きの行き先）を書き足す。
 * 関係の無い item は座標の行だけになる。地面のほかに部品が 1 つも分からなければ null。
 * extraParts は同梱の一覧（assets/parts/index.json）に無い部品（苦手の場面でその場で作った部品）のメタデータ。
 * 同梱の部品が先（同じ ID は同梱のものを使う）
 */
export const describeLayoutWithRelations = (
  items: RelationItem[],
  extraParts: readonly PartMeta[] = [],
): string | null => {
  const extra = new Map(extraParts.map((p) => [p.id, p]));
  const metaOf = (part: string) => {
    const id = part.split("@")[0];
    return catalog.get(id) ?? extra.get(id);
  };
  const known = items
    .map((item) => ({ item, meta: metaOf(item.part) }))
    .filter((k): k is { item: RelationItem; meta: PartMeta } => !!k.meta);
  if (known.every(({ meta }) => meta.category === "ground")) return null;
  return [
    COORDINATES,
    RELATIONS,
    "Things (nothing else is in the scene):",
    ...known.map(({ item, meta }) =>
      [describeItem(item, meta), ...describeRelations(item)].join("\n"),
    ),
  ].join("\n");
};
