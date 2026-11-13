import { MATERIALS, type Material, type TraceOp, type Vec3 } from "./recipe";

// 部品表 → 形 → USDA の文字列 → 64 バイト境界の無圧縮 zip（USDZ）。依存は無い。
// 形の作り方は scripts/scene/common.py の Part（bmesh の create_cube・create_cone・create_uvsphere・bevel）に寄せている。
// 角の丸めの形は Blender の bevel と同じではない（角の三角形の数が少し少ない）。
// 1 回の組み立ては Worker で 7〜12 ms（初回）かかるので、Durable Object の中から呼ぶ（workshop.ts）

type M3 = number[]; // 3x3 行列（行優先）

/** Blender の Euler((x, y, z), 'XYZ') の行列 = Rz · Ry · Rx */
function eulerXYZ(r: Vec3 | undefined): M3 {
  const [x, y, z] = r ?? [0, 0, 0];
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  return [
    cz * cy,
    cz * sy * sx - sz * cx,
    cz * sy * cx + sz * sx,
    sz * cy,
    sz * sy * sx + cz * cx,
    sz * sy * cx - cz * sx,
    -sy,
    cy * sx,
    cy * cx,
  ];
}

class Mesh {
  P: number[] = []; // 点（x, y, z）
  N: number[] = []; // 点ごとの法線
  idx: number[] = []; // 面の頂点の番号
  counts: number[] = []; // 面ごとの頂点の数
  fmat: number[] = []; // 面ごとのマテリアルの番号
  /** 面ごとの基本形の番号（浮いた基本形の検査に使う） */
  fprim: number[] = [];
}

type Op<K extends TraceOp["op"]> = Extract<TraceOp, { op: K }>;

class Builder {
  mats: string[] = [];
  parts = new Map<number, Mesh>();
  out = new Mesh();
  // 今の基本形の変換（点 = R·S·p + T、法線 = R·S⁻¹·n）
  R: M3 = eulerXYZ(undefined);
  S: Vec3 = [1, 1, 1];
  T: Vec3 = [0, 0, 0];
  m: Mesh = new Mesh();
  mat = 0;
  prim = -1;

  matIndex(name: string): number {
    let i = this.mats.indexOf(name);
    if (i < 0) i = this.mats.push(name) - 1;
    return i;
  }

  begin(p: number, mat: string, T: Vec3, R: M3, S: Vec3) {
    let m = this.parts.get(p);
    if (!m) {
      m = new Mesh();
      this.parts.set(p, m);
    }
    this.m = m;
    this.mat = this.matIndex(mat);
    this.T = T;
    this.R = R;
    this.S = S;
    this.prim++;
  }

  /** 局所の点と法線を足して、番号を返す */
  v(
    x0: number,
    y0: number,
    z0: number,
    nx0: number,
    ny0: number,
    nz0: number,
  ): number {
    const { R, S, T, m } = this;
    const x = x0 * S[0];
    const y = y0 * S[1];
    const z = z0 * S[2];
    m.P.push(
      R[0] * x + R[1] * y + R[2] * z + T[0],
      R[3] * x + R[4] * y + R[5] * z + T[1],
      R[6] * x + R[7] * y + R[8] * z + T[2],
    );
    const nx = nx0 / S[0];
    const ny = ny0 / S[1];
    const nz = nz0 / S[2];
    const a = R[0] * nx + R[1] * ny + R[2] * nz;
    const b = R[3] * nx + R[4] * ny + R[5] * nz;
    const c = R[6] * nx + R[7] * ny + R[8] * nz;
    const l = Math.hypot(a, b, c) || 1;
    m.N.push(a / l, b / l, c / l);
    return m.P.length / 3 - 1;
  }

  /** 滑らかな面（点を共有し、法線は点ごと） */
  face(ids: number[]) {
    const m = this.m;
    for (const i of ids) m.idx.push(i);
    m.counts.push(ids.length);
    m.fmat.push(this.mat);
    m.fprim.push(this.prim);
  }

  /** 平らな面（点を面ごとに作り、法線は面の向き）。局所の点で受け取る */
  flat(pts: number[][]) {
    const { R, S, T, m } = this;
    const w: number[][] = pts.map(([x0, y0, z0]) => {
      const x = x0 * S[0];
      const y = y0 * S[1];
      const z = z0 * S[2];
      return [
        R[0] * x + R[1] * y + R[2] * z + T[0],
        R[3] * x + R[4] * y + R[5] * z + T[1],
        R[6] * x + R[7] * y + R[8] * z + T[2],
      ];
    });
    // Newell の方法
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < w.length; i++) {
      const a = w[i];
      const b = w[(i + 1) % w.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    const start = m.P.length / 3;
    for (const p of w) {
      m.P.push(p[0], p[1], p[2]);
      m.N.push(nx / l, ny / l, nz / l);
    }
    for (let i = 0; i < w.length; i++) m.idx.push(start + i);
    m.counts.push(w.length);
    m.fmat.push(this.mat);
    m.fprim.push(this.prim);
  }

  // ---------- 基本形 ----------

  box(o: Op<"box">) {
    const [w, d, h] = o.size;
    const bevel = o.bevel ?? 0;
    this.begin(o.p, o.mat, o.loc, eulerXYZ(o.rot), [1, 1, 1]);
    const hx = w / 2;
    const hy = d / 2;
    const hz = h / 2;
    const r = Math.min(bevel, hx, hy, hz);
    if (r <= 0) {
      const c = (sx: number, sy: number, sz: number) => [
        sx * hx,
        sy * hy,
        sz * hz,
      ];
      const quads = [
        [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)],
        [c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), c(-1, -1, -1)],
        [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)],
        [c(-1, -1, 1), c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1)],
        [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)],
        [c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1)],
      ];
      for (const q of quads) this.flat(q);
      return;
    }
    // 角を丸めた箱: 8 つの角の球の 1/8（s×s の三角形）、12 本の辺の帯（s 枚）、6 つの面
    const s = Math.max(1, o.segments ?? 3);
    const ix = hx - r;
    const iy = hy - r;
    const iz = hz - r;
    const sinT: number[] = [];
    for (let k = 0; k <= s; k++) sinT.push(Math.sin((Math.PI / 2) * (k / s)));
    // 角 (sx, sy, sz) の (i, j)（k = s - i - j）の点
    const corner = (
      sx: number,
      sy: number,
      sz: number,
      i: number,
      j: number,
    ): number[] => {
      const k = s - i - j;
      const l = Math.hypot(sinT[i], sinT[j], sinT[k]);
      return [
        sx * (ix + (r * sinT[i]) / l),
        sy * (iy + (r * sinT[j]) / l),
        sz * (iz + (r * sinT[k]) / l),
      ];
    };
    const flatOut = (pts: number[][]) => {
      // 外向きにそろえる（箱は凸なので、中心から面の中心への向きと比べる）
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const p of pts) {
        cx += p[0];
        cy += p[1];
        cz += p[2];
      }
      const [a, b, c] = pts;
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      if (nx * nx + ny * ny + nz * nz < 1e-30 && pts.length > 3) {
        const d2 = pts[3];
        const wx = d2[0] - a[0];
        const wy = d2[1] - a[1];
        const wz = d2[2] - a[2];
        nx = vy * wz - vz * wy;
        ny = vz * wx - vx * wz;
        nz = vx * wy - vy * wx;
      }
      if (nx * cx + ny * cy + nz * cz < 0) pts.reverse();
      this.flat(pts);
    };
    const signs = [-1, 1];
    for (const sx of signs)
      for (const sy of signs)
        for (const sz of signs) {
          for (let a = 0; a < s; a++) {
            for (let b = 0; b < s - a; b++) {
              flatOut([
                corner(sx, sy, sz, a, b),
                corner(sx, sy, sz, a + 1, b),
                corner(sx, sy, sz, a, b + 1),
              ]);
              if (b < s - a - 1)
                flatOut([
                  corner(sx, sy, sz, a + 1, b),
                  corner(sx, sy, sz, a + 1, b + 1),
                  corner(sx, sy, sz, a, b + 1),
                ]);
            }
          }
        }
    // 辺の帯: X に沿う辺は i = 0 の弧（j + k = s）を、x の符号の違う 2 つの角でつなぐ
    for (const sy of signs)
      for (const sz of signs)
        for (let j = 0; j < s; j++)
          flatOut([
            corner(-1, sy, sz, 0, j),
            corner(1, sy, sz, 0, j),
            corner(1, sy, sz, 0, j + 1),
            corner(-1, sy, sz, 0, j + 1),
          ]);
    for (const sx of signs)
      for (const sz of signs)
        for (let i = 0; i < s; i++)
          flatOut([
            corner(sx, -1, sz, i, 0),
            corner(sx, 1, sz, i, 0),
            corner(sx, 1, sz, i + 1, 0),
            corner(sx, -1, sz, i + 1, 0),
          ]);
    for (const sx of signs)
      for (const sy of signs)
        for (let i = 0; i < s; i++)
          flatOut([
            corner(sx, sy, -1, i, s - i),
            corner(sx, sy, 1, i, s - i),
            corner(sx, sy, 1, i + 1, s - i - 1),
            corner(sx, sy, -1, i + 1, s - i - 1),
          ]);
    // 6 つの面
    for (const sx of signs)
      flatOut([
        corner(sx, -1, -1, s, 0),
        corner(sx, 1, -1, s, 0),
        corner(sx, 1, 1, s, 0),
        corner(sx, -1, 1, s, 0),
      ]);
    for (const sy of signs)
      flatOut([
        corner(-1, sy, -1, 0, s),
        corner(1, sy, -1, 0, s),
        corner(1, sy, 1, 0, s),
        corner(-1, sy, 1, 0, s),
      ]);
    for (const sz of signs)
      flatOut([
        corner(-1, -1, sz, 0, 0),
        corner(1, -1, sz, 0, 0),
        corner(1, 1, sz, 0, 0),
        corner(-1, 1, sz, 0, 0),
      ]);
  }

  /** create_cone と同じ: Z に沿い、下（-depth/2）が r1、上が r2。点は (r sinφ, r cosφ) */
  cone(
    p: number,
    mat: string,
    r1: number,
    r2: number,
    depth: number,
    segs: number,
    smooth: boolean,
    T: Vec3,
    R: M3,
  ) {
    this.begin(p, mat, T, R, [1, 1, 1]);
    const h = depth / 2;
    const ring = (r: number, z: number) => {
      const pts: number[][] = [];
      for (let k = 0; k < segs; k++) {
        const ph = (k / segs) * Math.PI * 2;
        pts.push([r * Math.sin(ph), r * Math.cos(ph), z]);
      }
      return pts;
    };
    const lo = ring(r1, -h);
    const hi = ring(r2, h);
    // ふた（多角形、平ら）。輪の点は上から見て時計回りなので、下のふたはそのまま、上のふたは逆にして外向きにする
    if (r1 > 0) this.flat(lo);
    if (r2 > 0) this.flat([...hi].reverse());
    // 側面
    const slope = (r1 - r2) / depth; // 法線の z 成分（傾き）
    if (smooth && segs > 4) {
      const vlo: number[] = [];
      const vhi: number[] = [];
      for (let k = 0; k < segs; k++) {
        const ph = (k / segs) * Math.PI * 2;
        const sx = Math.sin(ph);
        const cy = Math.cos(ph);
        vlo.push(this.v(lo[k][0], lo[k][1], -h, sx, cy, slope));
        if (r2 > 0) vhi.push(this.v(hi[k][0], hi[k][1], h, sx, cy, slope));
      }
      const apex = r2 > 0 ? -1 : this.v(0, 0, h, 0, 0, 1);
      for (let k = 0; k < segs; k++) {
        const k2 = (k + 1) % segs;
        this.face(
          r2 > 0 ? [vlo[k2], vlo[k], vhi[k], vhi[k2]] : [vlo[k2], vlo[k], apex],
        );
      }
    } else {
      for (let k = 0; k < segs; k++) {
        const k2 = (k + 1) % segs;
        this.flat(
          r2 > 0 ? [lo[k2], lo[k], hi[k], hi[k2]] : [lo[k2], lo[k], [0, 0, h]],
        );
      }
    }
  }

  cyl(o: Op<"cyl">) {
    this.cone(
      o.p,
      o.mat,
      o.r1,
      o.r2,
      o.depth,
      o.segs ?? 16,
      o.smooth ?? true,
      o.loc,
      eulerXYZ(o.rot),
    );
  }

  limb(o: Op<"limb">) {
    const [ax, ay, az] = o.a;
    const [bx, by, bz] = o.b;
    const len = Math.hypot(bx - ax, by - ay, bz - az) || 1e-9;
    const dx = (bx - ax) / len;
    const dy = (by - ay) / len;
    const dz = (bz - az) / len;
    // Z を a→b に向ける（ねじれは Blender の to_track_quat と違うことがある）
    let ux = 0;
    let uy = 1;
    const uz = 0;
    if (Math.abs(dy) > 0.999) {
      ux = 1;
      uy = 0;
    }
    let xx = uy * dz - uz * dy;
    let xy = uz * dx - ux * dz;
    let xz = ux * dy - uy * dx;
    const xl = Math.hypot(xx, xy, xz);
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const yx = dy * xz - dz * xy;
    const yy = dz * xx - dx * xz;
    const yz = dx * xy - dy * xx;
    const R = [xx, yx, dx, xy, yy, dy, xz, yz, dz];
    this.cone(
      o.p,
      o.mat,
      o.r1,
      o.r2,
      len,
      o.segs ?? 12,
      true,
      [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2],
      R,
    );
  }

  sphere(o: Op<"sphere">) {
    const u = o.segs ?? 20;
    const vseg = Math.max(8, Math.floor((u * 2) / 3));
    const sc = o.scale ?? [1, 1, 1];
    this.begin(o.p, o.mat, o.loc, eulerXYZ(o.rot), [
      sc[0] * o.r,
      sc[1] * o.r,
      sc[2] * o.r,
    ]);
    const pt = (i: number, k: number) => {
      const th = (i / vseg) * Math.PI;
      const ph = (k / u) * Math.PI * 2;
      return [
        Math.sin(th) * Math.sin(ph),
        Math.sin(th) * Math.cos(ph),
        Math.cos(th),
      ];
    };
    if (o.smooth ?? true) {
      const top = this.v(0, 0, 1, 0, 0, 1);
      const bot = this.v(0, 0, -1, 0, 0, -1);
      const rows: number[][] = [];
      for (let i = 1; i < vseg; i++) {
        const row: number[] = [];
        for (let k = 0; k < u; k++) {
          const q = pt(i, k);
          row.push(this.v(q[0], q[1], q[2], q[0], q[1], q[2]));
        }
        rows.push(row);
      }
      const last = rows[rows.length - 1];
      for (let k = 0; k < u; k++) {
        const k2 = (k + 1) % u;
        this.face([top, rows[0][k2], rows[0][k]]);
        for (let i = 0; i < rows.length - 1; i++)
          this.face([rows[i + 1][k2], rows[i + 1][k], rows[i][k], rows[i][k2]]);
        this.face([last[k], last[k2], bot]);
      }
    } else {
      for (let k = 0; k < u; k++) {
        const k2 = (k + 1) % u;
        this.flat([[0, 0, 1], pt(1, k2), pt(1, k)]);
        for (let i = 1; i < vseg - 1; i++)
          this.flat([pt(i + 1, k2), pt(i + 1, k), pt(i, k), pt(i, k2)]);
        this.flat([pt(vseg - 1, k), pt(vseg - 1, k2), [0, 0, -1]]);
      }
    }
  }

  slab(o: Op<"slab">) {
    const [w, d] = typeof o.size === "number" ? [o.size, o.size] : o.size;
    const [cx, cy] = o.center ?? [0, 0];
    const s = o.segments ?? 10;
    const t = o.thickness;
    this.begin(
      o.p,
      o.mat,
      [cx, cy, o.z_top - t / 2],
      eulerXYZ(undefined),
      [1, 1, 1],
    );
    const r = Math.min(o.radius, w / 2, d / 2);
    const ring: number[][] = [];
    const quarters = [
      [1, 1, 0],
      [-1, 1, 0.5],
      [-1, -1, 1],
      [1, -1, 1.5],
    ];
    for (const [sx, sy, a0] of quarters) {
      for (let k = 0; k <= s; k++) {
        const a = (a0 + k / s / 2) * Math.PI;
        ring.push([
          sx * (w / 2 - r) + r * Math.cos(a),
          sy * (d / 2 - r) + r * Math.sin(a),
        ]);
      }
    }
    this.flat(ring.map(([x, y]) => [x, y, t / 2]));
    this.flat(ring.map(([x, y]) => [x, y, -t / 2]).reverse());
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      this.flat([
        [a[0], a[1], -t / 2],
        [b[0], b[1], -t / 2],
        [b[0], b[1], t / 2],
        [a[0], a[1], t / 2],
      ]);
    }
  }

  poly(o: Op<"poly">) {
    this.begin(o.p, o.mat, [0, 0, 0], eulerXYZ(undefined), [1, 1, 1]);
    this.flat(o.points);
  }

  /** Part.finish(): 部品の位置・回転・倍率をかけて、全体のメッシュに足す */
  finish(o: Op<"finish">) {
    const m = this.parts.get(o.p);
    if (!m) return;
    const loc = o.loc ? [o.loc[0], o.loc[1], o.loc[2] ?? 0] : [0, 0, 0];
    const R = eulerXYZ(o.rot ?? [0, 0, o.rot_z ?? 0]);
    const sc = o.scale ?? 1;
    const out = this.out;
    const base = out.P.length / 3;
    for (let i = 0; i < m.P.length; i += 3) {
      const x = m.P[i] * sc;
      const y = m.P[i + 1] * sc;
      const z = m.P[i + 2] * sc;
      out.P.push(
        R[0] * x + R[1] * y + R[2] * z + loc[0],
        R[3] * x + R[4] * y + R[5] * z + loc[1],
        R[6] * x + R[7] * y + R[8] * z + loc[2],
      );
      const a = m.N[i];
      const b = m.N[i + 1];
      const c = m.N[i + 2];
      out.N.push(
        R[0] * a + R[1] * b + R[2] * c,
        R[3] * a + R[4] * b + R[5] * c,
        R[6] * a + R[7] * b + R[8] * c,
      );
    }
    for (const i of m.idx) out.idx.push(base + i);
    for (const c of m.counts) out.counts.push(c);
    for (const f of m.fmat) out.fmat.push(f);
    for (const f of m.fprim) out.fprim.push(f);
    this.parts.delete(o.p);
  }

  run(ops: TraceOp[]) {
    for (const o of ops) {
      switch (o.op) {
        case "part":
          break;
        case "box":
          this.box(o);
          break;
        case "cyl":
          this.cyl(o);
          break;
        case "limb":
          this.limb(o);
          break;
        case "sphere":
          this.sphere(o);
          break;
        case "slab":
          this.slab(o);
          break;
        case "poly":
          this.poly(o);
          break;
        case "finish":
          this.finish(o);
          break;
        default:
          throw new Error(`知らない基本形 ${(o as TraceOp).op}`);
      }
    }
  }
}

/** 組んだ形。座標はプロトコル（Y が上、正面は +Z、原点は外接箱の底面の中心） */
export type BuiltMesh = {
  P: Float64Array;
  N: Float32Array;
  idx: number[];
  counts: number[];
  /** 面ごとの材質の番号（mats の添字） */
  fmat: number[];
  /** 面ごとの基本形の番号（部品表の基本形の順） */
  fprim: number[];
  mats: string[];
  tris: number;
  /** 外接箱の [幅, 高さ, 奥行き]（m） */
  size: Vec3;
};

/** 部品表から形を作り、外接箱の底面の中心を原点にして、Y が上・正面 +Z の座標に直す */
export function buildMesh(ops: TraceOp[]): BuiltMesh {
  const b = new Builder();
  b.run(ops);
  const { P: bp, N: bn, idx, counts, fmat, fprim } = b.out;
  if (bp.length === 0) throw new Error("形が空");
  let lx = Number.POSITIVE_INFINITY;
  let ly = Number.POSITIVE_INFINITY;
  let lz = Number.POSITIVE_INFINITY;
  let hx = Number.NEGATIVE_INFINITY;
  let hy = Number.NEGATIVE_INFINITY;
  let hz = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < bp.length; i += 3) {
    lx = Math.min(lx, bp[i]);
    hx = Math.max(hx, bp[i]);
    ly = Math.min(ly, bp[i + 1]);
    hy = Math.max(hy, bp[i + 1]);
    lz = Math.min(lz, bp[i + 2]);
    hz = Math.max(hz, bp[i + 2]);
  }
  const sx = (lx + hx) / 2;
  const sy = (ly + hy) / 2;
  const sz = lz;
  const P = new Float64Array(bp.length);
  const N = new Float32Array(bn.length);
  for (let i = 0; i < bp.length; i += 3) {
    // Blender (x, y, z) → プロトコル (x, z, -y)
    P[i] = bp[i] - sx;
    P[i + 1] = bp[i + 2] - sz;
    P[i + 2] = -(bp[i + 1] - sy);
    N[i] = bn[i];
    N[i + 1] = bn[i + 2];
    N[i + 2] = -bn[i + 1];
  }
  let tris = 0;
  for (const c of counts) tris += c - 2;
  return {
    P,
    N,
    idx,
    counts,
    fmat,
    fprim,
    mats: b.mats,
    tris,
    size: [hx - lx, hz - lz, hy - ly],
  };
}

/**
 * 上に物を置ける面の高さ（anchors.top）。上を向いた面（法線の y が 0.95 より大きい）を 1 cm ごとの高さに分けて面積を足し、
 * 床面積（幅×奥行き）の 30% 以上ある高さのうち最も高いものを返す（無ければ最も広い高さ）。
 * テーブルの上の花瓶のような小さな面は選ばず、皿に載ったケーキはケーキの上面を選ぶ。上を向いた面が無ければ undefined
 */
export function topHeight(m: BuiltMesh): number | undefined {
  const area = new Map<number, number>();
  const highest = new Map<number, number>();
  let start = 0;
  for (const c of m.counts) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let ysum = 0;
    for (let k = 0; k < c; k++) {
      const a = m.idx[start + k] * 3;
      const b = m.idx[start + ((k + 1) % c)] * 3;
      nx += (m.P[a + 1] - m.P[b + 1]) * (m.P[a + 2] + m.P[b + 2]);
      ny += (m.P[a + 2] - m.P[b + 2]) * (m.P[a] + m.P[b]);
      nz += (m.P[a] - m.P[b]) * (m.P[a + 1] + m.P[b + 1]);
      ysum += m.P[a + 1];
    }
    start += c;
    const l = Math.hypot(nx, ny, nz);
    if (l === 0 || ny / l <= 0.95) continue;
    const y = ysum / c;
    const key = Math.round(y * 100);
    area.set(key, (area.get(key) ?? 0) + l / 2);
    highest.set(key, Math.max(highest.get(key) ?? y, y));
  }
  const floor = m.size[0] * m.size[2];
  let best: number | undefined;
  let widest: number | undefined;
  for (const [key, a] of area) {
    if (a >= 0.3 * floor && (best === undefined || key > best)) best = key;
    if (widest === undefined || a > (area.get(widest) ?? 0)) widest = key;
  }
  best ??= widest;
  if (best === undefined) return undefined;
  return Math.round((highest.get(best) ?? 0) * 1000) / 1000;
}

// ---------- USDA ----------

const round = (x: number, k: number) => {
  const r = Math.round(x * k) / k;
  return r === 0 ? "0" : String(r);
};
const f5 = (x: number) => round(x, 1e5);
const f4 = (x: number) => round(x, 1e4);
const safe = (s: string) =>
  s.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");

const GRAY: Material = {
  hex: "#cccccc",
  base: [0.6, 0.6, 0.6],
  rough: 0.6,
  metal: 0,
  emit: 0,
  alpha: 1,
};

export function toUsda(
  m: BuiltMesh,
  materials: Record<string, Material> = MATERIALS,
): string {
  const pts: string[] = [];
  const nrm: string[] = [];
  const lo = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const hi = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let i = 0; i < m.P.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], m.P[i + a]);
      hi[a] = Math.max(hi[a], m.P[i + a]);
    }
    pts.push(`(${f5(m.P[i])}, ${f5(m.P[i + 1])}, ${f5(m.P[i + 2])})`);
    nrm.push(`(${f4(m.N[i])}, ${f4(m.N[i + 1])}, ${f4(m.N[i + 2])})`);
  }
  const subsets: number[][] = m.mats.map(() => []);
  for (let f = 0; f < m.fmat.length; f++) subsets[m.fmat[f]].push(f);
  const parts: string[] = [];
  parts.push(`#usda 1.0
(
    defaultPrim = "root"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "root" (
    kind = "component"
)
{
    def Mesh "mesh" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        uniform bool doubleSided = 1
        float3[] extent = [(${f5(lo[0])}, ${f5(lo[1])}, ${f5(lo[2])}), (${f5(hi[0])}, ${f5(hi[1])}, ${f5(hi[2])})]
        int[] faceVertexCounts = [${m.counts.join(", ")}]
        int[] faceVertexIndices = [${m.idx.join(", ")}]
        rel material:binding = </root/_materials/${safe(m.mats[0])}>
        normal3f[] normals = [${nrm.join(", ")}] (
            interpolation = "vertex"
        )
        point3f[] points = [${pts.join(", ")}]
        uniform token subdivisionScheme = "none"
        uniform token subsetFamily:materialBind:familyType = "nonOverlapping"
`);
  m.mats.forEach((name, i) => {
    parts.push(`
        def GeomSubset "${safe(name)}" (
            prepend apiSchemas = ["MaterialBindingAPI"]
        )
        {
            uniform token elementType = "face"
            uniform token familyName = "materialBind"
            int[] indices = [${subsets[i].join(", ")}]
            rel material:binding = </root/_materials/${safe(name)}>
        }
`);
  });
  parts.push(`    }

    def Scope "_materials"
    {
`);
  for (const name of m.mats) {
    const mt = materials[name] ?? GRAY;
    const n = safe(name);
    const col = `(${f5(mt.base[0])}, ${f5(mt.base[1])}, ${f5(mt.base[2])})`;
    const emissive =
      mt.emit > 0
        ? `                color3f inputs:emissiveColor = ${col}\n`
        : "";
    const opacity =
      mt.alpha < 1
        ? `                float inputs:opacity = ${f4(mt.alpha)}\n`
        : "";
    parts.push(`        def Material "${n}"
        {
            token outputs:surface.connect = </root/_materials/${n}/surface.outputs:surface>

            def Shader "surface"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = ${col}
${emissive}                float inputs:metallic = ${f4(mt.metal)}
${opacity}                float inputs:roughness = ${f4(mt.rough)}
                token outputs:surface
            }
        }

`);
  }
  parts.push(`    }
}
`);
  return parts.join("");
}

// ---------- USDZ（無圧縮 zip、データは 64 バイト境界） ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 無圧縮の zip。各ファイルのデータの始まりを 64 バイトの倍数にする（USDZ の決まり） */
export function zipStore(
  files: { name: string; data: Uint8Array }[],
): Uint8Array {
  const enc = new TextEncoder();
  const locals: {
    name: Uint8Array;
    data: Uint8Array;
    crc: number;
    extra: number;
    offset: number;
  }[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    // データの始まり（offset + 30 + 名前 + extra）を 64 の倍数にする。extra は 4 バイトの見出し + 埋め草
    let extra = 0;
    const head = offset + 30 + name.length;
    if (head % 64 !== 0) {
      extra = 64 - (head % 64);
      if (extra < 4) extra += 64;
    }
    locals.push({ name, data: f.data, crc: crc32(f.data), extra, offset });
    offset += 30 + name.length + extra + f.data.length;
  }
  let cdSize = 0;
  for (const l of locals) cdSize += 46 + l.name.length;
  const out = new Uint8Array(offset + cdSize + 22);
  const dv = new DataView(out.buffer);
  let p = 0;
  for (const l of locals) {
    dv.setUint32(p, 0x04034b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 0, true);
    dv.setUint16(p + 8, 0, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, 0x21, true); // 時刻は 1980-01-01 00:00
    dv.setUint32(p + 14, l.crc, true);
    dv.setUint32(p + 18, l.data.length, true);
    dv.setUint32(p + 22, l.data.length, true);
    dv.setUint16(p + 26, l.name.length, true);
    dv.setUint16(p + 28, l.extra, true);
    out.set(l.name, p + 30);
    p += 30 + l.name.length;
    if (l.extra) {
      dv.setUint16(p, 0x1986, true);
      dv.setUint16(p + 2, l.extra - 4, true);
      p += l.extra;
    }
    out.set(l.data, p);
    p += l.data.length;
  }
  const cd = p;
  for (const l of locals) {
    dv.setUint32(p, 0x02014b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, 0, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, 0, true);
    dv.setUint16(p + 14, 0x21, true);
    dv.setUint32(p + 16, l.crc, true);
    dv.setUint32(p + 20, l.data.length, true);
    dv.setUint32(p + 24, l.data.length, true);
    dv.setUint16(p + 28, l.name.length, true);
    dv.setUint16(p + 30, 0, true);
    dv.setUint16(p + 32, 0, true);
    dv.setUint16(p + 34, 0, true);
    dv.setUint16(p + 36, 0, true);
    dv.setUint32(p + 38, 0, true);
    dv.setUint32(p + 42, l.offset, true);
    out.set(l.name, p + 46);
    p += 46 + l.name.length;
  }
  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 4, 0, true);
  dv.setUint16(p + 6, 0, true);
  dv.setUint16(p + 8, locals.length, true);
  dv.setUint16(p + 10, locals.length, true);
  dv.setUint32(p + 12, cdSize, true);
  dv.setUint32(p + 16, cd, true);
  dv.setUint16(p + 20, 0, true);
  return out;
}

/** 形を USDZ にする。中の USDA の名前は <id>.usda */
export function toUsdz(id: string, mesh: BuiltMesh): Uint8Array {
  const data = new TextEncoder().encode(toUsda(mesh));
  return zipStore([{ name: `${safe(id)}.usda`, data }]);
}
