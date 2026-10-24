"""砂浜のジオラマ（3D シーン）を作り、アプリ用の USDZ と発表用の画像を書き出す。

浜辺のパラソルの下で女性が眠っていて、そばに砂のお城がある。ヤシの木が 3 本あり、
手前から奥へ波が寄せて砕ける。共通の道具は common.py。

Blender の中で動かす（Blender 4.5 LTS で確認）。
使い方:
  blender --background --factory-startup --python scripts/scene/beach.py -- [--out assets/scenes] [--no-render] [--samples 128]
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HALF, SIZE, Part, material, materials, run  # noqa: E402

rng = random.Random(2622)
M: dict = {}

# 砂浜の中心からの、飾りを置かない場所（x, y, 半径）。ランダムな貝殻などはここを避ける
KEEP_OUT: list[tuple[float, float, float]] = []

SHORE_Y = 1.0  # 砂と海の境目（y）
UMBRELLA = (-1.3, -1.4)
SLEEPER = (-1.3, -2.0)
CASTLE = (0.9, -1.9)


# ---------- マテリアル ----------

def make_materials() -> None:
    M.update(materials({
        "sand": ("#f4e3b8", 0.72), "sand_wet": ("#d9bb8e", 0.45), "sand_dark": ("#cba870", 0.75),
        "sand_light": ("#fdf0d2", 0.72), "wet_base": ("#b9996c", 0.8),
        "bark": ("#9b7a50", 0.85), "bark_dark": ("#6f5234", 0.9),
        "frond": ("#3f9a3a", 0.65), "frond2": ("#5cb848", 0.65), "frond3": ("#2f7d33", 0.65),
        "coconut": ("#6b4a2a", 0.6),
        "umbrella_red": ("#e85d5d", 0.55), "umbrella_white": ("#fffaf0", 0.55),
        "pole": ("#f6efe4", 0.5),
        "towel_a": ("#2fb8ac", 0.8), "towel_b": ("#fff4e6", 0.8),
        "skin": ("#f6caa6", 0.55), "hair": ("#3a2618", 0.6),
        "swim_top": ("#ff8a7a", 0.6), "swim_bottom": ("#2f3b63", 0.6),
        "straw": ("#e7c27d", 0.7), "flip": ("#e3483c", 0.5),
        "bag": ("#ff9f43", 0.7), "bucket": ("#e85d5d", 0.5), "shovel": ("#ffd84a", 0.5),
        "castle": ("#d4b48a", 0.8), "castle_dark": ("#b89c72", 0.85), "window": ("#5b4636", 0.6),
        "shell_pink": ("#ffb7a5", 0.4), "shell_white": ("#fff4e6", 0.4),
        "driftwood": ("#a48b6a", 0.9), "dark": ("#2a211c", 0.3),
        "foam": ("#f7fbff", 0.5), "wash": ("#fdfdfd", 0.5),
        "cooler": ("#3a7bd5", 0.4), "rock": ("#7d7468", 0.55), "beak": ("#f5a623", 0.4),
        "book": ("#7b5ea7", 0.5), "glasses": ("#1d1d1f", 0.15), "bottle": ("#bfe9ff", 0.1),
    }))
    M["sea"] = material("sea", "#1f9bd1", 0.12, coat=0.6, ior=1.33)
    M["sea_deep"] = material("sea_deep", "#1a7fb8", 0.3)
    M["glass"] = material("glass", "#ffe7a8", 0.2, emit=4.0)


def free(x: float, y: float, r: float = 0.0) -> bool:
    """(x, y) の周りに、飾りを置いてよい場所があるか。"""
    return all(math.hypot(x - kx, y - ky) >= kr + r for kx, ky, kr in KEEP_OUT)


# ---------- 地面と海 ----------

def build_ground(root) -> None:
    # 海の下の床と、砂の下の層
    under = Part("ground_under")
    under.slab(SIZE, -0.25, 0.85, 0.96, M["wet_base"])
    under.slab(SIZE - 0.4, -1.1, 0.18, 0.8, M["sand_dark"])
    under.finish(root)

    # 乾いた砂の面（岸より手前）。奥の海とは岸の線で分かれる
    dry = Part("sand_dry")
    dry.slab((SIZE, SHORE_Y + HALF), 0.0, 0.25, 0.9, M["sand"], center=(0, (SHORE_Y - HALF) / 2))
    dry.finish(root)

    # 海の水面（砂より少し低い）
    sea = Part("sea")
    sea.box((SIZE, HALF - SHORE_Y, 0.3), (0, (HALF + SHORE_Y) / 2, -0.2), M["sea"])
    sea.finish(root)

    # 岸のぬれた砂の帯と、引いていく波の白い泡
    wet = Part("wet_sand")
    wet.box((SIZE, 0.55, 0.012), (0, SHORE_Y - 0.28, 0.0), M["sand_wet"])
    wet.finish(root)
    wash = Part("wash")
    for _ in range(18):
        x = rng.uniform(-HALF + 0.3, HALF - 0.3)
        wash.box((rng.uniform(0.35, 0.7), 0.07, 0.018), (x, SHORE_Y + rng.uniform(0.02, 0.12), 0.012),
                 M["wash"], rot=(0, 0, rng.uniform(-0.2, 0.2)))
    wash.finish(root)

    # 砂のつぶ（表面の模様）
    grains = Part("sand_grains")
    for _ in range(120):
        x, y = rng.uniform(-HALF + 0.2, HALF - 0.2), rng.uniform(-HALF + 0.2, SHORE_Y - 0.35)
        if not free(x, y, 0.0):
            continue
        grains.blob(rng.uniform(0.012, 0.022), (x, y, 0.006), rng.choice([M["sand_dark"], M["sand_light"]]),
                    scale=(1, 1, 0.5), bumpy=0.04, subdiv=2, seed=rng.random() * 9)
    grains.finish(root)


# ---------- 波 ----------

def build_waves(root) -> None:
    """手前から奥へ 3 列の波。青い波の体に白い泡の帽子と、飛び散るしぶきを付ける。"""
    water = Part("waves")
    foam = Part("waves_foam")
    spray = Part("waves_spray")
    rows = [(1.55, 0.26, 0.0), (2.45, 0.36, 1.3), (3.3, 0.3, 2.4)]
    for y0, amp, phase in rows:
        n = 26
        for i in range(n):
            x = -HALF + 0.2 + (SIZE - 0.4) * i / (n - 1)
            crest = amp * (0.55 + 0.45 * math.sin(x * 1.1 + phase)) * (0.7 + 0.3 * math.cos(x * 0.6 - phase))
            h = max(0.05, crest)
            # 波の体。岸へ倒れかかるように、少し手前にずらす
            water.blob(0.2 + 0.08 * math.sin(i), (x, y0 - 0.05, h * 0.55), M["sea"],
                       scale=(1.1, 0.7, 1.4), bumpy=0.04, subdiv=3, seed=phase + i * 0.37)
            # 崩れる白い帽子
            foam.blob(0.16, (x - 0.02, y0 - 0.16, h * 1.02), M["foam"],
                      scale=(1.4, 0.45, 0.5), bumpy=0.12, subdiv=3, seed=phase + i * 0.91)
            if i % 3 == 0:
                spray.sphere(0.035, (x + 0.1, y0 - 0.34, h + 0.22 + 0.1 * math.sin(i * 2.0)),
                             M["foam"], segs=8)
    water.finish(root)
    foam.finish(root)
    spray.finish(root)


# ---------- パラソル ----------

def canopy_wedge(p: Part, cx: float, cy: float, z0: float, radius: float, height: float,
                 a0: float, a1: float, mat) -> None:
    """パラソルの布の一枚（くさび形）。頂点から外へ広がる三角の面で作る。"""
    tb = bmesh.new()
    apex = tb.verts.new((cx, cy, z0 + height))
    c0 = tb.verts.new((cx, cy, z0))
    e0 = tb.verts.new((cx + radius * math.cos(a0), cy + radius * math.sin(a0), z0))
    e1 = tb.verts.new((cx + radius * math.cos(a1), cy + radius * math.sin(a1), z0))
    tb.faces.new((apex, e0, e1))   # 布の表面
    tb.faces.new((apex, c0, e0))   # 両側の面
    tb.faces.new((apex, e1, c0))
    tb.faces.new((c0, e1, e0))     # 底（裏から見えるように）
    bmesh.ops.recalc_face_normals(tb, faces=list(tb.faces))
    p._merge(tb, mat, smooth=False)


def build_umbrella(root) -> None:
    cx, cy = UMBRELLA
    pole = Part("umbrella")
    # 砂に刺さった棒と、根元の砂の山
    pole.cyl(0.04, 0.04, 2.8, (cx, cy, 1.4), M["pole"], segs=10)
    pole.sphere(0.05, (cx, cy, 2.86), M["pole"], segs=10)
    pole.blob(0.26, (cx, cy, 0.04), M["sand_wet"], scale=(1, 1, 0.35), bumpy=0.2, subdiv=2, seed=4.0, smooth=False)
    # 布は赤と白の 8 枚を交互に
    z0, radius, height = 2.25, 1.4, 0.6
    for k in range(8):
        a0, a1 = k * math.tau / 8, (k + 1) * math.tau / 8
        canopy_wedge(pole, cx, cy, z0, radius, height, a0, a1,
                     M["umbrella_red"] if k % 2 == 0 else M["umbrella_white"])
    # 布の縁の小さな玉（ふさ）
    for k in range(8):
        a = (k + 0.5) * math.tau / 8
        pole.sphere(0.04, (cx + math.cos(a) * radius, cy + math.sin(a) * radius, z0 - 0.02),
                    M["umbrella_white"], segs=8)
    pole.finish(root)


# ---------- 寝ている女性 ----------

def build_sleeper(root) -> None:
    cx, cy = SLEEPER
    # 敷いたタオル（ストライプ）
    towel = Part("towel")
    towel.box((1.8, 0.85, 0.02), (cx, cy, 0.01), M["towel_a"], bevel=0.006)
    for k in range(-5, 6, 2):
        towel.box((0.12, 0.87, 0.024), (cx + k * 0.16, cy, 0.012), M["towel_b"])
    towel.finish(root)

    body = Part("sleeper")
    # 頭（髪の上に、顔を隠す麦わら帽子）
    head_x = cx - 0.6
    body.sphere(0.14, (head_x, cy, 0.17), M["skin"], scale=(1, 1, 0.95))
    body.sphere(0.152, (head_x + 0.03, cy + 0.02, 0.2), M["hair"], scale=(1, 1, 0.85), segs=16)
    body.cyl(0.32, 0.32, 0.025, (head_x, cy, 0.25), M["straw"], segs=18)   # 帽子のつば
    body.cyl(0.15, 0.16, 0.09, (head_x, cy, 0.3), M["straw"], segs=16)     # 帽子のクラウン
    body.cyl(0.155, 0.155, 0.02, (head_x, cy, 0.26), M["straw"], segs=16)  # 帽子のバンド
    # 首と胴（水着）
    body.cyl(0.05, 0.05, 0.08, (head_x + 0.2, cy, 0.14), M["skin"], rot=(0, math.pi / 2, 0), segs=10)
    body.sphere(0.2, (cx - 0.25, cy, 0.14), M["swim_top"], scale=(1.5, 0.85, 0.42))
    body.sphere(0.19, (cx + 0.05, cy, 0.14), M["swim_bottom"], scale=(1.2, 0.9, 0.42))
    # 脚（片方は少し曲げる）
    body.limb((cx + 0.15, cy - 0.08, 0.13), (cx + 0.6, cy - 0.1, 0.1), 0.09, 0.07, M["skin"])
    body.limb((cx + 0.15, cy + 0.1, 0.12), (cx + 0.55, cy + 0.2, 0.09), 0.09, 0.07, M["skin"])
    body.box((0.12, 0.08, 0.1), (cx + 0.66, cy - 0.1, 0.08), M["skin"], bevel=0.02)
    body.box((0.12, 0.08, 0.1), (cx + 0.6, cy + 0.2, 0.07), M["skin"], bevel=0.02)
    # 腕（胸の上で組む）
    body.limb((cx - 0.4, cy - 0.2, 0.18), (cx - 0.12, cy - 0.12, 0.22), 0.05, 0.045, M["skin"])
    body.limb((cx - 0.42, cy + 0.16, 0.18), (cx - 0.16, cy + 0.1, 0.22), 0.05, 0.045, M["skin"])
    body.finish(root)

    # 横に置いた、サンダル
    flip = Part("flip_flops")
    for dy in (-0.14, 0.14):
        flip.box((0.22, 0.09, 0.03), (cx + 0.1, cy + dy - 1.0, 0.015), M["flip"], bevel=0.01)
    flip.finish(root)


# ---------- 砂のお城 ----------

def build_castle(root) -> None:
    cx, cy = CASTLE
    p = Part("castle")
    # 土台と 3 段の城
    p.cyl(0.9, 0.92, 0.1, (cx, cy, 0.05), M["castle_dark"], segs=24)
    p.cyl(0.74, 0.76, 0.2, (cx, cy, 0.2), M["castle"], segs=24)
    p.cyl(0.52, 0.54, 0.2, (cx, cy, 0.4), M["castle"], segs=22)
    p.cyl(0.3, 0.32, 0.22, (cx, cy, 0.61), M["castle"], segs=20)
    # 各段のぎざぎざの塀
    for z, r, n in [(0.31, 0.74, 14), (0.51, 0.54, 12), (0.72, 0.32, 10)]:
        for k in range(n):
            a = k * math.tau / n
            if k % 2:
                continue
            p.box((0.1, 0.1, 0.07), (cx + math.cos(a) * r, cy + math.sin(a) * r, z), M["castle"],
                  rot=(0, 0, a))
    # 角の小塔
    for ax, ay in [(-0.6, -0.42), (0.6, -0.42), (-0.6, 0.42), (0.6, 0.42)]:
        ox, oy = cx + ax * 0.82, cy + ay * 0.82
        p.cyl(0.1, 0.1, 0.36, (ox, oy, 0.28), M["castle"], segs=12)
        p.cyl(0.13, 0.0, 0.16, (ox, oy, 0.54), M["castle_dark"], segs=12)
    # 真ん中の塔と旗
    p.cyl(0.13, 0.12, 0.34, (cx, cy, 0.9), M["castle"], segs=14)
    p.cyl(0.16, 0.0, 0.2, (cx, cy, 1.1), M["castle_dark"], segs=14)
    p.cyl(0.008, 0.008, 0.32, (cx, cy, 1.36), M["dark"], segs=6)
    p.box((0.18, 0.01, 0.1), (cx + 0.09, cy, 1.4), M["umbrella_red"], bevel=0.003)
    # 入口のアーチと窓
    p.box((0.2, 0.06, 0.2), (cx, cy - 0.76, 0.2), M["window"], bevel=0.02)
    p.sphere(0.1, (cx, cy - 0.76, 0.3), M["window"], scale=(1, 0.3, 1), segs=12)
    for ax in (-0.3, 0.3):
        p.box((0.07, 0.05, 0.1), (cx + ax, cy - 0.55, 0.52), M["window"])
    p.finish(root)

    # 砂のバケツと、ひっくり返したスコップ
    tools = Part("beach_tools")
    tools.cyl(0.17, 0.15, 0.24, (cx + 1.0, cy - 0.5, 0.12), M["bucket"], segs=16)
    tools.cyl(0.14, 0.14, 0.02, (cx + 1.0, cy - 0.5, 0.245), M["sand_wet"], segs=16)
    tools.box((0.04, 0.5, 0.03), (cx + 0.5, cy - 0.9, 0.02), M["shovel"], rot=(0, 0, 0.5), bevel=0.01)
    tools.box((0.14, 0.14, 0.02), (cx + 0.36, cy - 1.2, 0.02), M["shovel"], rot=(0, 0, 0.5), bevel=0.01)
    tools.finish(root)


# ---------- ヤシの木 ----------

def build_palm(root, name: str, base, height: float, lean) -> None:
    """カーブした幹と、放射状に伸びる葉、その下のココナッツ。"""
    trunk = Part(name + "_trunk")
    segs = 12
    pts = [Vector(base) + Vector((lean[0] * (i / segs) ** 2, lean[1] * (i / segs) ** 2, height * i / segs))
           for i in range(segs + 1)]
    for i in range(segs):
        r1 = 0.2 - 0.09 * i / segs
        r2 = 0.2 - 0.09 * (i + 1) / segs
        trunk.limb(pts[i], pts[i + 1], r1, r2, M["bark"], segs=10)
        # 幹の輪の模様（ところどころ濃い節）
        if i % 2 == 0:
            trunk.blob(r1 * 1.12, pts[i].lerp(pts[i + 1], 0.5), M["bark_dark"], scale=(1, 1, 0.45),
                       bumpy=0.12, subdiv=2, seed=i * 0.7, smooth=False)
    trunk.finish(root)

    top = pts[-1]
    crown = Part(name + "_crown")
    count = 8
    for k in range(count):
        ang = k * math.tau / count + rng.uniform(-0.15, 0.15)
        length = rng.uniform(1.45, 1.8)
        droop = rng.uniform(0.6, 0.9)
        frond_points = []
        for j in range(7 + 1):
            t = j / 7
            frond_points.append(top + Vector((math.cos(ang) * length * t, math.sin(ang) * length * t,
                                              0.25 * (1 - t) - droop * t * t)))
        mat = [M["frond"], M["frond2"], M["frond3"]][k % 3]
        side = Vector((-math.sin(ang), math.cos(ang), 0))
        for j in range(7):
            w = 0.09 * (1 - j / 7) + 0.02
            crown.limb(frond_points[j], frond_points[j + 1], w, 0.09 * (1 - (j + 1) / 7) + 0.02, mat, segs=6)
            if j > 0:
                # 葉の筋（両側に細い葉）
                for s in (-1, 1):
                    tip = frond_points[j] + side * s * 0.36 * (1 - j / 7) + Vector((0, 0, -0.14))
                    crown.limb(frond_points[j], tip, 0.02, 0.008, mat, segs=5)
    # 下に垂れるココナッツ
    for k in range(4):
        a = k * math.tau / 4 + rng.uniform(0, 0.5)
        crown.sphere(0.1, top + Vector((math.cos(a) * 0.18, math.sin(a) * 0.18, -0.2)), M["coconut"], segs=12)
    crown.finish(root)


# ---------- 浜辺の小物 ----------

def build_beach_items(root) -> None:
    # ビーチバッグ
    bag = Part("beach_bag")
    bag.box((0.5, 0.14, 0.34), (-0.7, -3.1, 0.17), M["bag"], bevel=0.03)
    bag.box((0.3, 0.02, 0.08), (-0.7, -3.18, 0.27), M["sand_light"], bevel=0.005)
    bag.finish(root)

    # 流木
    wood = Part("driftwood")
    wood.limb((2.2, -0.9, 0.04), (1.4, -0.55, 0.06), 0.06, 0.04, M["driftwood"])
    wood.limb((1.7, -0.7, 0.06), (1.9, -0.35, 0.16), 0.03, 0.02, M["driftwood"])
    wood.finish(root)

    # 貝殻（ランダムに、飾りの無い場所へ）
    shells = Part("shells")
    count = 0
    while count < 16:
        x, y = rng.uniform(-3.5, 3.5), rng.uniform(-3.7, SHORE_Y - 0.4)
        if not free(x, y, 0.1):
            continue
        shells.cyl(0.035, 0.012, 0.04, (x, y, 0.02), rng.choice([M["shell_pink"], M["shell_white"]]),
                   rot=(rng.uniform(0, 0.6), 0, rng.uniform(0, 3)), segs=8, smooth=False)
        count += 1
    shells.finish(root)


# ---------- 追加の小物 ----------

def build_lounger(root) -> None:
    """ストライプの寝椅子。背もたれを少し起こしている。"""
    x, y = -0.2, -2.7
    p = Part("lounger")
    for dx in (-0.55, 0.55):
        for dy in (-0.25, 0.25):
            p.cyl(0.02, 0.02, 0.22, (x + dx, y + dy, 0.11), M["pole"], segs=8)
    p.box((1.3, 0.62, 0.05), (x, y, 0.24), M["towel_a"], bevel=0.015)
    for k in (-0.4, -0.13, 0.13, 0.4):
        p.box((0.1, 0.63, 0.052), (x + k, y, 0.242), M["towel_b"])
    p.box((0.75, 0.62, 0.04), (x - 0.6, y, 0.42), M["towel_a"], rot=(0, 0.55, 0), bevel=0.012)
    p.finish(root)


def build_surfboard(root) -> None:
    """砂に立てかけたサーフボード。白地に赤い帯。"""
    x, y = 2.7, -2.0
    p = Part("surfboard")
    p.box((0.42, 1.75, 0.05), (x, y, 0.85), M["wash"], rot=(1.2, 0, 0.25), bevel=0.02)
    p.box((0.1, 1.76, 0.056), (x, y, 0.85), M["umbrella_red"], rot=(1.2, 0, 0.25))
    p.finish(root)


def build_beach_ball(root) -> None:
    """三色のビーチボール。"""
    x, y, r = 0.1, -3.4, 0.2
    p = Part("beach_ball")
    p.sphere(r, (x, y, r), M["umbrella_white"], segs=24)
    for k, mat in enumerate(("umbrella_red", "sea", "shovel")):
        p.sphere(r * 1.01, (x, y, r), M[mat], scale=(0.33, 1, 1), rot=(0, 0, k * math.tau / 3), segs=24)
    p.finish(root)


def build_cooler(root) -> None:
    """青いクーラーボックスと白いふた。"""
    x, y = 2.2, -3.3
    p = Part("cooler")
    p.box((0.52, 0.34, 0.26), (x, y, 0.13), M["cooler"], bevel=0.03)
    p.box((0.54, 0.36, 0.05), (x, y, 0.285), M["umbrella_white"], bevel=0.02)
    p.box((0.2, 0.02, 0.03), (x, y - 0.2, 0.33), M["pole"], bevel=0.01)
    p.finish(root)


def build_lifebuoy(root) -> None:
    """赤白の浮き輪を立てた支柱。"""
    x, y = -3.5, 1.4
    p = Part("lifebuoy")
    p.cyl(0.03, 0.03, 0.9, (x, y, 0.45), M["pole"], segs=8)
    for k in range(16):
        a = k * math.tau / 16
        mat = M["umbrella_red"] if k % 2 == 0 else M["umbrella_white"]
        p.sphere(0.055, (x + math.cos(a) * 0.2, y, 0.9 + math.sin(a) * 0.2), mat, segs=10)
    p.finish(root)


def build_rocks(root) -> None:
    """浅瀬の岩。"""
    p = Part("rocks")
    for x, y, r in [(3.5, 1.7, 0.35), (3.0, 2.2, 0.22), (3.9, 2.4, 0.28)]:
        p.blob(r, (x, y, r * 0.5), M["rock"], scale=(1.2, 1, 0.7), bumpy=0.1, subdiv=3, seed=x + y)
    p.finish(root)


def build_gulls(root) -> None:
    """砂の上にとまっているカモメ。"""
    p = Part("gulls")
    for x, y, a in [(0.4, 0.3, 0.4), (-0.2, 0.6, -1.0)]:
        p.sphere(0.07, (x, y, 0.07), M["wash"], scale=(1.6, 0.7, 0.8), segs=12)
        p.sphere(0.035, (x, y - 0.08, 0.1), M["wash"], segs=10)
        p.box((0.22, 0.04, 0.02), (x, y, 0.09), M["wash"], rot=(0, 0, a))
        p.box((0.05, 0.02, 0.015), (x, y - 0.12, 0.1), M["beak"], rot=(0, 0, 0))
    p.finish(root)


def build_towel_props(root) -> None:
    """タオルの上の本・水のボトル・サングラス。"""
    cx, cy = SLEEPER
    p = Part("towel_props")
    p.box((0.2, 0.14, 0.04), (cx + 0.5, cy + 0.2, 0.035), M["book"], bevel=0.005)
    p.cyl(0.04, 0.04, 0.2, (cx + 0.45, cy - 0.25, 0.1), M["bottle"], segs=12)
    p.box((0.12, 0.05, 0.02), (cx + 0.1, cy + 0.3, 0.02), M["glasses"], bevel=0.005)
    p.finish(root)


def build_beach() -> bpy.types.Object:
    root = bpy.data.objects.new("beach", None)
    bpy.context.scene.collection.objects.link(root)

    # 飾りを置かない場所（パラソル・寝ている女性・お城・ヤシの木）
    KEEP_OUT.extend([(UMBRELLA[0], UMBRELLA[1], 1.5), (SLEEPER[0], SLEEPER[1], 1.1), (CASTLE[0], CASTLE[1], 1.2),
                     (-0.7, -3.1, 0.35), (2.9, 0.3, 1.2), (-3.2, -0.9, 1.2), (2.2, 0.5, 0.9),
                     (-0.2, -2.7, 0.9), (2.7, -2.0, 0.4), (0.1, -3.4, 0.3), (2.2, -3.3, 0.4),
                     (-3.5, 1.4, 0.3), (3.4, 2.1, 0.6), (0.4, 0.3, 0.15), (-0.2, 0.6, 0.15)])

    build_ground(root)
    build_waves(root)
    build_umbrella(root)
    build_sleeper(root)
    build_castle(root)
    build_palm(root, "palm_right", (2.9, 0.3, 0.0), 3.3, (-0.25, 0.1))
    build_palm(root, "palm_left", (-3.2, -0.9, 0.0), 3.0, (0.3, 0.1))
    build_palm(root, "palm_mid", (2.2, 0.5, 0.0), 2.5, (0.2, -0.2))
    build_beach_items(root)
    build_lounger(root)
    build_surfboard(root)
    build_beach_ball(root)
    build_cooler(root)
    build_lifebuoy(root)
    build_rocks(root)
    build_gulls(root)
    build_towel_props(root)
    return root


def build():
    make_materials()
    return build_beach()


if __name__ == "__main__":
    run("beach", build)
