import type {
  Difficulty,
  LayoutItem,
  Motion,
  Part,
  PlanItem,
  SceneElementInput,
  SceneLayout,
  ScenePlan,
  Vec3,
  Zone,
} from "./types";

// Claude が書いた「関係」（ScenePlan）を、部品の size と anchors から座標に直して配置の JSON にする。
// 規則の正本は docs/design/scene-protocol.md の「Claude に書かせる形と呼び方」。Cloudflare に依存しない純粋な関数

/** 場面の半分の幅（m）。場面は一辺 8 m で、x・z は -4〜4 */
export const HALF = 4;
/** 関係で並べるときの、相手との隙間（m） */
export const GAP = 0.1;
/** above で相手の上に空ける高さ（m） */
export const ABOVE_GAP = 0.3;
/** 要素の配点の合計と、一覧に無い描写の点の上限（足して 100） */
export const ELEMENT_POINTS = 90;
export const EXTRA_MAX = 10;
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

/** 要素の配点を合計 90 の整数に直す（どれも 1 点以上。端数は小数部の大きい順に配る） */
export const normalizePoints = (
  elements: SceneElementInput[],
): SceneElementInput[] => {
  // 90 個を超える要素は 1 点ずつも配れないので落とす
  const list = elements.slice(0, ELEMENT_POINTS);
  if (list.length === 0) return [];
  // どの要素も 1 点は持つ。0 点や負の点は 1 の重みとして扱う
  const weights = list.map((e) =>
    Number.isFinite(e.points) ? Math.max(1, e.points) : 1,
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const spare = ELEMENT_POINTS - list.length;
  const exact = weights.map((w) => (w * spare) / total);
  const points = exact.map((v) => 1 + Math.floor(v));
  let rest = ELEMENT_POINTS - points.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    points[i] += 1;
    rest -= 1;
  }
  return list.map((e, i) => ({ ...e, points: points[i] }));
};

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

const cleanElements = (elements: SceneElementInput[]) => {
  const ids = uniqueNames(elements, (e) => e.id);
  return normalizePoints(
    elements.map((e, i) => {
      const element: SceneElementInput = {
        id: ids[i],
        label: e.label.trim(),
        points: e.points,
        accept: e.accept.trim(),
      };
      const partial = e.partial?.trim();
      if (partial) element.partial = partial;
      return element;
    }),
  );
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

/** 1 つの部品の位置を、関係から決める */
const placeItem = (
  c: Composer,
  item: PlanItem,
  part: Part,
  yaw: number,
  sitters: Map<string, string[]>,
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
    return { position: [x, 0, z], surface: "ground" };
  }

  // 背景の壁は表（+Z）をカメラに向け、裏が場面の奥の端に付くよう置く。
  // 区画の真ん中（z ≈ -2.67）に立てると、壁の裏に物が隠れる。向きを探す間は size が広がるので、元の部品の奥行きを使う
  if (isBackdrop(part)) {
    const depth = (c.parts.get(item.part) ?? part).size[2];
    return { position: [0, 0, -HALF + depth / 2], surface: "ground", yaw: 0 };
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
    case "on": {
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

/**
 * Claude が書いた関係（plan）を、配置の JSON（scenenglish.scene/1）にする。
 * 一覧に無い部品は飛ばす。items は 40 個まで。配点は合計 90、extraMax は 10 にする
 */
export const composeLayout = (
  plan: ScenePlan,
  partList: Part[],
  meta: { id: string; difficulty: Difficulty },
): SceneLayout => {
  const parts = new Map(partList.map((p) => [p.id, p]));
  const known = plan.items.filter((i) => parts.has(i.part)).slice(0, MAX_ITEMS);
  const keys = uniqueNames(known, (i) => i.key);
  const items = known.map((i, n) => ({ ...i, key: keys[n] }));
  const c: Composer = { parts, placed: new Map() };

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
    // 相手を向くときは、向きが決まるまで回しても収まる大きさで場所を探す
    const preYaw =
      item.facing === undefined
        ? 0
        : item.facing in FACING_YAW
          ? FACING_YAW[item.facing]
          : null;
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
    );
    let yaw = spot.yaw ?? preYaw ?? 0;
    if (spot.yaw === undefined && preYaw === null) {
      const y = facingYaw(c, item.facing, spot.position, item.key);
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

  const layoutItems: LayoutItem[] = items.map((item) => {
    const p = c.placed.get(item.key) as Placed;
    const moved = composeMotion(c, item, p);
    const position = moved?.position ?? p.position;
    const yaw = round(normalizeYaw(moved?.yaw ?? p.yaw), 1);
    const out: LayoutItem = {
      key: item.key,
      part: item.part,
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

  return {
    protocol: "scenenglish.scene/1",
    id: meta.id,
    name: plan.name.trim(),
    difficulty: meta.difficulty,
    description: plan.description.trim(),
    elements: cleanElements(plan.elements),
    extraMax: EXTRA_MAX,
    items: layoutItems,
  };
};
