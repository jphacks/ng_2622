import type { LayoutItem, Motion, Part, PlanItem, Vec3, Zone } from "./types";

// Claude が書いた「関係」（PlanItem）を、部品の size と anchors から座標に直す。配置の JSON にまとめるのは compose-v2.ts。
// 規則の正本は docs/design/scene-protocol.md の「Claude に書かせる形と呼び方」。Cloudflare に依存しない純粋な関数

/** 場面の半分の幅（m）。場面は一辺 8 m で、x・z は -4〜4 */
export const HALF = 4;
/** 関係で並べるときの、相手との隙間（m） */
export const GAP = 0.1;
/** above で相手の上に空ける高さ（m） */
export const ABOVE_GAP = 0.3;
export const MAX_ITEMS = 40;
/** 区画の真ん中どうしの間隔（8 m を 3 つに分ける） */
const ZONE_STEP = (HALF * 2) / 3;
/** 地面に置くときに探す点の間隔（m） */
const GRID_STEP = 0.25;
/** 物の上に置くときに探す点の間隔（m） */
const TOP_STEP = 0.05;
/** 重なりの判定で、これより近ければ重なりとみなす隙間（m） */
const MIN_CLEARANCE = 0.05;
/** 座る人を並べるときの、1 人分の幅の上限（m） */
const SEAT_SLOT = 0.6;
/** 木から落ちるものの位置（木の幅・奥行き・高さに対する割合）。仕様の例（木 (0,0,-1.5)、リンゴ (0.4,2.2,-1.2)）に合わせた */
const FALL_FROM_PLANT = { x: 0.16, z: 0.125, y: 0.62 };
/** 地面から落とすとき、これより低ければ持ち上げる（m） */
const FALL_MIN_Y = 0.3;
const FALL_DEFAULT_Y = 2;
const DEFAULT_DURATION = { fall: 1.2, move: 6, rotate: 4, sway: 2 } as const;
/** 行き先の無い move で進む距離（m） */
const MOVE_DISTANCE = 4;
/** move で最低限動く距離（m）。近すぎる行き先は出発点を後ろへ引く */
export const MIN_MOVE = 1.5;
/** 出発点を引くときの刻み（m） */
const MOVE_STEP = 0.1;
const EPS = 1e-6;
/** 木の中に置く物の高さ（木の高さに対する割合） */
const IN_PLANT_HEIGHT = 0.6;

/** 地面と同じ高さに置く、大きな物の区分（人の横などに置くとき、相手が机の上でも地面に置く） */
const FLOOR_CATEGORIES = new Set([
  "person",
  "animal",
  "plant",
  "furniture",
  "vehicle",
  "building",
]);

type Placed = {
  key: string;
  part: Part;
  position: Vec3;
  yaw: number;
  /** 載っている面。"ground" か、載せた相手の key。"air" は重なりを見ない */
  surface: string;
  hx: number;
  hz: number;
};

const round = (n: number, digits = 3) => {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

const rad = (deg: number) => (deg * Math.PI) / 180;

/** -180 より大きく 180 以下にそろえる */
const normalizeYaw = (deg: number) => {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
};

/** 向いている向きへの yaw。0 で +Z（カメラ側）、90 で +X */
export const yawToward = (dx: number, dz: number) =>
  normalizeYaw((Math.atan2(dx, dz) * 180) / Math.PI);

/** 部品の中の点 [x, y, z] を、yaw だけ回した向きにする（上から見て反時計回りが正） */
export const rotate = ([x, y, z]: Vec3, yaw: number): Vec3 => {
  const c = Math.cos(rad(yaw));
  const s = Math.sin(rad(yaw));
  return [x * c + z * s, y, -x * s + z * c];
};

/** 上から見た外接する箱の半分の幅（x）と奥行き（z） */
export const footprint = (size: Vec3, yaw: number) => {
  const c = Math.abs(Math.cos(rad(yaw)));
  const s = Math.abs(Math.sin(rad(yaw)));
  return {
    hx: (c * size[0] + s * size[2]) / 2,
    hz: (s * size[0] + c * size[2]) / 2,
  };
};

/** 区画の真ん中の [x, z] */
export const zoneCenter = (zone: Zone | undefined): [number, number] => {
  const z = zone ?? "center";
  const row = z.startsWith("back") ? -1 : z.startsWith("front") ? 1 : 0;
  const col = z.endsWith("left") ? -1 : z.endsWith("right") ? 1 : 0;
  return [col * ZONE_STEP, row * ZONE_STEP];
};

/** 原点を、部品が場面からはみ出さない範囲に収める（部品が場面より大きければ真ん中） */
const clampXZ = (x: number, z: number, hx: number, hz: number) => {
  const lx = Math.max(0, HALF - hx);
  const lz = Math.max(0, HALF - hz);
  return [clamp(x, -lx, lx), clamp(z, -lz, lz)] as const;
};

const FACING_YAW: Record<string, number> = {
  camera: 0,
  left: -90,
  right: 90,
  away: 180,
};

const isGroundPart = (part: Part) => part.category === "ground";

/** 場面の幅いっぱいの建物（背景の壁 wall_window など）。区画にかかわらず奥の端に付ける */
const isBackdrop = (part: Part) =>
  part.category === "building" &&
  Math.max(part.size[0], part.size[2]) >= HALF * 2 - EPS;

/** 重ならない名前にする（同じ名前には _2、_3 を付ける） */
const uniqueNames = <T>(list: T[], get: (t: T) => string) => {
  const seen = new Set<string>();
  return list.map((t) => {
    const base = get(t).trim() || "item";
    let name = base;
    for (let n = 2; seen.has(name); n++) name = `${base}_${n}`;
    seen.add(name);
    return name;
  });
};

/** 場面の中で、gx・gz を中心に近い順に並べた地面の点 */
const gridAround = (cx: number, cz: number, step = GRID_STEP) => {
  const n = Math.round(HALF / step);
  const points: [number, number][] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) points.push([i * step, j * step]);
  }
  return points.sort(
    (a, b) =>
      Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz),
  );
};

/** 中心 cx・cz から半幅 rx・rz の中の点を、中心に近い順に */
const gridWithin = (cx: number, cz: number, rx: number, rz: number) => {
  const nx = Math.floor(Math.max(0, rx) / TOP_STEP + EPS);
  const nz = Math.floor(Math.max(0, rz) / TOP_STEP + EPS);
  const points: [number, number][] = [];
  for (let i = -nx; i <= nx; i++) {
    for (let j = -nz; j <= nz; j++) {
      points.push([cx + i * TOP_STEP, cz + j * TOP_STEP]);
    }
  }
  return points.sort(
    (a, b) =>
      Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz),
  );
};

/** yaw の向きに近い、軸に沿った向き（[ux, uz] のどちらかが ±1） */
const axisOf = (yaw: number): [number, number] => {
  const [fx, , fz] = rotate([0, 0, 1], yaw);
  return Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
};

type Composer = {
  /** 関係を満たせず、仕方なく置いた数（全体を解くときの点数に使う） */
  misses: number;
  /** 背景の壁に人を付けた場面。全体をずらすと壁から離れる */
  pinned: boolean;
  /** テーブルごとに使った席の数 */
  seated: Map<string, number>;
  parts: Map<string, Part>;
  placed: Map<string, Placed>;
};

const overlaps = (
  a: { x: number; z: number; hx: number; hz: number },
  b: Placed,
) =>
  Math.abs(a.x - b.position[0]) < a.hx + b.hx + MIN_CLEARANCE - EPS &&
  Math.abs(a.z - b.position[2]) < a.hz + b.hz + MIN_CLEARANCE - EPS;

/** 候補の点のうち、同じ面の物と重ならない最初の点（どれも重なるなら最初の点） */
const pickSpot = (
  c: Composer,
  candidates: [number, number][],
  self: { hx: number; hz: number; surface: string },
  exclude: string[] = [],
): [number, number] => {
  const others = [...c.placed.values()].filter(
    (p) =>
      p.surface === self.surface &&
      p.surface !== "air" &&
      !isGroundPart(p.part) &&
      !exclude.includes(p.key),
  );
  let first: [number, number] | undefined;
  for (const [x0, z0] of candidates) {
    const [x, z] = clampXZ(x0, z0, self.hx, self.hz);
    first ??= [x, z];
    if (!others.some((o) => overlaps({ x, z, hx: self.hx, hz: self.hz }, o))) {
      return [x, z];
    }
  }
  return first ?? [0, 0];
};

/** 相手の横（[ux, uz] の向き）に隙間を空けて並べる候補。重なれば外へずらす */
const besideCandidates = (
  target: Placed,
  self: { hx: number; hz: number },
  dirs: [number, number][],
) => {
  const out: [number, number][] = [];
  const [tx, , tz] = target.position;
  // 近い順: 隙間だけ空けた位置（向きの順）→ 横にずらした位置 → 一つ外
  for (let k = 0; k < 4; k++) {
    for (const shift of [0, 1, -1]) {
      for (const [ux, uz] of dirs) {
        const dx = ux * (target.hx + self.hx + GAP + k * (2 * self.hx + GAP));
        const dz = uz * (target.hz + self.hz + GAP + k * (2 * self.hz + GAP));
        // 斜めはずらさない。前後に並べるときは x に、左右のときは z にずらす
        if (shift !== 0 && ux !== 0 && uz !== 0) continue;
        const lx = ux === 0 ? shift * (2 * self.hx + GAP) : 0;
        const lz = uz === 0 && ux !== 0 ? shift * (2 * self.hz + GAP) : 0;
        out.push([tx + dx + lx, tz + dz + lz]);
      }
    }
  }
  return out;
};

const RIGHT_LEFT: [number, number][] = [
  [1, 0],
  [-1, 0],
];
const DIAGONALS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

type Spot = { position: Vec3; surface: string; yaw?: number };

/** relate の間合い（体の表面どうし、m）。人の距離の感覚に合わせる */
const DISTANCE = {
  touch: 0,
  beside: 0.1,
  talk: 0.45,
  approach: 1.2,
  far: 2.6,
} as const;
/** 横に並ぶ人を前後にずらす量（m） */
const STAGGER = 0.55;
/** 傘の中心から、入る人の足元までの距離（m） */
const UNDER_OFFSET = 0.3;
/** 人の体の半分の幅（m） */
const BODY_RADIUS = 0.2;
/** 手を伸ばす人が相手の縁から空ける距離（足元から、m） */
const BODY_CLEARANCE = 0.2;
/** 人が立てる範囲（m） */
const STAND_LIMIT = 3.7;
/** 投げた物の高さと、投げた人からの距離（m） */
const THROWN_HEIGHT = 1.15;
const THROWN_DISTANCE = 1.35;

const LIVING_CATEGORIES = new Set(["person", "animal"]);
const SOLID_CATEGORIES = new Set(["furniture", "vehicle", "building"]);

const forwardOf = (yaw: number): [number, number] => [
  Math.sin(rad(yaw)),
  Math.cos(rad(yaw)),
];

/** 部品の足元（基準点が無ければ原点）の場面での位置 */
const feetOf = (p: Placed): [number, number] => {
  const f = rotate(p.part.anchors?.feet ?? [0, 0, 0], p.yaw);
  return [p.position[0] + f[0], p.position[2] + f[2]];
};

/** 足元が (x, z) に来るように部品を置く */
const standAt = (part: Part, x: number, z: number, yaw: number): Spot => {
  const f = rotate(part.anchors?.feet ?? [0, 0, 0], yaw);
  return { position: [x - f[0], 0, z - f[2]], surface: "ground", yaw };
};

/** 足元に立てるか。家具に埋まらず、ほかの人と重ならず、場面の中にある */
const canStand = (c: Composer, x: number, z: number, skip: string[] = []) => {
  if (Math.abs(x) > STAND_LIMIT || Math.abs(z) > STAND_LIMIT) return false;
  for (const p of c.placed.values()) {
    if (skip.includes(p.key)) continue;
    if (LIVING_CATEGORIES.has(p.part.category)) {
      const [fx, fz] = feetOf(p);
      if (Math.hypot(fx - x, fz - z) < 0.5) return false;
    } else if (SOLID_CATEGORIES.has(p.part.category) && !isBackdrop(p.part)) {
      const dx = Math.abs(x - p.position[0]);
      const dz = Math.abs(z - p.position[2]);
      if (dx < p.hx + 0.15 && dz < p.hz + 0.15) return false;
    }
  }
  return true;
};

/** 手が前に長く伸びているほうの手（部品の中の座標、足元からの差） */
const reachingHand = (part: Part): Vec3 => {
  const a = part.anchors;
  const feet = a?.feet ?? [0, 0, 0];
  const rel = (h: Vec3): Vec3 => [h[0] - feet[0], h[1], h[2] - feet[2]];
  const r = rel(a?.hand_r ?? [0, 1, 0.3]);
  const l = rel(a?.hand_l ?? [0, 1, 0.3]);
  return r[2] >= l[2] ? r : l;
};

/** 上から見て、向き (ux, uz) に部品がどれだけ張り出すか */
const extentToward = (part: Part, yaw: number, ux: number, uz: number) => {
  const c = Math.cos(rad(yaw));
  const n = Math.sin(rad(yaw));
  return (
    (Math.abs(ux * c - uz * n) * part.size[0] +
      Math.abs(ux * n + uz * c) * part.size[2]) /
    2
  );
};

const isLiving = (part: Part) => LIVING_CATEGORIES.has(part.category);

/** side を向きの候補にする。相手に正面があれば相手の体が基準、無ければカメラから見た向き */
const sideDirs = (
  target: Placed,
  side: PlanItem["place"]["side"],
  flip: boolean,
): [number, number][] => {
  // 背景の壁の前には手前からしか立てない
  if (isBackdrop(target.part)) return [[0, 1]];
  const framed =
    isLiving(target.part) ||
    !!target.part.anchors?.spots ||
    !!target.part.anchors?.seat;
  const [fx, fz] = framed ? forwardOf(target.yaw) : [0, 1];
  const named: Record<string, [number, number]> = {
    front: [fx, fz],
    back: [-fx, -fz],
    right: framed ? [fz, -fx] : [1, 0],
    left: framed ? [-fz, fx] : [-1, 0],
  };
  // 正面の無い物には前後左右の意味が無いので、計算に任せる。前後の指定は希望で、計算が選んだときは左右へ逃がす
  if (framed && side && side !== "any") {
    const wish = named[side];
    if (!flip || side === "left" || side === "right") return [wish];
  }
  // 左右を先に試す（カメラ側から近づくと背中を見せる）
  const across: [number, number][] = flip
    ? [
        [-1, 0],
        [1, 0],
      ]
    : [
        [1, 0],
        [-1, 0],
      ];
  return [...across, [0, -1], [0, 1]];
};

/** 手が相手に届く位置に立たせる。スポット付きの家具は正面から */
const placeHand = (
  c: Composer,
  part: Part,
  target: Placed,
  place: PlanItem["place"],
  flip: boolean,
): Spot => {
  // surface の "ground" と "air" は面の種類で、部品の key ではない（床の key が ground のこともある）
  const onItem = target.surface !== "ground" && target.surface !== "air";
  const support = (onItem && c.placed.get(target.surface)) || target;
  if (isBackdrop(target.part)) c.pinned = true;
  // 場所を持つ家具で指定が無ければ、最初の場所（コンロ・レジなど、その家具の主な場所）に手を届かせる
  const spots = target.part.anchors?.spots;
  const local = spots
    ? (spots[place.spot ?? ""] ?? Object.values(spots)[0])
    : undefined;
  const w = local ? rotate(local, target.yaw) : undefined;
  const point: [number, number] = w
    ? [target.position[0] + w[0], target.position[2] + w[2]]
    : [target.position[0], target.position[2]];
  const frontOnly = !!support.part.anchors?.spots;
  const dirs = frontOnly
    ? [forwardOf(support.yaw)]
    : sideDirs(support, place.side, flip);
  const hand = reachingHand(part);
  let first: Spot | undefined;
  for (const [ux, uz] of dirs) {
    const fromCenter =
      (point[0] - support.position[0]) * ux +
      (point[1] - support.position[2]) * uz;
    const edge = Math.max(
      0,
      extentToward(support.part, support.yaw, ux, uz) - fromCenter,
    );
    const yaw = yawToward(-ux, -uz);
    const h = rotate(hand, yaw);
    const forwardReach = -(h[0] * ux + h[2] * uz);
    const back = Math.max(forwardReach, edge + BODY_CLEARANCE);
    // 手が相手の真上に来るよう、横のずれを足元で打ち消す
    const side = [h[0] + forwardReach * ux, h[2] + forwardReach * uz];
    const x = point[0] + ux * back - side[0];
    const z = point[1] + uz * back - side[1];
    const candidate = standAt(part, x, z, yaw);
    first ??= candidate;
    if (canStand(c, x, z, [target.key, support.key])) return candidate;
  }
  c.misses++;
  return first as Spot;
};

/** relate の under: 相手が持つ傘の下に、相手を向いて立つ。傘の中心を挟んで相手の反対側 */
const placeUnder = (c: Composer, part: Part, target: Placed): Spot => {
  const canopy = target.part.anchors?.canopy;
  const [tx, tz] = feetOf(target);
  const w = canopy ? rotate(canopy, target.yaw) : [0, 0, 0];
  const cx = target.position[0] + w[0];
  const cz = target.position[2] + w[2];
  const d = Math.hypot(cx - tx, cz - tz) || 1;
  const x = cx + ((cx - tx) / d) * UNDER_OFFSET;
  const z = cz + ((cz - tz) / d) * UNDER_OFFSET;
  if (!canStand(c, x, z, [target.key])) c.misses++;
  return standAt(part, x, z, yawToward(tx - x, tz - z));
};

/** 距離の指定を保ったまま空きを探すときの、間合いのずらし方（m）。近い間合いは意味が変わるのでずらさない */
const STRETCH = [0, -0.5, 0.5, -1, 1];
/** 背景の壁の前で、先に立つ人を避けて横へずらす量（m） */
const BACKDROP_LANES = [1.2, -1.2, 2.4, -2.4, 0];

/** relate の body: 相手の side の側に、distance の間合いで、turn の向きに立つ */
const placeBody = (
  c: Composer,
  part: Part,
  target: Placed,
  place: PlanItem["place"],
  flip: boolean,
): Spot => {
  const living = isLiving(target.part);
  const backdrop = isBackdrop(target.part);
  if (backdrop) c.pinned = true;
  const [ox, oz] = living
    ? feetOf(target)
    : [target.position[0], target.position[2]];
  // どちらも離れてやり取りするポーズなら、動作が間合いと向きを決める
  const range = part.range && target.part.range ? part.range : undefined;
  const distance = range ?? place.distance ?? "talk";
  const gap = DISTANCE[distance];
  const side = range ? "front" : place.side;
  const stretches =
    distance === "far" || distance === "approach" ? STRETCH : [0];
  const lanes = backdrop ? BACKDROP_LANES.map((l) => (flip ? -l : l)) : [0];
  const spots = sideDirs(target, side, flip && !range).flatMap(([ux, uz]) => {
    const own = isLiving(part)
      ? BODY_RADIUS
      : extentToward(part, target.yaw, ux, uz);
    const base =
      (living ? BODY_RADIUS : extentToward(target.part, target.yaw, ux, uz)) +
      own;
    const toward = yawToward(-ux, -uz);
    // 横に並ぶ関係は、真横だとカメラから重なることがある。計算が選んだときは相手の後ろへ少しずらす
    const [fx, fz] = forwardOf(target.yaw);
    const stagger =
      flip && (place.side === "left" || place.side === "right") ? STAGGER : 0;
    return stretches.flatMap((d) =>
      lanes.map((lane) => {
        const reach = base + Math.max(gap + d, 0.3);
        const x = ox + ux * reach - fx * stagger + lane;
        const z = oz + uz * reach - fz * stagger;
        const facing = backdrop ? yawToward(ox - x, oz - z) : toward;
        const yaw =
          place.turn === "same"
            ? target.yaw
            : place.turn === "away"
              ? normalizeYaw(facing + 180)
              : facing;
        return { x, z, yaw };
      }),
    );
  });
  const open = spots.find((p) => canStand(c, p.x, p.z, [target.key]));
  if (!open) c.misses++;
  const p = open ?? spots[0];
  return standAt(part, p.x, p.z, p.yaw);
};

/** 奥の席、短い辺の席、手前の席の順。手前の席は奥の席の人を隠すので最後に使う */
const seatRank = (name: string) =>
  name.includes("back") ? 0 : name.includes("end") ? 1 : 2;

/** テーブルの席を埋める順。カメラに顔が見える奥の席の真ん中から */
const seatOrder = (seats: Record<string, Vec3>) =>
  Object.entries(seats).sort(
    ([an, a], [bn, b]) =>
      seatRank(an) - seatRank(bn) || Math.abs(a[0]) - Math.abs(b[0]),
  );

/** seat_at: テーブルの次の空いた席に、テーブルを向いて置く */
const placeSeat = (c: Composer, target: Placed): Spot | undefined => {
  const seats = target.part.anchors?.seats;
  if (!seats) return undefined;
  const used = c.seated.get(target.key) ?? 0;
  const seat = seatOrder(seats)[used];
  if (!seat) {
    c.misses++;
    return undefined;
  }
  c.seated.set(target.key, used + 1);
  const [name, local] = seat;
  const w = rotate(local, target.yaw);
  return {
    position: [target.position[0] + w[0], 0, target.position[2] + w[2]],
    surface: "ground",
    yaw: normalizeYaw(
      target.yaw +
        (name.includes("front")
          ? 180
          : name.includes("end")
            ? local[0] < 0
              ? 90
              : -90
            : 0),
    ),
  };
};

/** 1 つの部品の位置を、関係から決める */
const placeItem = (
  c: Composer,
  item: PlanItem,
  part: Part,
  yaw: number,
  sitters: Map<string, string[]>,
  flip = false,
): Spot => {
  const { hx, hz } = footprint(part.size, yaw);
  const target = item.place.target
    ? c.placed.get(item.place.target)
    : undefined;
  const relation = item.place.relation;
  const self = { hx, hz };

  const onGround = (cx: number, cz: number, exclude: string[] = []): Spot => {
    const [x, z] = pickSpot(
      c,
      gridAround(cx, cz),
      { ...self, surface: "ground" },
      exclude,
    );
    return { position: [x, 0, z], surface: "ground" };
  };

  // 地面の部品（芝生・道路）は場面の真ん中（区画があればその向きへ、はみ出さない範囲で）に敷く
  if (isGroundPart(part)) {
    const [zx, zz] = zoneCenter(item.place.zone);
    const [x, z] = clampXZ(zx, zz, hx, hz);
    // 2 枚目の地面（歩道の上の道路）は少し上に敷く
    // 芝の板は薄いので road_patch をそのまま重ねられる（parts.py の ROAD_THICK）
    const second = [...c.placed.values()].some(
      (p) => isGroundPart(p.part) && p.part.id !== "grass_patch",
    );
    return { position: [x, second ? 0.01 : 0, z], surface: "ground" };
  }

  // 背景の壁は表（+Z）をカメラに向け、裏が場面の奥の端に付くよう置く。
  // 区画の真ん中（z ≈ -2.67）に立てると、壁の裏に物が隠れる。向きを探す間は size が広がるので、元の部品の奥行きを使う
  if (isBackdrop(part)) {
    const depth = (c.parts.get(item.part) ?? part).size[2];
    return { position: [0, 0, -HALF + depth / 2], surface: "ground", yaw: 0 };
  }

  // 場面全体に重ねる部品（雨）は真ん中に置き、ほかの物を避けない
  if (part.category === "thing" && part.size[0] >= HALF * 1.5) {
    return { position: [0, 0, 0], surface: "air" };
  }

  const [zx, zz] = zoneCenter(item.place.zone);
  // 知らない相手・相手の無い関係・ground は、区画の真ん中に置く
  if (!target || relation === "ground") return onGround(zx, zz);

  const [tx, ty, tz] = target.position;
  // 地面の部品の上・中は、その地面に置く（区画があれば区画の真ん中、無ければ地面の真ん中）
  if (
    isGroundPart(target.part) &&
    ["on", "in", "under", "sit_on", "between"].includes(relation)
  ) {
    return item.place.zone ? onGround(zx, zz) : onGround(tx, tz);
  }

  // 相手の横に置くときの高さ: 大きな物は地面、小物は相手と同じ面
  // （相手が座っている人など、宙に置いた低い物なら地面）
  const besideSurface = (): { y: number; surface: string } =>
    FLOOR_CATEGORIES.has(part.category) ||
    (target.surface === "air" && ty < FALL_MIN_Y)
      ? { y: 0, surface: "ground" }
      : { y: ty, surface: target.surface };

  const beside = (dirs: [number, number][]): Spot => {
    const { y, surface } = besideSurface();
    const [x, z] = pickSpot(c, besideCandidates(target, self, dirs), {
      ...self,
      surface,
    });
    return { position: [x, y, z], surface };
  };

  switch (relation) {
    case "relate":
      if (item.place.link === "under") return placeUnder(c, part, target);
      return item.place.link === "hand"
        ? placeHand(c, part, target, item.place, flip)
        : placeBody(c, part, target, item.place, flip);
    case "seat_at":
      return placeSeat(c, target) ?? beside([[0, -1], ...RIGHT_LEFT]);
    case "thrown_by": {
      const [tx2, tz2] = feetOf(target);
      // 受ける人がいれば、2 人の間を飛ぶ
      const catcher = [...c.placed.values()].find(
        (p) => p.key !== target.key && p.part.range && target.part.range,
      );
      if (catcher) {
        const [cx, cz] = feetOf(catcher);
        return {
          position: [
            tx2 + (cx - tx2) * 0.6,
            THROWN_HEIGHT,
            tz2 + (cz - tz2) * 0.6,
          ],
          surface: "air",
        };
      }
      const [ux, uz] = forwardOf(target.yaw);
      return {
        position: [
          tx2 + ux * THROWN_DISTANCE,
          THROWN_HEIGHT,
          tz2 + uz * THROWN_DISTANCE,
        ],
        surface: "air",
      };
    }
    case "on": {
      // 名前付きの場所があれば、そこに置く
      const named = item.place.spot
        ? target.part.anchors?.spots?.[item.place.spot]
        : undefined;
      if (named) {
        const w = rotate(named, target.yaw);
        return {
          position: [tx + w[0], ty + w[1], tz + w[2]],
          surface: target.key,
        };
      }
      // top があればその面、無くて seat があれば座面（x・z も seat の点）、どちらも無ければ部品の高さ
      const anchors = target.part.anchors;
      const seat =
        anchors?.top === undefined && anchors?.seat
          ? rotate(anchors.seat, target.yaw)
          : undefined;
      const top = anchors?.top ?? seat?.[1] ?? target.part.size[1];
      const [cx, cz] = seat ? [tx + seat[0], tz + seat[2]] : [tx, tz];
      const candidates = gridWithin(cx, cz, target.hx - hx, target.hz - hz);
      const [x, z] = pickSpot(c, candidates, { ...self, surface: target.key });
      return { position: [x, ty + top, z], surface: target.key };
    }
    case "in":
      // 木の中は葉の高さの手前。幹の根元に置くと見えない
      if (target.part.category === "plant") {
        return {
          position: [
            tx,
            ty + target.part.size[1] * IN_PLANT_HEIGHT,
            tz + target.hz * 0.6,
          ],
          surface: "air",
        };
      }
      return { position: [tx, ty, tz], surface: "air" };
    case "under": {
      // 木の下は幹を避けて手前に置く。机などの下は真ん中
      const dz =
        target.part.category === "plant" ? target.hz * 0.5 + hz + GAP : 0;
      const [x, z] = clampXZ(tx, tz + dz, hx, hz);
      return { position: [x, ty, z], surface: "air" };
    }
    case "above":
      return {
        position: [tx, ty + target.part.size[1] + ABOVE_GAP, tz],
        surface: "air",
      };
    case "next_to":
      return beside(RIGHT_LEFT);
    case "in_front_of":
      return beside([axisOf(target.yaw)]);
    case "behind": {
      const [ux, uz] = axisOf(target.yaw);
      return beside([[-ux, -uz]]);
    }
    case "near":
      return beside([...DIAGONALS, ...RIGHT_LEFT]);
    case "between": {
      const other = item.place.target2
        ? c.placed.get(item.place.target2)
        : undefined;
      if (!other || other.key === target.key) return beside(RIGHT_LEFT);
      const [ox, oy, oz] = other.position;
      const { surface } = besideSurface();
      const y = surface === "ground" ? 0 : Math.min(ty, oy);
      const [x, z] = clampXZ((tx + ox) / 2, (tz + oz) / 2, hx, hz);
      return { position: [x, y, z], surface };
    }
    case "sit_on": {
      const hip = part.anchors?.hip;
      // 座るポーズでない人は、座れないので横に立たせる
      if (!hip) return beside(RIGHT_LEFT);
      const anchors = target.part.anchors;
      const seat: Vec3 = anchors?.seat ?? [
        0,
        anchors?.top ?? target.part.size[1],
        0,
      ];
      const group = sitters.get(target.key) ?? [item.key];
      const n = group.length;
      const i = Math.max(0, group.indexOf(item.key));
      const slot = Math.min(SEAT_SLOT, target.part.size[0] / n);
      const local: Vec3 = [
        seat[0] + (i - (n - 1) / 2) * slot,
        seat[1],
        seat[2],
      ];
      const seatYaw = target.yaw;
      const sw = rotate(local, seatYaw);
      const hw = rotate(hip, seatYaw);
      const y = ty + sw[1] - hw[1];
      return {
        position: [tx + sw[0] - hw[0], y, tz + sw[2] - hw[2]],
        // 地面の椅子に座った人は、ほかの物を置くときに避ける
        surface: y < FALL_MIN_Y ? "ground" : "air",
        yaw: seatYaw,
      };
    }
  }
  return onGround(zx, zz);
};

/** 向きの指定から yaw を決める。相手の key のときは、相手がまだ置かれていなければ null */
const facingYaw = (
  c: Composer,
  facing: string | undefined,
  from: Vec3,
  selfKey: string,
): number | null => {
  if (facing === undefined) return 0;
  if (facing in FACING_YAW) return FACING_YAW[facing];
  const target = c.placed.get(facing);
  if (!target || target.key === selfKey) return null;
  const dx = target.position[0] - from[0];
  const dz = target.position[2] - from[2];
  if (Math.hypot(dx, dz) < EPS) return 0;
  return yawToward(dx, dz);
};

const motionDuration = (type: Motion["type"], d: number) =>
  Number.isFinite(d) && d > 0 ? clamp(d, 0.3, 30) : DEFAULT_DURATION[type];

/** 動きを配置の JSON の形にする。move と fall は位置も直すことがある */
const composeMotion = (
  c: Composer,
  item: PlanItem,
  placed: Placed,
): { motion: Motion; position: Vec3; yaw: number } | undefined => {
  const m = item.motion;
  if (!m) return undefined;
  const duration = motionDuration(m.type, m.duration);
  let [x, y, z] = placed.position;
  let yaw = placed.yaw;
  const self = placed;

  if (m.type === "rotate" || m.type === "sway") {
    return { motion: { type: m.type, duration }, position: [x, y, z], yaw };
  }

  const target = item.place.target
    ? c.placed.get(item.place.target)
    : undefined;

  if (m.type === "fall") {
    const fromPlant =
      target &&
      target.part.category === "plant" &&
      ["in", "under", "on", "next_to", "near"].includes(item.place.relation);
    if (fromPlant) {
      const [tx, ty, tz] = target.position;
      const s = target.part.size;
      x = tx + FALL_FROM_PLANT.x * s[0];
      z = tz + FALL_FROM_PLANT.z * s[2];
      y = ty + FALL_FROM_PLANT.y * s[1];
    } else if (y < FALL_MIN_Y) {
      y = target
        ? target.position[1] + target.part.size[1] + ABOVE_GAP
        : FALL_DEFAULT_Y;
    }
    [x, z] = clampXZ(x, z, self.hx, self.hz);
    return { motion: { type: "fall", duration }, position: [x, y, z], yaw };
  }

  // move
  let to: Vec3;
  const toward = m.toward ? c.placed.get(m.toward) : undefined;
  const towardZone = m.toward && !toward ? zoneOrUndefined(m.toward) : null;
  if (toward && toward.key !== item.key) {
    const [kx, , kz] = toward.position;
    const path = m.path ?? (isGroundPart(toward.part) ? "across" : undefined);
    if (path) {
      // across は短い辺の向きに横切り、along は長い辺に沿って端から端まで動く
      const shortIsZ = toward.hz <= toward.hx;
      const alongX = path === "across" ? !shortIsZ : shortIsZ;
      if (alongX) {
        const reach =
          path === "across"
            ? toward.hx + self.hx + GAP
            : Math.max(0, toward.hx - self.hx);
        const sign = x >= kx ? 1 : -1;
        x = kx + sign * reach;
        to = [kx - sign * reach, y, z];
      } else {
        const reach =
          path === "across"
            ? toward.hz + self.hz + GAP
            : Math.max(0, toward.hz - self.hz);
        // z に沿うときは奥からカメラ側へ歩かせる（顔が見えるように）
        z = kz - reach;
        to = [x, y, kz + reach];
      }
      [x, z] = clampXZ(x, z, self.hx, self.hz);
    } else {
      const dx = kx - x;
      const dz = kz - z;
      const dist = Math.hypot(dx, dz);
      const stop = Math.max(toward.hx, toward.hz) + Math.max(self.hx, self.hz);
      if (dist < EPS) {
        to = [x, y, z];
      } else {
        const t = Math.max(0, dist - stop - GAP) / dist;
        to = [x + dx * t, y, z + dz * t];
      }
    }
  } else if (towardZone) {
    const [gx, gz] = zoneCenter(towardZone);
    to = [gx, y, gz];
  } else if (item.facing && item.facing in FACING_YAW) {
    const [fx, , fz] = rotate([0, 0, 1], FACING_YAW[item.facing]);
    to = [x + fx * MOVE_DISTANCE, y, z + fz * MOVE_DISTANCE];
  } else {
    // 行き先が無ければ、横切るように反対の側へ
    to = [x >= 0 ? -3 : 3, y, z];
  }
  const [cx, cz] = clampXZ(to[0], to[2], self.hx, self.hz);
  to = [cx, to[1], cz];
  // 重なってよいのは自分と、中・下・上に置いた・座った相手だけ
  const overlapsTarget = ["in", "under", "on", "sit_on"].includes(
    item.place.relation,
  );
  const exclude = [
    item.key,
    overlapsTarget ? item.place.target : undefined,
  ].filter((k): k is string => !!k);
  const start = moveStart(c, placed, [x, z], to, exclude);
  x = start.x;
  z = start.z;
  // 動くものは進む向きを向く（facing より優先。座っている人だけは座席の向きのまま）
  if (item.place.relation !== "sit_on") yaw = start.yaw;
  return {
    motion: { type: "move", to, duration },
    position: [x, y, z],
    yaw,
  };
};

/**
 * move の出発点を決める。行き先まで MIN_MOVE より近ければ後ろへ引き、
 * 出発点が同じ面の部品の外接箱に入るなら、入らない所まで引く。後ろに場所が無ければ行き先の反対側から来る
 */
const moveStart = (
  c: Composer,
  self: Placed,
  [x, z]: [number, number],
  to: Vec3,
  exclude: string[],
) => {
  let dx = to[0] - x;
  let dz = to[2] - z;
  let dist = Math.hypot(dx, dz);
  if (dist < EPS) {
    const [fx, , fz] = rotate([0, 0, 1], self.yaw);
    [dx, dz, dist] = [fx, fz, 1];
  }
  const ux = dx / dist;
  const uz = dz / dist;
  const yaw = yawToward(ux, uz);
  const { hx, hz } = footprint(self.part.size, yaw);
  // 宙に置いたことになっていても、地面の高さにあるものは地面の物を避ける
  const surface =
    self.surface === "air" && self.position[1] < FALL_MIN_Y
      ? "ground"
      : self.surface;
  const others = [...c.placed.values()].filter(
    (p) =>
      p.surface === surface &&
      p.surface !== "air" &&
      !isGroundPart(p.part) &&
      !exclude.includes(p.key),
  );
  const ok = (px: number, pz: number) =>
    Math.hypot(to[0] - px, to[2] - pz) >= MIN_MOVE - EPS &&
    !others.some((o) => overlaps({ x: px, z: pz, hx, hz }, o));
  const from = (sx: number, sz: number, sign: 1 | -1) => {
    for (let k = 0; k <= 40; k++) {
      const back = k * MOVE_STEP;
      const [px, pz] = clampXZ(
        sx - sign * ux * back,
        sz - sign * uz * back,
        hx,
        hz,
      );
      if (ok(px, pz)) return { x: px, z: pz };
    }
    return null;
  };
  // 後ろへ引く → 行き先の反対側から（向きも逆になる）
  const behind = from(x, z, 1);
  if (behind)
    return { ...behind, yaw: yawToward(to[0] - behind.x, to[2] - behind.z) };
  const other = from(to[0] + ux * MIN_MOVE, to[2] + uz * MIN_MOVE, -1);
  if (other)
    return { ...other, yaw: yawToward(to[0] - other.x, to[2] - other.z) };
  return { x, z, yaw };
};

const ZONE_SET = new Set<string>([
  "back_left",
  "back",
  "back_right",
  "left",
  "center",
  "right",
  "front_left",
  "front",
  "front_right",
]);
const zoneOrUndefined = (s: string): Zone | null =>
  ZONE_SET.has(s) ? (s as Zone) : null;

/** 依存（target・target2）が先に置かれるよう、置く順を決める。循環していれば元の順で置く */
const placementOrder = (items: PlanItem[]) => {
  const keys = new Set(items.map((i) => i.key));
  // 向く相手（facing の key）も先に置く。相手の向きが決まってから前・後ろを決めるため
  const deps = (i: PlanItem) =>
    [i.place.target, i.place.target2, i.facing].filter(
      (k): k is string => !!k && k !== i.key && keys.has(k),
    );
  const done = new Set<string>();
  const order: PlanItem[] = [];
  while (order.length < items.length) {
    const ready = items.filter(
      (i) => !done.has(i.key) && deps(i).every((d) => done.has(d)),
    );
    const next = ready.length
      ? ready
      : [items.find((i) => !done.has(i.key)) as PlanItem];
    for (const i of next) {
      done.add(i.key);
      order.push(i);
    }
  }
  return order;
};

/** 全体を解くときに試す向き（度）。真横を先に、隠れるなら斜めへ */
const STAGE_YAWS = [90, -90, 65, -65, 40, -40, 0];
/** 試す組み合わせの上限（Worker の CPU に収める） */
const MAX_TRIALS = 100;

type Choice = { yaw: number | null; flips: Set<string> };

/** 全部の部品を順に置く。choice は全体を解くときに試す向きと左右 */
const placeAll = (
  items: PlanItem[],
  parts: Map<string, Part>,
  choice: Choice,
) => {
  const c: Composer = {
    parts,
    placed: new Map(),
    misses: 0,
    pinned: false,
    seated: new Map(),
  };

  // 同じ相手に座る人の並び（席を左右に分ける）
  const sitters = new Map<string, string[]>();
  for (const i of items) {
    if (i.place.relation === "sit_on" && i.place.target) {
      sitters.set(i.place.target, [
        ...(sitters.get(i.place.target) ?? []),
        i.key,
      ]);
    }
  }

  const deferredFacing: PlanItem[] = [];
  for (const item of placementOrder(items)) {
    const part = parts.get(item.part) as Part;
    const facing = item.facing === "auto" ? undefined : item.facing;
    // 向きを計算に任せる部品（facing: auto）は、試している向きにする
    const autoYaw = item.facing === "auto" ? (choice.yaw ?? 0) : undefined;
    // 相手を向くときは、向きが決まるまで回しても収まる大きさで場所を探す
    const preYaw =
      autoYaw ??
      (facing === undefined
        ? 0
        : facing in FACING_YAW
          ? FACING_YAW[facing]
          : null);
    const searchSize: Vec3 =
      preYaw === null
        ? [
            Math.max(part.size[0], part.size[2]),
            part.size[1],
            Math.max(part.size[0], part.size[2]),
          ]
        : part.size;
    const spot = placeItem(
      c,
      item,
      { ...part, size: searchSize },
      preYaw ?? 0,
      sitters,
      choice.flips.has(item.key),
    );
    let yaw = spot.yaw ?? preYaw ?? 0;
    if (spot.yaw === undefined && preYaw === null) {
      const y = facingYaw(c, facing, spot.position, item.key);
      if (y === null) deferredFacing.push(item);
      else yaw = y;
    }
    c.placed.set(item.key, {
      key: item.key,
      part,
      position: spot.position,
      yaw,
      surface: spot.surface,
      ...footprint(part.size, yaw),
    });
  }
  for (const item of deferredFacing) {
    const p = c.placed.get(item.key) as Placed;
    p.yaw = facingYaw(c, item.facing, p.position, item.key) ?? 0;
  }
  return c;
};

const rangedPairs = (people: Placed[]) => {
  const ranged = people.filter((p) => p.part.range).map(feetOf);
  return ranged.flatMap((a, i) =>
    ranged.slice(i + 1).map((b) => [a, b] as const),
  );
};

/** 点 (x, z) と線分 a-b の距離（線分の外なら無限大） */
const betweenLine = (
  x: number,
  z: number,
  [ax, az]: [number, number],
  [bx, bz]: [number, number],
) => {
  const dx = bx - ax;
  const dz = bz - az;
  const t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1);
  if (t < 0 || t > 1) return Number.POSITIVE_INFINITY;
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
};

/** カメラから見た読みにくさの点数。小さいほどよい。隠れる・背中を見せる・埋まるを重く見る */
const stageCost = (c: Composer) => {
  const people = [...c.placed.values()].filter((p) => isLiving(p.part));
  let cost = c.misses * 15;
  const CAMERA = 11;
  people.forEach((p, i) => {
    const [x, z] = feetOf(p);
    const y = Math.abs(normalizeYaw(p.yaw));
    if (y > 135) cost += 10;
    cost += 1 - Math.abs(Math.sin(rad(y))); // 横顔に近いほどよい
    if (Math.abs(x) > STAND_LIMIT || Math.abs(z) > STAND_LIMIT) cost += 20;
    for (const o of people.slice(i + 1)) {
      const [ox, oz] = feetOf(o);
      const [nx, nz, fx, fz] = z > oz ? [x, z, ox, oz] : [ox, oz, x, z];
      const apparent = Math.abs(nx - fx * ((CAMERA - nz) / (CAMERA - fz)));
      if (apparent < 0.5) cost += 20;
    }
    // 離れてやり取りする 2 人の間に、ほかの人や動物を立たせない
    if (!p.part.range) {
      for (const [a, b] of rangedPairs(people)) {
        if (betweenLine(x, z, a, b) < 0.6) cost += 20;
      }
    }
  });
  return cost;
};

/** 人の真ん中が場面の真ん中に来るよう、全体をずらす。電車と道路の場面は線路や道に合わせてあるのでずらさない */
const centerStage = (c: Composer) => {
  const all = [...c.placed.values()];
  if (
    c.pinned ||
    all.some((p) => p.part.category === "vehicle" || p.part.id === "road_patch")
  )
    return;
  // 人と、人が関わる物をひとまとまりとして真ん中に寄せる
  const people = all
    .filter(
      (p) =>
        !isGroundPart(p.part) &&
        !isBackdrop(p.part) &&
        p.part.size[0] < HALF * 1.5,
    )
    .map(feetOf);
  if (people.length === 0) return;
  const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2;
  const movable = all.filter(
    (p) =>
      !isGroundPart(p.part) &&
      !isBackdrop(p.part) &&
      p.part.size[0] < HALF * 1.5,
  );
  const within = (axis: 0 | 2, shift: number) => {
    const half = (p: Placed) => (axis === 0 ? p.hx : p.hz);
    const lo = Math.max(
      ...movable.map((p) => -3.7 + half(p) - p.position[axis]),
    );
    const hi = Math.min(
      ...movable.map((p) => 3.7 - half(p) - p.position[axis]),
    );
    return lo > hi ? 0 : clamp(shift, lo, hi);
  };
  const dx = within(0, -mid(people.map((f) => f[0])));
  const dz = within(2, 0.3 - mid(people.map((f) => f[1])));
  for (const p of movable) {
    p.position = [p.position[0] + dx, p.position[1], p.position[2] + dz];
  }
};

/** 全体を解く: 向きと左右の候補を試し、読みにくさが最小の置き方を選ぶ。relate も auto も無ければ 1 回だけ置く */
const solve = (planned: PlanItem[], parts: Map<string, Part>) => {
  const solving = planned.some(
    (i) => i.place.relation === "relate" || i.facing === "auto",
  );
  if (!solving)
    return placeAll(planned, parts, { yaw: null, flips: new Set() });
  // 見え方は計算の担当。関係の起点になる人と座る物は、向きの指定が無ければ計算で決める
  const rooted = new Set(planned.map((i) => i.place.target));
  const items = planned.map((i) => {
    const part = parts.get(i.part) as Part;
    const root =
      i.place.relation === "ground" &&
      (isLiving(part) || (!!part.anchors?.seat && rooted.has(i.key)));
    // 人が手を伸ばす家具は、人が横から見えるよう、指定にかかわらず計算で回す
    const station = i.place.relation === "ground" && !!part.anchors?.spots;
    return station ||
      (root && (i.facing === undefined || i.facing === "camera"))
      ? { ...i, facing: "auto" }
      : i;
  });
  const free = items
    .filter(
      (i) =>
        i.place.relation === "relate" &&
        (i.place.side ?? "any") !== "front" &&
        (i.place.side ?? "any") !== "back",
    )
    .map((i) => i.key)
    .slice(0, 3);
  const yaws = items.some((i) => i.facing === "auto") ? STAGE_YAWS : [0];
  let best: Composer | undefined;
  let bestCost = Number.POSITIVE_INFINITY;
  let trials = 0;
  for (const yaw of yaws) {
    for (let bits = 0; bits < 1 << free.length && trials < MAX_TRIALS; bits++) {
      trials++;
      const flips = new Set(free.filter((_, n) => bits & (1 << n)));
      const c = placeAll(items, parts, { yaw, flips });
      const cost = stageCost(c);
      if (cost < bestCost) {
        best = c;
        bestCost = cost;
      }
    }
  }
  const c = best as Composer;
  centerStage(c);
  return c;
};

/** 顔を横へ向けた部品は、いちばん近い人のいる側を向くほうを使う */
const gazePart = (c: Composer, p: Placed) => {
  const { gaze, mirror } = p.part;
  if (!gaze || !mirror) return p.part.id;
  const [x, z] = feetOf(p);
  const near = [...c.placed.values()]
    .filter((o) => o.key !== p.key && isLiving(o.part))
    .map(feetOf)
    .sort(
      (a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z),
    )[0];
  if (!near) return p.part.id;
  const side = rotate([1, 0, 0], p.yaw);
  const right = (near[0] - x) * side[0] + (near[1] - z) * side[2] >= 0;
  return right === (gaze === "r") ? p.part.id : mirror;
};

/**
 * Claude が書いた関係（items）を、座標つきの部品の並びにする。
 * 一覧に無い部品は飛ばす。items は 40 個まで。同じ key には _2、_3 を付ける
 */
export const composeItems = (
  planItems: PlanItem[],
  partList: Part[],
): LayoutItem[] => {
  const parts = new Map(partList.map((p) => [p.id, p]));
  const known = planItems.filter((i) => parts.has(i.part)).slice(0, MAX_ITEMS);
  const keys = uniqueNames(known, (i) => i.key);
  const items = known.map((i, n) => ({ ...i, key: keys[n] }));
  const c = solve(items, parts);

  return items.map((item) => {
    const p = c.placed.get(item.key) as Placed;
    const moved = composeMotion(c, item, p);
    const position = moved?.position ?? p.position;
    const yaw = round(normalizeYaw(moved?.yaw ?? p.yaw), 1);
    const out: LayoutItem = {
      key: item.key,
      part: gazePart(c, p),
      position: position.map((n) => round(n)) as Vec3,
    };
    if (yaw !== 0) out.yaw = yaw;
    if (moved) {
      const motion = moved.motion;
      out.motion = motion.to
        ? { ...motion, to: motion.to.map((n) => round(n)) as Vec3 }
        : motion;
    }
    return out;
  });
};
