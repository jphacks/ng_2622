import parts from "../../../assets/parts/index.json";

// 配置の JSON（docs/design/scene-protocol.md の items）と部品のメタデータ（assets/parts/index.json）から、
// 採点の基準の材料になる「場面の事実」を作る。座標から関係（on・next to・near）・動き・向きを計算し、
// Claude には座標ではなく言葉にした事実を渡す（見る向きで変わる左右・前後は使わない）

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
  anchors?: { top?: number; seat?: number[] };
  // 色はメタデータにあれば使う（今の index.json には無く、色は label や id に入っているものだけ）
  color?: unknown;
  colors?: unknown;
};

const catalog = new Map(
  (parts as PartMeta[]).map((p) => [p.id, p] as [string, PartMeta]),
);

// 置いたもの 1 つ分。座標は scale を掛けた外接する箱で近似する（yaw は無視して、水平は円で見る）
type Placed = {
  key: string;
  meta: PartMeta;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  top: number;
  yaw: number;
  motion?: LayoutItem["motion"];
};

// 上に載っているとみなす高さの差（m）と、隣・近くとみなす隙間（m）
const ON_TOLERANCE = 0.15;
const NEXT_TO_GAP = 0.6;
const NEAR_GAP = 2.0;
// 人と動物がどれを向いているか。正面からこの角度（度）の内にあり、この距離（m）の内にあるもの
const FACING_ANGLE = 30;
const FACING_DISTANCE = 4;

const toPlaced = (item: LayoutItem): Placed | null => {
  const meta = catalog.get(item.part.split("@")[0]);
  if (!meta) return null;
  const scale = Math.min(4, Math.max(0.25, item.scale ?? 1));
  const [w, h, d] = meta.size;
  const [x, y, z] = item.position;
  return {
    key: item.key,
    meta,
    x,
    y,
    z,
    radius: (Math.max(w, d) * scale) / 2,
    height: h * scale,
    top: y + (meta.anchors?.top ?? h) * scale,
    yaw: item.yaw ?? 0,
    motion: item.motion,
  };
};

const isGround = (p: Placed) => p.meta.category === "ground";
const isLiving = (p: Placed) =>
  p.meta.category === "person" || p.meta.category === "animal";

const gap = (a: Placed, b: Placed) =>
  Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius;

// a が b の上に載っているか（a の底面が b の上面の高さにあり、水平に b の範囲の中にある）
const isOn = (a: Placed, b: Placed) =>
  !isGround(b) &&
  Math.abs(a.y - b.top) <= ON_TOLERANCE &&
  Math.hypot(a.x - b.x, a.z - b.z) <= b.radius;

const nameOf = (p: Placed) => `${p.key} (${p.meta.label})`;

const nearest = (from: Placed, others: Placed[], at = from) =>
  others
    .filter((o) => o !== from && !isGround(o))
    .map((o) => ({ o, d: Math.hypot(o.x - at.x, o.z - at.z) }))
    .sort((a, b) => a.d - b.d)[0]?.o;

// 座るポーズの人が座面（anchors.seat）のある物に、宙の物が木などの形に、この距離（m）まで寄っていれば、
// そこに座っている・その中にあるとみなす（外接する箱を円で近似しているので少し余裕を持たせる）
const SIT_REACH = 0.3;

type Support = { o: Placed; relation: "on" | "sitting on" | "in" };

// p を支えている物。上に載る・座る・木などの形の中にある（宙のリンゴ）
const supportOf = (p: Placed, all: Placed[]): Support | null => {
  const others = all.filter((o) => o !== p && !isGround(o));
  const on = others.find((o) => isOn(p, o));
  if (p.meta.pose === "sit") {
    const seat = others
      .filter((o) => o.meta.anchors?.seat)
      .map((o) => ({ o, d: Math.hypot(o.x - p.x, o.z - p.z) }))
      .filter(({ o, d }) => d <= o.radius + SIT_REACH)
      .sort((a, b) => a.d - b.d)[0]?.o;
    if (seat) return { o: seat, relation: "sitting on" };
  }
  if (on) return { o: on, relation: "on" };
  if (p.y > ON_TOLERANCE) {
    const inside = others.find(
      (o) =>
        Math.hypot(o.x - p.x, o.z - p.z) <= o.radius + SIT_REACH &&
        p.y > o.y &&
        p.y < o.y + o.height,
    );
    if (inside) return { o: inside, relation: "in" };
  }
  return null;
};

const describeMotion = (p: Placed, all: Placed[]) => {
  const m = p.motion;
  if (!m) return null;
  switch (m.type) {
    case "fall": {
      const from = supportOf(p, all)?.o;
      return from
        ? `falls from ${nameOf(from)} to the ground`
        : "falls to the ground";
    }
    case "move": {
      if (!m.to) return "moves";
      const [x, , z] = m.to;
      const target = nearest(p, all, { ...p, x, z });
      return target
        ? `moves toward ${nameOf(target)}`
        : "moves across the scene";
    }
    case "rotate":
      return "turns around and around";
    case "sway":
      return "sways from side to side";
  }
};

// 正面（yaw 0 で +Z、上から見て反時計回り）の先にある、いちばん近いもの
const facingOf = (p: Placed, all: Placed[]) => {
  const rad = (p.yaw * Math.PI) / 180;
  const fx = Math.sin(rad);
  const fz = Math.cos(rad);
  let best: { o: Placed; d: number } | null = null;
  for (const o of all) {
    if (o === p || isGround(o)) continue;
    const dx = o.x - p.x;
    const dz = o.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d === 0 || d > FACING_DISTANCE) continue;
    const angle = (Math.acos((dx * fx + dz * fz) / d) * 180) / Math.PI;
    if (angle <= FACING_ANGLE && (!best || d < best.d)) best = { o, d };
  }
  return best?.o ?? null;
};

const describeThing = (p: Placed, all: Placed[]) => {
  const lines = [`- ${nameOf(p)}: category ${p.meta.category}`];
  const nouns = p.meta.words.filter((w) => w.pos === "noun").map((w) => w.word);
  const others = p.meta.words.filter((w) => w.pos !== "noun");
  lines.push(`  words: ${nouns.join(", ")}`);
  if (others.length > 0) {
    lines.push(
      `  other words: ${others.map((w) => `${w.word} (${w.pos})`).join(", ")}`,
    );
  }
  if (p.meta.pose) lines.push(`  pose: ${p.meta.pose}`);
  const color = p.meta.colors ?? p.meta.color;
  if (color !== undefined) lines.push(`  color: ${JSON.stringify(color)}`);
  lines.push(`  size: about ${p.height.toFixed(1)} m tall`);

  const support = supportOf(p, all);
  if (support) {
    lines.push(`  ${support.relation}: ${nameOf(support.o)}`);
    if (support.relation === "in") {
      lines.push(`  in the air, ${p.y.toFixed(1)} m above the ground`);
    }
  } else if (p.y > ON_TOLERANCE) {
    const below = nearest(p, all);
    lines.push(
      `  in the air, ${p.y.toFixed(1)} m above the ground${below ? `, near ${nameOf(below)}` : ""}`,
    );
  }
  const carried = all
    .map((o) => ({ o, s: o === p ? null : supportOf(o, all) }))
    .filter(({ s }) => s?.o === p);
  for (const { o, s } of carried) {
    lines.push(
      `  has ${s?.relation === "sitting on" ? "sitting on it" : `${s?.relation} it`}: ${nameOf(o)}`,
    );
  }
  // 机の上の物は、同じ机の上の物とだけ並べる（周りの椅子や人との「隣」は数が多く、言う意味も薄い）
  const onSomething = support?.relation === "on";
  const neighbors = all
    .filter(
      (o) =>
        o !== p &&
        !isGround(o) &&
        o !== support?.o &&
        !carried.some((c) => c.o === o) &&
        (!onSomething || supportOf(o, all)?.o === support?.o),
    )
    .map((o) => ({ o, g: gap(p, o) }))
    .filter((n) => n.g <= NEAR_GAP)
    .sort((a, b) => a.g - b.g)
    .slice(0, 3);
  for (const { o, g } of neighbors) {
    lines.push(`  ${g <= NEXT_TO_GAP ? "next to" : "near"}: ${nameOf(o)}`);
  }
  if (isLiving(p)) {
    const facing = facingOf(p, all);
    if (facing) lines.push(`  facing: ${nameOf(facing)}`);
  }
  const motion = describeMotion(p, all);
  if (motion) lines.push(`  motion: ${motion}`);
  return lines.join("\n");
};

/** 場面の事実を英語の箇条書きにする。部品が 1 つも分からなければ null */
export const describeLayout = (items: LayoutItem[]): string | null => {
  const placed = items.map(toPlaced).filter((p): p is Placed => p !== null);
  const things = placed.filter((p) => !isGround(p));
  if (things.length === 0) return null;
  const ground = placed.filter(isGround);

  const counts = new Map<string, number>();
  for (const p of things) {
    counts.set(p.meta.label, (counts.get(p.meta.label) ?? 0) + 1);
  }
  return [
    `Ground: ${ground.length > 0 ? ground.map((g) => `${g.meta.label} (${g.meta.words.map((w) => w.word).join(", ")})`).join("; ") : "none"}`,
    `Counts: ${[...counts].map(([label, n]) => `${label} x${n}`).join(", ")}`,
    "Things:",
    ...things.map((p) => describeThing(p, placed)),
  ].join("\n");
};

/** 知らない部品（メタデータに無い ID） */
export const unknownParts = (items: LayoutItem[]) =>
  items.map((i) => i.part.split("@")[0]).filter((id) => !catalog.has(id));
