"""駅前のジオラマ（3D シーン）を作り、アプリ用の USDZ と発表用の画像を書き出す。

奥に駅舎、真ん中にタイル張りの広場、手前に横断歩道のある道路。共通の道具は common.py。

使い方:
  blender --background --factory-startup --python scripts/scene/station.py -- [--out assets/scenes] [--no-render] [--samples 128]
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HALF, SIZE, Part, material, materials, person, run  # noqa: E402

rng = random.Random(11)
M: dict = {}

ROAD_Y = -HALF + 0.75     # 道路の中心（手前）
PLAZA_Y0 = -HALF + 1.6    # 広場の手前の端


def make_materials() -> None:
    M.update(materials({
        "base": ("#cfcac2", 0.85), "base_dark": ("#8f8a83", 0.9),
        "tile_a": ("#e6ded0", 0.7), "tile_b": ("#d2c7b5", 0.75), "curb": ("#bdbab4", 0.8),
        "asphalt": ("#4a4c52", 0.9), "stripe": ("#f4f4f0", 0.7),
        "wall": ("#f4efe4", 0.8), "wall_accent": ("#c98e5a", 0.6), "roof": ("#5a6170", 0.6),
        "sign": ("#2b5fb3", 0.5), "sign_line": ("#ffffff", 0.5), "pillar": ("#9aa0aa", 0.5),
        "frame": ("#3a3f4a", 0.4), "metal": ("#8e959e", 0.4), "dark": ("#2a2a30", 0.4),
        "clock_face": ("#ffffff", 0.4),
        "taxi": ("#ffc93a", 0.35), "tire": ("#1e1e22", 0.8), "car_glass": ("#2d3e5a", 0.15), "lamp_red": ("#e0402f", 0.4),
        "bus_sign": ("#1f8a46", 0.5), "bench": ("#a8683a", 0.55),
        "vending": ("#d9352b", 0.4), "can_a": ("#4f7fd9", 0.5), "can_b": ("#f2c04a", 0.5), "can_c": ("#4fb36a", 0.5),
        "planter": ("#b9b2a6", 0.8), "soil": ("#6b4428", 0.95), "bark": ("#6b4428", 0.9),
        "leaf": ("#3f9a3a", 0.7), "leaf2": ("#5cb848", 0.7), "leaf3": ("#2f7d33", 0.7),
        "flower_pink": ("#ff8fb3", 0.6), "flower_yellow": ("#ffd84a", 0.6), "flower_white": ("#fffaf0", 0.6),
        "bike": ("#3a7bd5", 0.4),
        "skin": ("#f6caa6", 0.55), "eye": ("#2a211c", 0.3),
        "hair_brown": ("#6b4428", 0.6), "hair_black": ("#2a1f1a", 0.6),
        "coat_beige": ("#d9b98a", 0.8), "skirt_green": ("#4f7d5a", 0.8), "shoe_brown": ("#6b4428", 0.5),
        "suit": ("#3d4a63", 0.7), "shirt_white": ("#f7f7f2", 0.7), "shoe_black": ("#222226", 0.5),
        "suitcase": ("#e8706a", 0.45),
    }))
    M["glass"] = material("glass", "#bfe3ff", 0.15, emit=0.35)
    M["shelter_glass"] = material("shelter_glass", "#d8efff", 0.1)
    M["lamp_glass"] = material("lamp_glass", "#ffe7a8", 0.2, emit=4.0)
    M["vending_glow"] = material("vending_glow", "#fff6dc", 0.2, emit=1.2)


def build_ground(root):
    p = Part("ground")
    p.slab(SIZE, 0.0, 0.2, 0.8, M["curb"])
    p.slab(SIZE - 0.08, -0.2, 0.7, 0.76, M["base"])
    p.slab(SIZE - 0.4, -0.9, 0.18, 0.6, M["base_dark"])
    # 広場のタイル（2 色の市松）
    n = 13
    step = (SIZE - 0.6) / n
    for i in range(n):
        for j in range(n):
            x = -HALF + 0.3 + step * (i + 0.5)
            y = -HALF + 0.3 + step * (j + 0.5)
            if y < PLAZA_Y0 + step / 2:
                continue
            p.box((step - 0.03, step - 0.03, 0.03), (x, y, 0.015), M["tile_a"] if (i + j) % 2 else M["tile_b"], bevel=0.005, segments=1)
    p.finish(root)


def build_road(root):
    p = Part("road")
    p.box((SIZE - 0.5, 1.4, 0.02), (0, ROAD_Y, 0.01), M["asphalt"])
    p.box((SIZE - 0.5, 0.14, 0.1), (0, PLAZA_Y0 - 0.12, 0.05), M["curb"], bevel=0.02)
    # 横断歩道
    for k in range(7):
        p.box((0.28, 1.1, 0.012), (-0.2 + (k - 3) * 0.52, ROAD_Y, 0.026), M["stripe"])
    # 道路の中央線（横断歩道の外側だけ）
    for x in (2.0, 2.9):
        p.box((0.5, 0.06, 0.012), (x, ROAD_Y, 0.026), M["stripe"])
    p.finish(root)


def build_station(root):
    p = Part("station_building")
    y0 = 2.2          # 建物の正面
    depth = HALF - 0.25 - y0
    cy = y0 + depth / 2
    # 左右の低い棟と、真ん中の時計台
    p.box((7.2, depth, 2.4), (0, cy, 1.2), M["wall"])
    p.box((7.4, depth + 0.2, 0.18), (0, cy, 2.49), M["roof"], bevel=0.03)
    p.box((2.0, depth + 0.1, 3.3), (0, cy + 0.05, 1.65), M["wall"])
    p.box((2.2, depth + 0.3, 0.2), (0, cy + 0.05, 3.4), M["roof"], bevel=0.03)
    p.cyl(1.25, 0.2, 0.55, (0, cy + 0.05, 3.77), M["roof"], segs=4, rot=(0, 0, math.pi / 4), smooth=False)
    p.box((7.2, 0.06, 0.2), (0, y0 - 0.03, 0.1), M["wall_accent"])
    # 駅の看板（青い帯に白い線）
    p.box((5.6, 0.1, 0.5), (0, y0 - 0.05, 2.05), M["sign"], bevel=0.02)
    p.box((4.4, 0.02, 0.06), (0, y0 - 0.11, 2.05), M["sign_line"])
    for x in (-2.4, 2.4):
        p.box((0.36, 0.02, 0.36), (x, y0 - 0.11, 2.05), M["sign_line"], bevel=0.04)
    # 時計
    p.cyl(0.5, 0.5, 0.08, (0, y0 - 0.04, 2.85), M["dark"], rot=(math.pi / 2, 0, 0), segs=36, smooth=False)
    p.cyl(0.44, 0.44, 0.09, (0, y0 - 0.05, 2.85), M["clock_face"], rot=(math.pi / 2, 0, 0), segs=36, smooth=False)
    p.box((0.04, 0.02, 0.3), (0, y0 - 0.11, 2.98), M["dark"])
    p.box((0.05, 0.02, 0.22), (0.08, y0 - 0.11, 2.8), M["dark"], rot=(0, -2.3, 0))
    # 入口（ガラスの扉）とひさし
    p.box((1.6, 0.06, 1.5), (0, y0 - 0.02, 0.8), M["glass"])
    for x in (-0.8, 0, 0.8):
        p.box((0.06, 0.1, 1.55), (x, y0 - 0.04, 0.8), M["frame"])
    p.box((1.66, 0.1, 0.06), (0, y0 - 0.04, 1.56), M["frame"])
    p.box((2.6, 1.1, 0.1), (0, y0 - 0.55, 1.75), M["roof"], bevel=0.02)
    for x in (-1.15, 1.15):
        p.cyl(0.05, 0.05, 1.7, (x, y0 - 1.0, 0.85), M["pillar"], segs=10)
    # 左右の棟の窓
    for x in (-3.0, -2.1, 2.1, 3.0):
        p.box((0.6, 0.06, 0.8), (x, y0 - 0.02, 1.05), M["glass"])
        p.box((0.68, 0.1, 0.06), (x, y0 - 0.04, 0.62), M["frame"])
        p.box((0.06, 0.1, 0.86), (x, y0 - 0.04, 1.05), M["frame"])
    p.finish(root)


def build_plaza_clock(root, loc):
    p = Part("plaza_clock")
    p.cyl(0.18, 0.14, 0.2, (0, 0, 0.1), M["frame"], segs=16)
    p.cyl(0.06, 0.06, 2.4, (0, 0, 1.3), M["frame"], segs=12)
    p.cyl(0.3, 0.3, 0.16, (0, 0, 2.7), M["frame"], rot=(math.pi / 2, 0, 0), segs=32, smooth=False)
    for side in (-1, 1):
        p.cyl(0.26, 0.26, 0.02, (0, side * 0.08, 2.7), M["clock_face"], rot=(math.pi / 2, 0, 0), segs=32, smooth=False)
        p.box((0.025, 0.01, 0.18), (0, side * 0.095, 2.77), M["dark"])
        p.box((0.03, 0.01, 0.13), (0.05, side * 0.095, 2.66), M["dark"], rot=(0, -2.0, 0))
    p.sphere(0.06, (0, 0, 2.86), M["frame"], segs=10)
    p.finish(root, loc=loc)


def build_bus_stop(root, loc):
    p = Part("bus_stop")
    # 屋根付きの待合所
    p.box((1.8, 0.7, 0.06), (0, 0.15, 2.1), M["roof"], bevel=0.02)
    for x in (-0.85, 0.85):
        p.cyl(0.035, 0.035, 2.08, (x, 0.45, 1.04), M["metal"], segs=8)
    p.box((1.7, 0.03, 1.5), (0, 0.48, 1.15), M["shelter_glass"])
    p.box((1.3, 0.38, 0.05), (0, 0.22, 0.45), M["bench"], bevel=0.015)
    for x in (-0.55, 0.55):
        p.box((0.05, 0.3, 0.43), (x, 0.22, 0.22), M["metal"])
    # バス停の標識
    p.cyl(0.03, 0.03, 2.2, (1.2, -0.25, 1.1), M["metal"], segs=8)
    p.cyl(0.24, 0.24, 0.04, (1.2, -0.25, 2.25), M["bus_sign"], rot=(math.pi / 2, 0, 0), segs=24, smooth=False)
    p.cyl(0.18, 0.18, 0.05, (1.2, -0.25, 2.25), M["sign_line"], rot=(math.pi / 2, 0, 0), segs=24, smooth=False)
    p.box((0.3, 0.04, 0.4), (1.2, -0.25, 1.5), M["sign_line"], bevel=0.01)
    p.finish(root, loc=loc)


def build_taxi(root, loc, rot_z):
    p = Part("taxi")
    p.box((0.86, 1.9, 0.42), (0, 0, 0.42), M["taxi"], bevel=0.1)
    p.box((0.78, 1.0, 0.4), (0, 0.1, 0.78), M["taxi"], bevel=0.08)
    p.box((0.8, 0.9, 0.3), (0, 0.1, 0.8), M["car_glass"], bevel=0.05)
    p.box((0.3, 0.14, 0.12), (0, 0.15, 1.04), M["sign_line"], bevel=0.03)
    for sx in (-1, 1):
        for sy in (-0.62, 0.62):
            p.cyl(0.18, 0.18, 0.14, (sx * 0.42, sy, 0.19), M["tire"], rot=(0, math.pi / 2, 0), segs=18, smooth=False)
            p.cyl(0.09, 0.09, 0.15, (sx * 0.42, sy, 0.19), M["metal"], rot=(0, math.pi / 2, 0), segs=12, smooth=False)
        p.box((0.14, 0.04, 0.08), (sx * 0.28, -0.95, 0.48), M["lamp_glass"], bevel=0.02)
        p.box((0.14, 0.04, 0.08), (sx * 0.28, 0.95, 0.48), M["lamp_red"], bevel=0.02)
    p.finish(root, loc=loc, rot_z=rot_z)


def build_vending(root, loc, rot_z):
    p = Part("vending_machine")
    p.box((0.9, 0.7, 1.8), (0, 0, 0.9), M["vending"], bevel=0.03)
    p.box((0.76, 0.04, 0.9), (0, -0.35, 1.2), M["vending_glow"])
    for row, z in enumerate((1.5, 1.22, 0.94)):
        for k in range(5):
            p.cyl(0.04, 0.04, 0.14, (-0.28 + k * 0.14, -0.37, z), M[["can_a", "can_b", "can_c"][(row + k) % 3]], segs=10)
    p.box((0.6, 0.06, 0.14), (0, -0.36, 0.4), M["dark"], bevel=0.02)
    p.finish(root, loc=loc, rot_z=rot_z)


def build_planter_tree(root, name, loc):
    p = Part(name)
    p.cyl(0.55, 0.55, 0.45, (0, 0, 0.225), M["planter"], segs=24)
    p.cyl(0.48, 0.48, 0.04, (0, 0, 0.44), M["soil"], segs=24)
    p.cyl(0.11, 0.08, 1.3, (0, 0, 1.05), M["bark"], segs=10)
    for i, (x, y, z, r) in enumerate([(0, 0, 2.0, 0.65), (0.4, 0.1, 1.75, 0.45), (-0.38, -0.1, 1.8, 0.48), (0.05, 0.05, 2.45, 0.42)]):
        p.blob(r, (x, y, z), [M["leaf"], M["leaf2"], M["leaf3"]][i % 3], bumpy=0.18, subdiv=3, seed=i * 2.1 + loc[0])
    p.finish(root, loc=loc)


def build_flower_bed(root, name, loc, w=1.4, d=0.5):
    p = Part(name)
    p.box((w, d, 0.3), (0, 0, 0.15), M["planter"], bevel=0.03)
    p.box((w - 0.1, d - 0.1, 0.04), (0, 0, 0.3), M["soil"])
    colors = [M["flower_pink"], M["flower_yellow"], M["flower_white"]]
    for _ in range(int(w * 14)):
        x, y = rng.uniform(-w / 2 + 0.1, w / 2 - 0.1), rng.uniform(-d / 2 + 0.08, d / 2 - 0.08)
        p.blob(0.06, (x, y, 0.36), M["leaf2"], scale=(1, 1, 0.6), bumpy=0.3, subdiv=1, seed=rng.random() * 9)
        p.blob(0.04, (x, y, 0.42), rng.choice(colors), scale=(1, 1, 0.7), bumpy=0.3, subdiv=1, seed=rng.random() * 9)
    p.finish(root, loc=loc)


def build_lamp(root, name, loc):
    p = Part(name)
    p.cyl(0.14, 0.11, 0.14, (0, 0, 0.07), M["frame"], segs=16)
    p.cyl(0.045, 0.035, 2.8, (0, 0, 1.5), M["frame"], segs=12)
    p.cyl(0.12, 0.16, 0.3, (0, 0, 3.02), M["lamp_glass"], segs=6, smooth=False)
    p.cyl(0.22, 0.03, 0.2, (0, 0, 3.27), M["frame"], segs=6, smooth=False)
    p.finish(root, loc=loc)


def build_bicycle(root, loc, rot_z):
    p = Part("bicycle")
    for y in (-0.5, 0.5):
        p.cyl(0.33, 0.33, 0.04, (0, y, 0.34), M["tire"], rot=(0, math.pi / 2, 0), segs=28, smooth=False)
        p.cyl(0.27, 0.27, 0.045, (0, y, 0.34), M["metal"], rot=(0, math.pi / 2, 0), segs=28, smooth=False)
        p.cyl(0.04, 0.04, 0.06, (0, y, 0.34), M["frame"], rot=(0, math.pi / 2, 0), segs=10)
    joints = {"rear": (0, 0.5, 0.34), "front": (0, -0.5, 0.34), "pedal": (0, 0.05, 0.3),
              "seat": (0, 0.18, 0.82), "head": (0, -0.38, 0.85)}
    for a, b in [("rear", "pedal"), ("pedal", "seat"), ("seat", "rear"), ("pedal", "head"), ("seat", "head"), ("head", "front")]:
        p.limb(joints[a], joints[b], 0.025, 0.025, M["bike"], segs=8)
    p.box((0.12, 0.24, 0.05), (0, 0.2, 0.86), M["dark"], bevel=0.02)
    p.limb((-0.25, -0.4, 0.98), (0.25, -0.4, 0.98), 0.02, 0.02, M["frame"], segs=8)
    p.limb(joints["head"], (0, -0.4, 0.98), 0.022, 0.022, M["frame"], segs=8)
    p.box((0.3, 0.22, 0.18), (0, -0.62, 0.85), M["metal"], bevel=0.02)   # 前かご
    p.finish(root, loc=loc, rot_z=rot_z)


def build_suitcase(root, loc, rot_z):
    p = Part("suitcase")
    p.box((0.4, 0.24, 0.55), (0, 0, 0.33), M["suitcase"], bevel=0.05)
    for sx in (-1, 1):
        p.limb((sx * 0.1, -0.08, 0.6), (sx * 0.1, -0.08, 1.0), 0.012, 0.012, M["metal"], segs=6)
        p.cyl(0.035, 0.035, 0.04, (sx * 0.15, 0.08, 0.04), M["tire"], rot=(0, math.pi / 2, 0), segs=10)
    p.box((0.26, 0.04, 0.04), (0, -0.08, 1.0), M["dark"], bevel=0.015)
    p.finish(root, loc=loc, rot_z=rot_z)


def build_station_scene() -> bpy.types.Object:
    root = bpy.data.objects.new("station", None)
    bpy.context.scene.collection.objects.link(root)
    build_ground(root)
    build_road(root)
    build_station(root)
    build_plaza_clock(root, (-1.35, -1.05))
    build_bus_stop(root, (2.4, -1.65))
    build_taxi(root, (-2.75, ROAD_Y + 0.25), math.pi / 2)
    build_vending(root, (3.3, 1.6), 0.0)
    build_planter_tree(root, "tree_left", (-3.1, 1.2))
    build_planter_tree(root, "tree_right", (3.2, 0.2))
    build_flower_bed(root, "flowers_left", (-1.6, 1.35))
    build_flower_bed(root, "flowers_right", (1.6, 1.35))
    build_lamp(root, "lamp_left", (-3.3, -1.9))
    build_lamp(root, "lamp_right", (0.6, -1.95))
    build_bicycle(root, (-2.9, -1.2), 0.25)

    # 駅から出てきて、スーツケースを引いて歩く女性
    traveler = {"skin": M["skin"], "hair": M["hair_brown"], "top": M["coat_beige"], "bottom": M["skirt_green"],
                "shoe": M["shoe_brown"], "eye": M["eye"], "skirt": True, "hair_style": "long"}
    person(root, "traveler", (-0.2, 0.2), 0.15, traveler, pose="walk")
    build_suitcase(root, (0.1, 0.55), 0.15)
    # バス停でスマホを見ている男性
    commuter = {"skin": M["skin"], "hair": M["hair_black"], "top": M["suit"], "bottom": M["suit"],
                "shoe": M["shoe_black"], "eye": M["eye"]}
    person(root, "commuter", (1.65, -1.75), 0.4, commuter, pose="phone")
    return root


def build():
    make_materials()
    return build_station_scene()


run("station", build, lens=40)
