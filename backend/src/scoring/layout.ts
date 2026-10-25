import parts from "../../../assets/parts/index.json";

// 配置の JSON（docs/design/scene-protocol.md の items）と部品のメタデータ（assets/parts/index.json）から、
// 採点で Claude に渡す場面の情報を作る。部品ごとの名前・words・大きさ・座標・向き・動きを、座標のまま渡す。
// 位置の関係を Claude が座標から読み違えることが多ければ、関係を計算して渡す形に切り替える
// （ADR 20261025-score-content-with-layout-and-rubric-bands）

export type LayoutItem = {
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

type PartMeta = {
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

/** 場面の情報を英語の箇条書きにする。地面のほかに部品が 1 つも分からなければ null */
export const describeLayout = (items: LayoutItem[]): string | null => {
  const known = items
    .map((item) => ({ item, meta: catalog.get(item.part.split("@")[0]) }))
    .filter((k): k is { item: LayoutItem; meta: PartMeta } => !!k.meta);
  if (known.every(({ meta }) => meta.category === "ground")) return null;
  return [
    COORDINATES,
    "Things (nothing else is in the scene):",
    ...known.map(({ item, meta }) => describeItem(item, meta)),
  ].join("\n");
};
