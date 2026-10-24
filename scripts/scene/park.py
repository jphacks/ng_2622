"""公園のジオラマ（3D シーン）を作り、アプリ用の USDZ と発表用の画像を書き出す。

Blender の中で動かす（Blender 4.5 LTS で確認）。共通の道具は common.py。

使い方:
  blender --background --factory-startup --python scripts/scene/park.py -- [--out assets/scenes] [--no-render] [--samples 128]
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HALF, SIZE, Part, material, materials, run  # noqa: E402

rng = random.Random(2622)


# ---------- マテリアル ----------

M = {}


def make_materials() -> None:
    M.update(materials({
        "grass": ("#6dbb45", 0.9), "grass_dark": ("#4a9530", 0.9), "grass_light": ("#93d35c", 0.9),
        "soil": ("#7a4a2a", 0.95), "soil_dark": ("#4f2f1a", 0.95),
        "rock": ("#8d8d94", 0.8), "rock_dark": ("#6a6a72", 0.85),
        "stone_a": ("#cbbfa8", 0.75), "stone_b": ("#b2a58f", 0.8),
        "wood": ("#a8683a", 0.55), "fence": ("#c98e5a", 0.6),
        "bark": ("#6b4428", 0.9),
        "leaf": ("#3f9a3a", 0.7), "leaf2": ("#5cb848", 0.7), "leaf3": ("#2f7d33", 0.7),
        "blossom": ("#f7b6c8", 0.6), "blossom2": ("#f093b0", 0.6),
        "lily": ("#4c9c3b", 0.5),
        "dog": ("#e0893a", 0.7), "dog_white": ("#f6efe4", 0.7), "dark": ("#2a211c", 0.3),
        "skin": ("#f6caa6", 0.55), "hair": ("#3a2618", 0.6), "shirt": ("#ffcf3a", 0.7),
        "shorts": ("#3d6fb6", 0.7), "shoe": ("#e3483c", 0.5), "white": ("#ffffff", 0.6), "cheek": ("#f59a9a", 0.6),
        "stem": ("#4e9a33", 0.7),
        "flower_pink": ("#ff8fb3", 0.6), "flower_yellow": ("#ffd84a", 0.6),
        "flower_white": ("#fffaf0", 0.6), "flower_purple": ("#b48cff", 0.6),
    }))
    M["iron"] = material("iron", "#2b2b30", 0.35, metal=0.8)
    M["ball"] = material("ball", "#e8352b", 0.3, coat=0.6)
    M["glass"] = material("glass", "#ffe7a8", 0.2, emit=4.0)
    # 水は空の映り込みが強いと灰色に見えるので、反射を弱めて青を出す
    M["water"] = material("water", "#1f78c8", 0.3, ior=1.12)


# ---------- 公園の部品 ----------

def path_points():
    """手前から奥へ S 字に曲がる飛び石の中心。"""
    pts = []
    for i in range(15):
        t = i / 14
        y = -HALF + 0.35 + (SIZE - 0.7) * t
        x = 0.55 * math.sin(t * math.pi * 2.2) + 0.2
        side = 0.16 if i % 2 else -0.16
        pts.append((x + side, y))
    return pts


def build_island(root):
    p = Part("island")
    p.slab(SIZE, 0.0, 0.25, 1.0, M["grass"])
    p.slab(SIZE - 0.08, -0.25, 0.85, 0.96, M["soil"])
    p.slab(SIZE - 0.4, -1.1, 0.18, 0.8, M["soil_dark"])
    p.finish(root)

    # 土の側面に埋まった岩
    rocks = Part("island_rocks")
    for _ in range(26):
        side = rng.choice(["x+", "x-", "y+", "y-"])
        a = rng.uniform(-HALF + 1.2, HALF - 1.2)
        z = rng.uniform(-1.0, -0.45)
        d = HALF - 0.02
        loc = {"x+": (d, a, z), "x-": (-d, a, z), "y+": (a, d, z), "y-": (a, -d, z)}[side]
        rocks.blob(rng.uniform(0.14, 0.3), loc, rng.choice([M["rock"], M["rock_dark"]]),
                   scale=(1, 1, 0.75), bumpy=0.3, subdiv=2, seed=rng.random() * 10, smooth=False)
    rocks.finish(root)


def build_path(root):
    p = Part("path")
    for i, (x, y) in enumerate(path_points()):
        r = rng.uniform(0.22, 0.28)
        mat = M["stone_a"] if i % 3 else M["stone_b"]
        p.cyl(r, r * 0.92, 0.07, (x, y, 0.03), mat, rot=(0, 0, rng.random() * 3), segs=12, smooth=True)
    p.finish(root)


def build_pond(root, cx, cy, r):
    p = Part("pond")
    p.cyl(r, r, 0.05, (cx, cy, 0.02), M["water"], segs=40, smooth=False)
    for k in range(18):
        a = k / 18 * math.tau + rng.uniform(-0.08, 0.08)
        rr = r + rng.uniform(0.05, 0.15)
        p.blob(rng.uniform(0.13, 0.2), (cx + math.cos(a) * rr, cy + math.sin(a) * rr, 0.05),
               rng.choice([M["rock"], M["rock_dark"]]), scale=(1, 1, 0.6), bumpy=0.25, subdiv=2,
               seed=rng.random() * 10, smooth=False)
    for dx, dy, s in [(-0.3, 0.2, 0.2), (0.25, -0.15, 0.16), (0.05, 0.35, 0.12)]:
        p.cyl(s, s, 0.015, (cx + dx, cy + dy, 0.055), M["lily"], segs=14, smooth=False)
    p.sphere(0.045, (cx - 0.3, cy + 0.2, 0.08), M["flower_pink"], segs=10)
    p.finish(root)


def build_tree(root, name, loc, height=3.2, blossom=False, crown=1.0):
    p = Part(name)
    trunk_h = height * 0.5
    p.cyl(0.2, 0.11, trunk_h, (0, 0, trunk_h / 2), M["bark"], segs=10)
    p.cyl(0.07, 0.04, 0.8, (0.22, 0, trunk_h * 0.85), M["bark"], rot=(0, 0.8, 0), segs=8)
    p.cyl(0.06, 0.035, 0.7, (-0.18, 0.05, trunk_h * 0.9), M["bark"], rot=(0.2, -0.7, 0), segs=8)
    mats = [M["blossom"], M["blossom2"], M["blossom"]] if blossom else [M["leaf"], M["leaf2"], M["leaf3"]]
    cz = trunk_h + 0.75 * crown
    blobs = [(0, 0, cz, 0.95), (0.6, 0.2, cz - 0.25, 0.7), (-0.55, -0.15, cz - 0.2, 0.72),
             (0.1, -0.5, cz - 0.1, 0.65), (-0.1, 0.5, cz + 0.05, 0.68), (0.15, 0.05, cz + 0.6, 0.62)]
    for i, (x, y, z, r) in enumerate(blobs):
        p.blob(r * crown, (x * crown, y * crown, z), mats[i % 3], bumpy=0.18, subdiv=3, seed=i * 3.1 + loc[0])
    p.finish(root, loc=(*loc, 0))
    if blossom:
        # 根元に散った花びら
        petals = Part(name + "_petals")
        for _ in range(28):
            a, d = rng.random() * math.tau, rng.uniform(0.4, 1.4)
            petals.cyl(0.045, 0.045, 0.01, (loc[0] + math.cos(a) * d, loc[1] + math.sin(a) * d, 0.01),
                       rng.choice([M["blossom"], M["blossom2"]]), segs=6, smooth=False)
        petals.finish(root)


def build_bench(root, loc, rot_z):
    p = Part("bench")
    for i in range(4):
        p.box((1.6, 0.085, 0.045), (0, -0.17 + i * 0.105, 0.46), M["wood"], bevel=0.012)
    for i in range(3):
        p.box((1.6, 0.045, 0.085), (0, 0.27, 0.62 + i * 0.12), M["wood"], rot=(-0.22, 0, 0), bevel=0.012)
    for x in (-0.68, 0.68):
        p.box((0.05, 0.05, 0.45), (x, -0.17, 0.225), M["iron"], bevel=0.01)
        p.box((0.05, 0.05, 0.95), (x, 0.24, 0.47), M["iron"], rot=(-0.22, 0, 0), bevel=0.01)
        p.box((0.06, 0.5, 0.045), (x, 0.02, 0.66), M["iron"], bevel=0.015)
        p.box((0.05, 0.45, 0.04), (x, 0.03, 0.43), M["iron"], bevel=0.01)
    p.finish(root, loc=(*loc, 0), rot_z=rot_z)


def build_lamp(root, loc):
    p = Part("lamp")
    p.cyl(0.16, 0.13, 0.16, (0, 0, 0.08), M["iron"], segs=16)
    p.cyl(0.05, 0.04, 2.6, (0, 0, 1.45), M["iron"], segs=12)
    p.cyl(0.08, 0.08, 0.06, (0, 0, 2.75), M["iron"], segs=12)
    p.cyl(0.13, 0.17, 0.34, (0, 0, 2.95), M["glass"], segs=6, smooth=False)
    p.cyl(0.25, 0.03, 0.22, (0, 0, 3.23), M["iron"], segs=6, smooth=False)
    p.sphere(0.05, (0, 0, 3.37), M["iron"], segs=10)
    p.finish(root, loc=(*loc, 0))


def build_fence(root, x0, x1, y) -> list[float]:
    """柵を作り、柱の x 座標を返す。"""
    p = Part("fence")
    n = int((x1 - x0) / 0.5)
    posts = [x0 + (x1 - x0) * i / n for i in range(n + 1)]
    for x in posts:
        p.box((0.08, 0.08, 0.62), (x, y, 0.31), M["fence"], bevel=0.015)
        p.cyl(0.06, 0.0, 0.08, (x, y, 0.66), M["fence"], segs=4, smooth=False)  # 柱の先のとがり
    for z in (0.22, 0.46):
        p.box((x1 - x0 + 0.1, 0.05, 0.07), ((x0 + x1) / 2, y - 0.06, z), M["fence"], bevel=0.012)
    p.finish(root)
    return posts


def build_dog(root, loc, rot_z):
    p = Part("dog")
    p.sphere(0.2, (0, 0.02, 0.4), M["dog"], scale=(1, 1.75, 0.95))                 # 胴
    p.sphere(0.15, (0, -0.24, 0.38), M["dog_white"], scale=(1, 0.8, 1.05))        # 胸
    p.sphere(0.17, (0, -0.42, 0.62), M["dog"])                                    # 頭
    p.sphere(0.09, (0, -0.56, 0.57), M["dog_white"], scale=(1, 1.15, 0.8))        # 鼻先
    p.sphere(0.03, (0, -0.665, 0.6), M["dark"], segs=10)                          # 鼻
    for sx in (-1, 1):
        p.sphere(0.024, (sx * 0.075, -0.55, 0.67), M["dark"], segs=10)            # 目
        p.cyl(0.065, 0.0, 0.13, (sx * 0.09, -0.4, 0.79), M["dog"], rot=(-0.15, sx * 0.3, 0), segs=4, smooth=False)  # 耳
    # 走っている脚（前後に開く）
    for sx in (-1, 1):
        p.cyl(0.05, 0.045, 0.28, (sx * 0.1, -0.24, 0.17), M["dog"], rot=(-0.45, 0, 0), segs=10)
        p.cyl(0.05, 0.045, 0.28, (sx * 0.1, 0.27, 0.17), M["dog"], rot=(0.45, 0, 0), segs=10)
        p.sphere(0.05, (sx * 0.1, -0.31, 0.04), M["dog_white"], segs=10)
        p.sphere(0.05, (sx * 0.1, 0.34, 0.04), M["dog_white"], segs=10)
    # 巻いたしっぽ
    for k in range(6):
        a = k / 6 * math.pi * 1.3
        p.sphere(0.06 - k * 0.006, (0, 0.36 + math.sin(a) * 0.1, 0.55 + (1 - math.cos(a)) * 0.1 + k * 0.01),
                 M["dog"] if k < 5 else M["dog_white"], segs=10)
    p.finish(root, loc=(*loc, 0), rot_z=rot_z)


def build_boy(root, loc, rot_z):
    p = Part("boy")
    # 走る姿勢: 右足（-X）が前、左足が後ろ。腕は逆に振る。swing は前（-Y）へ振る角度
    for sx, swing in ((-1, 0.55), (1, -0.55)):
        hip = Vector((sx * 0.08, 0, 0.52))
        ankle = hip + Vector((0, -math.sin(swing), -math.cos(swing))) * 0.49
        p.limb(hip, ankle, 0.055, 0.05, M["skin"], segs=10)
        p.limb(ankle + Vector((0, math.sin(swing), math.cos(swing))) * 0.06, ankle, 0.06, 0.06, M["white"], segs=10)  # 靴下
        # 前の足はつま先を上げ、後ろの足はつま先で地面をける
        p.box((0.1, 0.17, 0.08), (ankle.x, ankle.y - 0.03, 0.05), M["shoe"], rot=(-swing * 0.4, 0, 0), bevel=0.03)
    p.sphere(0.17, (0, 0, 0.56), M["shorts"], scale=(1, 0.85, 0.7))
    p.cyl(0.17, 0.15, 0.36, (0, 0, 0.75), M["shirt"], segs=16)
    p.sphere(0.15, (0, 0, 0.93), M["shirt"], scale=(1.12, 0.9, 0.5))
    for sx, swing in ((-1, -0.7), (1, 0.7)):
        shoulder = Vector((sx * 0.19, 0, 0.92))
        hand = Vector((sx * 0.25, -math.sin(swing) * 0.26, 0.62))
        elbow = shoulder + (hand - shoulder) * 0.35
        p.limb(shoulder, elbow, 0.06, 0.055, M["shirt"], segs=10)
        p.limb(elbow, hand, 0.042, 0.038, M["skin"], segs=10)
        p.sphere(0.05, tuple(hand), M["skin"], segs=10)
    p.cyl(0.06, 0.06, 0.08, (0, 0, 1.0), M["skin"], segs=10)
    p.sphere(0.2, (0, 0, 1.17), M["skin"])
    p.sphere(0.21, (0, 0.035, 1.23), M["hair"], scale=(1, 1, 0.82))
    for sx in (-1, 1):
        p.sphere(0.026, (sx * 0.07, -0.18, 1.17), M["dark"], segs=10)
        p.sphere(0.03, (sx * 0.12, -0.15, 1.1), M["cheek"], scale=(1, 0.5, 0.7), segs=10)
        p.sphere(0.04, (sx * 0.2, 0, 1.16), M["skin"], segs=10)
    p.finish(root, loc=(*loc, 0), rot_z=rot_z)


def build_ball(root, loc):
    p = Part("ball")
    p.sphere(0.12, (0, 0, 0.12), M["ball"], segs=24)
    p.cyl(0.121, 0.121, 0.025, (0, 0, 0.12), M["white"], rot=(0.5, 0.3, 0), segs=24)
    p.finish(root, loc=(*loc, 0))


def build_flowers(root, name, cx, cy, count=16, spread=0.5):
    p = Part(name)
    colors = [M["flower_pink"], M["flower_yellow"], M["flower_white"], M["flower_purple"]]
    for _ in range(count):
        a, d = rng.random() * math.tau, rng.random() * spread
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d
        h = rng.uniform(0.14, 0.26)
        p.cyl(0.012, 0.01, h, (x, y, h / 2), M["stem"], segs=6)
        p.blob(rng.uniform(0.045, 0.065), (x, y, h), rng.choice(colors), scale=(1, 1, 0.7), bumpy=0.35, subdiv=1, seed=rng.random() * 9)
        p.sphere(0.02, (x, y, h + 0.03), M["flower_yellow"], segs=8)
    p.finish(root)


def build_bushes(root, spots):
    p = Part("bushes")
    for i, (x, y, s) in enumerate(spots):
        for k in range(3):
            p.blob(s * rng.uniform(0.6, 0.9), (x + rng.uniform(-0.25, 0.25) * s, y + rng.uniform(-0.2, 0.2) * s, s * 0.45),
                   [M["leaf"], M["leaf2"], M["leaf3"]][(i + k) % 3], scale=(1, 1, 0.8), bumpy=0.2, subdiv=3, seed=i * 5 + k)
    p.finish(root)


def build_rocks(root, spots):
    p = Part("rocks")
    for i, (x, y, s) in enumerate(spots):
        p.blob(s, (x, y, s * 0.3), M["rock"], scale=(1.2, 1, 0.7), bumpy=0.3, subdiv=2, seed=i * 2.3, smooth=False)
        p.blob(s * 0.55, (x + s * 0.9, y - s * 0.4, s * 0.2), M["rock_dark"], scale=(1.1, 1, 0.7), bumpy=0.3, subdiv=2, seed=i * 4.1, smooth=False)
    p.finish(root)


def build_grass(root, keep_out):
    """島の上に草むらを散らす。keep_out は (x, y, 半径) の、草を生やさない場所。"""
    p = Part("grass_tufts")
    placed = 0
    while placed < 260:
        x, y = rng.uniform(-HALF + 0.25, HALF - 0.25), rng.uniform(-HALF + 0.25, HALF - 0.25)
        corner = Vector((max(abs(x) - (HALF - 1.0), 0), max(abs(y) - (HALF - 1.0), 0))).length
        if corner > 0.85 or any((x - kx) ** 2 + (y - ky) ** 2 < kr ** 2 for kx, ky, kr in keep_out):
            continue
        mat = rng.choice([M["grass_dark"], M["grass_dark"], M["grass_light"]])
        for _ in range(rng.randint(3, 5)):
            h = rng.uniform(0.08, 0.16)
            lean = (rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 0)
            p.cyl(0.028, 0.0, h, (x + rng.uniform(-0.05, 0.05), y + rng.uniform(-0.05, 0.05), h / 2), mat, rot=lean, segs=4, smooth=False)
        placed += 1
    p.finish(root)


def build_park() -> bpy.types.Object:
    root = bpy.data.objects.new("park", None)
    bpy.context.scene.collection.objects.link(root)

    pond = (-1.9, 2.2, 0.95)
    bench = ((2.45, -0.3), -math.pi / 2)
    lamp = (0.95, 1.15)
    trees = [("tree_big", (2.3, 2.3), 3.4, False, 1.05), ("tree_cherry", (-2.9, -0.35), 3.0, True, 0.95),
             ("tree_small", (-3.15, 3.05), 2.3, False, 0.7)]
    dog = ((-1.3, -2.0), math.atan2(0.8, 1.0))
    ball = (-0.55, -3.0)
    boy = ((0.55, -1.0), math.radians(15))  # 画像のカメラのほうを向いて走る
    flowers = [("flowers_bench", 1.95, -1.4), ("flowers_front", -3.1, -2.6), ("flowers_pond", -0.75, 1.15), ("flowers_right", 3.3, -1.0)]
    bushes = [(3.1, -3.0, 0.5), (-0.35, 3.45, 0.45), (3.35, 0.9, 0.55)]
    rocks = [(3.25, 3.1, 0.28), (-3.35, 1.0, 0.22)]

    build_island(root)
    build_path(root)
    build_pond(root, *pond)
    for name, loc, h, blossom, crown in trees:
        build_tree(root, name, loc, h, blossom, crown)
    build_bench(root, *bench)
    build_lamp(root, lamp)
    fence_y = 3.55
    fence_posts = build_fence(root, 1.2, 3.45, fence_y)
    build_dog(root, *dog)
    build_ball(root, ball)
    build_boy(root, *boy)
    for name, x, y in flowers:
        build_flowers(root, name, x, y)
    build_bushes(root, bushes)
    build_rocks(root, rocks)

    keep_out = [(x, y, 0.42) for x, y in path_points()]
    keep_out += [(pond[0], pond[1], pond[2] + 0.35), (*bench[0], 0.95), (*lamp, 0.3), (*dog[0], 0.5), (*ball, 0.25), (*boy[0], 0.4)]
    keep_out += [(*loc, 0.35) for _, loc, *_ in trees] + [(x, y, 0.4) for _, x, y in flowers]
    keep_out += [(x, y, s + 0.2) for x, y, s in bushes] + [(x, y, s + 0.3) for x, y, s in rocks]
    keep_out += [(x, fence_y, 0.25) for x in fence_posts]
    build_grass(root, keep_out)
    return root


def build():
    make_materials()
    return build_park()


run("park", build)
