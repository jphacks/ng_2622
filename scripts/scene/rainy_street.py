"""雨の日のバス停のジオラマ（3D シーン）を作り、アプリ用の USDZ と発表用の画像を書き出す。

奥にパン屋と花屋、真ん中に歩道とバス停、手前に水たまりのある道路。難易度は「ふつう」。共通の道具は common.py。

使い方:
  blender --background --factory-startup --python scripts/scene/rainy_street.py -- [--out assets/scenes] [--no-render] [--samples 128]
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HALF, SIZE, Part, material, materials, person, run  # noqa: E402

rng = random.Random(31)
M: dict = {}

ROAD_Y0, ROAD_Y1 = -HALF + 0.3, -0.95   # 道路の手前と奥の端
CURB_Y = -0.88                          # 歩道の縁石
SHOP_Y = 1.85                           # 店の正面
NEAR_LANE = -1.6                        # 歩道側の車線の中心


def make_materials() -> None:
    M.update(materials({
        "base": ("#9da3ab", 0.85), "base_dark": ("#6a7079", 0.9), "curb": ("#b4b8bf", 0.6),
        "tile_a": ("#a7adb5", 0.3), "tile_b": ("#99a0a9", 0.32),       # 濡れた歩道
        "asphalt": ("#3b3e45", 0.32), "stripe": ("#e9e9e4", 0.4), "manhole": ("#55585e", 0.5),
        "bakery_wall": ("#efcf9e", 0.8), "flower_wall": ("#6fa3b3", 0.8), "trim": ("#f2efe8", 0.6), "roof_top": ("#7d838c", 0.7),
        "roof": ("#5a6170", 0.6), "frame": ("#4a3a30", 0.5), "door": ("#7a4a2e", 0.5),
        "awning_red": ("#d8473f", 0.7), "awning_white": ("#f7f2e8", 0.7), "awning_green": ("#3f8f5a", 0.7),
        "sign_board": ("#6b4428", 0.6), "sign_cream": ("#fff4dc", 0.6),
        "bread": ("#c98a45", 0.6), "bread_dark": ("#9a5f2c", 0.6), "shelf": ("#a8683a", 0.6),
        "bucket": ("#9aa3ad", 0.35), "pot": ("#d9784f", 0.7), "soil": ("#5a3a22", 0.95),
        "leaf": ("#3f9a3a", 0.6), "leaf2": ("#5cb848", 0.6),
        "flower_pink": ("#ff8fb3", 0.5), "flower_yellow": ("#ffd84a", 0.5), "flower_white": ("#fffaf0", 0.5),
        "flower_purple": ("#b48cff", 0.5), "flower_red": ("#e8484a", 0.5),
        "metal": ("#8e959e", 0.35), "dark": ("#2a2a30", 0.4), "board": ("#2f4a3a", 0.85), "chalk": ("#f4f4ef", 0.9),
        "ac": ("#d9dade", 0.6), "tank": ("#b9c0c8", 0.5),
        "bus_sign": ("#1f8a46", 0.5), "white": ("#ffffff", 0.5), "bench": ("#a8683a", 0.5),
        "post": ("#d8352b", 0.3), "post_dark": ("#7a1f1a", 0.5),
        "tire": ("#1e1e22", 0.7), "car_glass": ("#26344a", 0.08), "plate": ("#f4f4ef", 0.5),
        "cat": ("#8a8f99", 0.8), "cat_white": ("#f4f1ea", 0.8), "cat_pink": ("#f2a0a8", 0.6),
        "skin": ("#f6caa6", 0.55), "eye": ("#2a211c", 0.3), "cheek": ("#f59a9a", 0.7), "mouth": ("#a8463d", 0.5),
        "hair_brown": ("#5a3a22", 0.6), "hair_black": ("#2a1f1a", 0.6), "hair_gray": ("#c9c9c9", 0.6),
        "coat_cream": ("#efe3cf", 0.8), "jeans": ("#3d5a8a", 0.8), "shoe_brown": ("#6b4428", 0.5),
        "hoodie": ("#f29bb5", 0.8), "shoe_white": ("#f2f2f2", 0.5), "bag_navy": ("#2f3b63", 0.5),
        "raincoat": ("#ffcf2e", 0.25), "boots": ("#3f9a5a", 0.3), "pants_navy": ("#2f3b63", 0.7),
        "cardigan": ("#7a6a5a", 0.8), "slacks": ("#5a5f68", 0.7), "shoe_black": ("#222226", 0.5),
        "paper": ("#f2efe6", 0.8), "handbag": ("#b0563a", 0.5),
    }))
    M["car"] = material("car", "#d0342c", 0.25, coat=0.8)
    M["umbrella"] = material("umbrella", "#3f7fe0", 0.3, coat=0.5)
    M["umbrella_inner"] = material("umbrella_inner", "#2f63b8", 0.4)
    M["puddle"] = material("puddle", "#34404f", 0.02, coat=1.0)
    M["splash"] = material("splash", "#cfe6ff", 0.0, trans=0.55, ior=1.33, alpha=0.8)
    M["rain"] = material("rain", "#c9d9ec", 0.15, trans=0.4, alpha=0.6)
    M["ripple"] = material("ripple", "#a9b8ca", 0.05)
    M["window_warm"] = material("window_warm", "#ffc56e", 0.3, emit=3.0)
    M["window_dim"] = material("window_dim", "#9fb3c8", 0.15, emit=0.25)
    M["shelter_glass"] = material("shelter_glass", "#d8efff", 0.05, trans=0.8, alpha=0.35)
    M["lamp_glass"] = material("lamp_glass", "#ffd98a", 0.2, emit=12.0)
    M["headlight"] = material("headlight", "#fff6dc", 0.2, emit=5.0)
    M["taillight"] = material("taillight", "#ff3a2e", 0.3, emit=3.0)


# ---------- 地面と道路 ----------

def build_ground(root):
    p = Part("ground")
    p.slab(SIZE, 0.0, 0.2, 0.8, M["curb"])
    p.slab(SIZE - 0.08, -0.2, 0.7, 0.76, M["base"])
    p.slab(SIZE - 0.4, -0.9, 0.18, 0.6, M["base_dark"])
    # 歩道のタイル（縁石から店の前まで）
    n = 14
    step = (SIZE - 0.6) / n
    for i in range(n):
        for j in range(n):
            x, y = -HALF + 0.3 + step * (i + 0.5), -HALF + 0.3 + step * (j + 0.5)
            if y < CURB_Y + step / 2:
                continue
            p.box((step - 0.03, step - 0.03, 0.03), (x, y, 0.015), M["tile_a"] if (i + j) % 2 else M["tile_b"], bevel=0.005, segments=1)
    p.finish(root)


def build_road(root):
    p = Part("road")
    cy = (ROAD_Y0 + ROAD_Y1) / 2
    p.box((SIZE - 0.5, ROAD_Y1 - ROAD_Y0, 0.02), (0, cy, 0.01), M["asphalt"])
    p.box((SIZE - 0.5, 0.14, 0.12), (0, CURB_Y, 0.06), M["curb"], bevel=0.02)
    # 中央の破線と、端の白線
    for k in range(6):
        p.box((0.6, 0.07, 0.012), (-3.2 + k * 1.3, cy, 0.026), M["stripe"])
    p.box((SIZE - 0.6, 0.05, 0.012), (0, ROAD_Y1 - 0.12, 0.026), M["stripe"])
    p.cyl(0.22, 0.22, 0.012, (2.6, cy - 0.5, 0.026), M["manhole"], segs=24, smooth=False)
    p.finish(root)


def build_puddles(root):
    """水たまり（車がはねている大きいものと、男の子が跳んでいるもの、小さいもの）。"""
    p = Part("puddles")
    spots = [(0.15, -1.3, 0.75, 0.42, 0.03), (-2.1, -0.15, 0.55, 0.42, 0.04), (-3.0, -2.6, 0.4, 0.25, 0.03),
             (2.0, -2.9, 0.45, 0.22, 0.03), (3.1, 1.3, 0.3, 0.2, 0.04)]
    for i, (x, y, rx, ry, z) in enumerate(spots):
        p.blob(1.0, (x, y, z), M["puddle"], scale=(rx, ry, 0.012), bumpy=0.25, subdiv=3, seed=i * 3.3)
    p.finish(root)
    # 水たまりに落ちる雨の波紋（小さな輪）
    r = Part("ripples")
    for (x, y, rx, ry, z) in spots:
        for _ in range(int(rx * ry * 12) + 1):
            a, d = rng.random() * math.tau, rng.random() * 0.75
            cx, cy = x + math.cos(a) * rx * d, y + math.sin(a) * ry * d
            rr = rng.uniform(0.04, 0.09)
            for k in range(10):
                t = k / 10 * math.tau
                r.sphere(0.006, (cx + math.cos(t) * rr, cy + math.sin(t) * rr, z + 0.013), M["ripple"], scale=(1, 1, 0.4), segs=6)
    r.finish(root)


# ---------- 店 ----------

def awning(p, x0, x1, y, z, depth, colors, stripes):
    """店の前に張り出す、しまのひさし。端は波形のたれ。"""
    w = (x1 - x0) / stripes
    tilt = 0.42
    for k in range(stripes):
        cx = x0 + w * (k + 0.5)
        mat = colors[k % len(colors)]
        p.box((w + 0.005, depth, 0.035), (cx, y - depth / 2 * math.cos(tilt), z - depth / 2 * math.sin(tilt)), mat, rot=(tilt, 0, 0))
        p.cyl(w / 2, w / 2, 0.035, (cx, y - depth * math.cos(tilt), z - depth * math.sin(tilt) - 0.02), mat,
              rot=(math.pi / 2, 0, 0), segs=12, smooth=False)
    for x in (x0 + 0.03, x1 - 0.03):
        p.limb((x, y, z - 0.02), (x, y - depth * math.cos(tilt), z - depth * math.sin(tilt)), 0.012, 0.012, M["dark"], segs=6)


def build_bakery(root):
    """パン屋。赤と白のしまのひさしと、明かりのついたショーウィンドウ。"""
    p = Part("bakery")
    x0, x1, h = -HALF + 0.25, -0.15, 3.7
    cx, w = (x0 + x1) / 2, x1 - x0
    depth = HALF - 0.25 - SHOP_Y
    cy = SHOP_Y + depth / 2
    p.box((w, depth, h), (cx, cy, h / 2), M["bakery_wall"])
    p.box((w + 0.1, depth + 0.1, 0.16), (cx, cy, h + 0.08), M["trim"], bevel=0.02)
    p.box((w - 0.2, depth - 0.2, 0.03), (cx, cy, h + 0.17), M["roof_top"])
    p.box((w, 0.08, 0.25), (cx, SHOP_Y - 0.04, 0.125), M["frame"])
    # ショーウィンドウ（中に棚とパン）
    wx0, wx1 = x0 + 0.35, -1.45
    wcx, ww = (wx0 + wx1) / 2, wx1 - wx0
    p.box((ww, 0.04, 1.1), (wcx, SHOP_Y - 0.005, 0.95), M["window_warm"])
    for z in (0.6, 0.98):
        p.box((ww - 0.1, 0.22, 0.03), (wcx, SHOP_Y - 0.12, z), M["shelf"])
        x = wx0 + 0.18
        while x < wx1 - 0.15:
            kind = rng.random()
            if kind < 0.4:   # 食パン
                p.box((0.2, 0.13, 0.13), (x, SHOP_Y - 0.12, z + 0.08), M["bread"], bevel=0.04)
            elif kind < 0.75:  # バゲット
                p.cyl(0.04, 0.04, 0.24, (x, SHOP_Y - 0.12, z + 0.05), M["bread_dark"], rot=(0, math.pi / 2, 0.3), segs=10)
            else:            # 丸いパン
                p.sphere(0.07, (x, SHOP_Y - 0.12, z + 0.06), M["bread"], scale=(1, 1, 0.7), segs=12)
            x += rng.uniform(0.24, 0.3)
    for x in (wx0, wx1, wcx):
        p.box((0.06, 0.08, 1.16), (x, SHOP_Y - 0.03, 0.95), M["frame"])
    p.box((ww + 0.06, 0.08, 0.06), (wcx, SHOP_Y - 0.03, 1.52), M["frame"])
    p.box((ww + 0.16, 0.22, 0.06), (wcx, SHOP_Y - 0.1, 0.38), M["frame"])  # 窓台（猫が座る）
    # 扉
    p.box((0.8, 0.06, 1.65), (-0.8, SHOP_Y - 0.01, 0.85), M["door"], bevel=0.01)
    p.box((0.5, 0.02, 0.8), (-0.8, SHOP_Y - 0.05, 1.15), M["window_warm"])
    p.sphere(0.035, (-0.5, SHOP_Y - 0.08, 0.85), M["metal"], segs=10)
    # ひさしと看板
    awning(p, x0 + 0.1, x1 - 0.1, SHOP_Y - 0.02, 2.02, 0.95, [M["awning_red"], M["awning_white"]], 12)
    p.box((2.4, 0.1, 0.45), (cx, SHOP_Y - 0.05, 2.45), M["sign_board"], bevel=0.03)
    p.box((2.2, 0.02, 0.33), (cx, SHOP_Y - 0.11, 2.45), M["sign_cream"], bevel=0.01)
    p.sphere(0.13, (cx - 0.75, SHOP_Y - 0.12, 2.45), M["bread"], scale=(1.3, 0.4, 0.8), segs=12)   # 看板のパンの絵
    for k in range(5):
        p.box((0.16, 0.01, 0.06), (cx - 0.35 + k * 0.28, SHOP_Y - 0.125, 2.45), M["sign_board"])
    p.finish(root)
    build_upper_windows(root, "bakery_windows", [(x0 + 0.75, True), (x1 - 0.9, False)], 3.15)
    # 屋上の室外機
    q = Part("bakery_roof")
    q.box((0.6, 0.4, 0.45), (x0 + 0.7, cy + 0.4, h + 0.38), M["ac"], bevel=0.03)
    q.cyl(0.15, 0.15, 0.02, (x0 + 0.7, cy + 0.19, h + 0.38), M["dark"], rot=(math.pi / 2, 0, 0), segs=16)
    q.finish(root)


def build_upper_windows(root, name, windows, z):
    p = Part(name)
    for x, lit in windows:
        p.box((0.75, 0.04, 0.6), (x, SHOP_Y - 0.01, z), M["window_warm"] if lit else M["window_dim"])
        p.box((0.85, 0.08, 0.06), (x, SHOP_Y - 0.03, z + 0.33), M["trim"])
        p.box((0.85, 0.16, 0.06), (x, SHOP_Y - 0.06, z - 0.33), M["trim"])
        p.box((0.05, 0.08, 0.6), (x, SHOP_Y - 0.03, z), M["trim"])
        # 窓辺の植木鉢
        p.box((0.7, 0.16, 0.12), (x, SHOP_Y - 0.12, z - 0.25), M["pot"], bevel=0.02)
        for k in range(5):
            p.blob(0.07, (x - 0.28 + k * 0.14, SHOP_Y - 0.12, z - 0.15), M["leaf2"], bumpy=0.3, subdiv=1, seed=k + x)
            p.sphere(0.035, (x - 0.28 + k * 0.14, SHOP_Y - 0.17, z - 0.1), M["flower_red"] if k % 2 else M["flower_pink"], segs=8)
    p.finish(root)


def build_flower_shop(root):
    """花屋。緑のひさしと、店先のバケツの花。"""
    p = Part("flower_shop")
    x0, x1, h = 0.0, HALF - 0.25, 4.1
    cx, w = (x0 + x1) / 2, x1 - x0
    depth = HALF - 0.25 - SHOP_Y
    cy = SHOP_Y + depth / 2
    p.box((w, depth, h), (cx, cy, h / 2), M["flower_wall"])
    p.box((w + 0.1, depth + 0.1, 0.16), (cx, cy, h + 0.08), M["trim"], bevel=0.02)
    p.box((w - 0.2, depth - 0.2, 0.03), (cx, cy, h + 0.17), M["roof_top"])
    p.box((w, 0.08, 0.25), (cx, SHOP_Y - 0.04, 0.125), M["trim"])
    p.box((2.2, 0.04, 1.3), (cx + 0.45, SHOP_Y - 0.005, 1.0), M["window_warm"])
    for x in (cx - 0.65, cx + 0.45, cx + 1.55):
        p.box((0.06, 0.08, 1.36), (x, SHOP_Y - 0.03, 1.0), M["trim"])
    p.box((2.26, 0.08, 0.06), (cx + 0.45, SHOP_Y - 0.03, 1.66), M["trim"])
    p.box((0.75, 0.06, 1.7), (x0 + 0.55, SHOP_Y - 0.01, 0.85), M["trim"], bevel=0.01)
    p.box((0.55, 0.02, 1.4), (x0 + 0.55, SHOP_Y - 0.05, 0.9), M["window_dim"])
    awning(p, x0 + 0.1, x1 - 0.1, SHOP_Y - 0.02, 2.15, 0.85, [M["awning_green"], M["awning_white"]], 11)
    p.box((2.0, 0.1, 0.42), (cx, SHOP_Y - 0.05, 2.6), M["awning_green"], bevel=0.03)
    p.box((1.8, 0.02, 0.3), (cx, SHOP_Y - 0.11, 2.6), M["trim"], bevel=0.01)
    for k in range(4):
        p.sphere(0.07, (cx - 0.45 + k * 0.3, SHOP_Y - 0.13, 2.6), [M["flower_pink"], M["flower_yellow"], M["flower_purple"], M["flower_red"]][k], segs=10)
    p.finish(root)
    build_upper_windows(root, "flower_shop_windows", [(x0 + 0.9, False), (x1 - 0.9, True)], 3.4)
    q = Part("flower_shop_roof")
    q.cyl(0.35, 0.35, 0.6, (x1 - 0.7, cy + 0.3, h + 0.46), M["tank"], segs=20)
    q.cyl(0.36, 0.3, 0.12, (x1 - 0.7, cy + 0.3, h + 0.82), M["tank"], segs=20)
    for sx in (-1, 1):
        q.box((0.05, 0.05, 0.3), (x1 - 0.7 + sx * 0.25, cy + 0.3, h + 0.15), M["metal"])
    q.finish(root)


def build_flower_stand(root, loc):
    """花屋の店先の、バケツに入った花の台。"""
    p = Part("flower_stand")
    p.box((1.3, 0.5, 0.05), (0, 0, 0.45), M["shelf"], bevel=0.01)
    p.box((1.3, 0.3, 0.05), (0, 0.1, 0.75), M["shelf"], bevel=0.01)
    for sx in (-1, 1):
        p.box((0.05, 0.5, 0.75), (sx * 0.62, 0.0, 0.375), M["shelf"])
    colors = [M["flower_pink"], M["flower_yellow"], M["flower_white"], M["flower_purple"], M["flower_red"]]
    for row, (y, z) in enumerate([(-0.1, 0.47), (0.1, 0.77)]):
        for k in range(4):
            x = -0.45 + k * 0.3
            p.cyl(0.11, 0.09, 0.2, (x, y, z + 0.1), M["bucket"], segs=14)
            c = colors[(k + row * 2) % len(colors)]
            for _ in range(6):
                fx, fy = x + rng.uniform(-0.07, 0.07), y + rng.uniform(-0.07, 0.07)
                fz = z + rng.uniform(0.32, 0.42)
                p.limb((x, y, z + 0.15), (fx, fy, fz), 0.008, 0.008, M["leaf"], segs=4)
                p.blob(0.045, (fx, fy, fz), c, bumpy=0.35, subdiv=1, seed=rng.random() * 9)
    p.finish(root, loc=loc)


def build_umbrella_stand(root, loc):
    p = Part("umbrella_stand")
    p.cyl(0.14, 0.12, 0.45, (0, 0, 0.225), M["metal"], segs=16)
    for k, mat in enumerate([M["awning_red"], M["umbrella"], M["raincoat"]]):
        a = k / 3 * math.tau
        top = (math.cos(a) * 0.1, math.sin(a) * 0.1, 0.95)
        p.limb((math.cos(a) * 0.04, math.sin(a) * 0.04, 0.05), top, 0.05, 0.012, mat, segs=8)
        p.cyl(0.012, 0.012, 0.12, (top[0], top[1], 1.0), M["dark"], segs=6)
    p.finish(root, loc=loc)


def build_a_board(root, loc, rot_z):
    """パン屋の前の立て看板（黒板）。"""
    p = Part("a_board")
    for sy in (-1, 1):
        p.box((0.5, 0.04, 0.75), (0, sy * 0.12, 0.38), M["shelf"], rot=(sy * 0.18, 0, 0), bevel=0.01)
        p.box((0.42, 0.02, 0.6), (0, sy * 0.145, 0.4), M["board"], rot=(sy * 0.18, 0, 0))
    for k in range(3):
        p.box((rng.uniform(0.15, 0.3), 0.01, 0.03), (0, -0.16, 0.55 - k * 0.12), M["chalk"], rot=(-0.18, 0, 0))
    p.finish(root, loc=loc, rot_z=rot_z)


# ---------- 歩道のもの ----------

def build_bus_shelter(root, loc):
    """屋根付きのバス停。ガラスの壁とベンチ、時刻表と標識。"""
    p = Part("bus_stop")
    w, d = 2.0, 0.8
    p.box((w + 0.1, d + 0.15, 0.07), (0, 0.05, 2.15), M["roof"], rot=(-0.05, 0, 0), bevel=0.02)
    for x in (-w / 2, w / 2):
        p.cyl(0.035, 0.035, 2.12, (x, d / 2, 1.06), M["metal"], segs=8)
    p.box((w, 0.03, 1.55), (0, d / 2, 1.2), M["shelter_glass"])
    p.box((0.03, d, 1.55), (w / 2, 0.02, 1.2), M["shelter_glass"])
    p.box((w, 0.05, 0.05), (0, d / 2, 0.42), M["metal"])
    p.box((1.5, 0.38, 0.05), (-0.1, 0.18, 0.45), M["bench"], bevel=0.015)
    for x in (-0.75, 0.55):
        p.box((0.05, 0.3, 0.43), (x, 0.2, 0.22), M["metal"])
    p.box((0.5, 0.02, 0.7), (0.65, d / 2 - 0.03, 1.3), M["white"])            # 時刻表
    for k in range(6):
        p.box((0.36, 0.01, 0.025), (0.65, d / 2 - 0.045, 1.55 - k * 0.09), M["dark"])
    # バス停の標識
    sx, sy = -w / 2 - 0.35, -0.3
    p.cyl(0.13, 0.15, 0.08, (sx, sy, 0.04), M["dark"], segs=16)
    p.cyl(0.03, 0.03, 2.2, (sx, sy, 1.1), M["metal"], segs=8)
    p.cyl(0.25, 0.25, 0.04, (sx, sy, 2.25), M["bus_sign"], rot=(math.pi / 2, 0, 0), segs=28, smooth=False)
    p.cyl(0.19, 0.19, 0.05, (sx, sy, 2.25), M["white"], rot=(math.pi / 2, 0, 0), segs=28, smooth=False)
    p.box((0.18, 0.06, 0.1), (sx, sy, 2.25), M["bus_sign"], bevel=0.02)   # バスの絵
    p.box((0.3, 0.04, 0.4), (sx, sy, 1.55), M["white"], bevel=0.01)
    p.finish(root, loc=loc)


def build_mailbox(root, loc):
    """赤い丸型のポスト。"""
    p = Part("mailbox")
    p.cyl(0.24, 0.24, 0.95, (0, 0, 0.6), M["post"], segs=28)
    p.sphere(0.25, (0, 0, 1.08), M["post"], scale=(1, 1, 0.5), segs=28)
    p.cyl(0.26, 0.26, 0.04, (0, 0, 1.06), M["post"], segs=28)
    p.cyl(0.14, 0.18, 0.13, (0, 0, 0.065), M["dark"], segs=16)
    p.box((0.22, 0.04, 0.035), (0, -0.235, 0.92), M["post_dark"], bevel=0.01)   # 投入口
    p.box((0.2, 0.03, 0.16), (0, -0.235, 0.62), M["white"], bevel=0.01)
    p.finish(root, loc=loc)


def build_lamp(root, loc):
    p = Part("street_lamp")
    p.cyl(0.14, 0.11, 0.14, (0, 0, 0.07), M["dark"], segs=16)
    p.cyl(0.045, 0.035, 2.9, (0, 0, 1.5), M["dark"], segs=12)
    p.limb((0, 0, 2.9), (0, -0.45, 3.05), 0.03, 0.03, M["dark"], segs=8)
    p.cyl(0.24, 0.05, 0.16, (0, -0.5, 3.02), M["dark"], segs=16)
    p.sphere(0.15, (0, -0.5, 2.94), M["lamp_glass"], scale=(1, 1, 0.5), segs=16)
    p.finish(root, loc=loc)


def build_car(root, loc, rot_z):
    """赤い小さな車。雨なのでライトをつけている。正面は -Y（置くときに回す）。"""
    p = Part("car")
    p.box((0.95, 2.0, 0.48), (0, 0, 0.45), M["car"], bevel=0.14)
    p.box((0.86, 1.15, 0.46), (0, 0.18, 0.86), M["car"], bevel=0.1)
    p.box((0.88, 1.2, 0.28), (0, 0.16, 0.88), M["car_glass"], bevel=0.06)
    for sx in (-1, 1):
        for sy in (-0.64, 0.66):
            p.cyl(0.2, 0.2, 0.16, (sx * 0.44, sy, 0.2), M["tire"], rot=(0, math.pi / 2, 0), segs=20)
            p.cyl(0.11, 0.11, 0.17, (sx * 0.44, sy, 0.2), M["metal"], rot=(0, math.pi / 2, 0), segs=14, smooth=False)
        p.box((0.2, 0.05, 0.1), (sx * 0.3, -1.0, 0.52), M["headlight"], bevel=0.03)
        p.box((0.16, 0.05, 0.1), (sx * 0.32, 1.0, 0.55), M["taillight"], bevel=0.03)
        p.box((0.1, 0.08, 0.07), (sx * 0.5, -0.38, 0.78), M["car"], bevel=0.02)   # ミラー
    p.box((0.32, 0.03, 0.1), (0, -1.01, 0.32), M["plate"], bevel=0.01)
    p.box((0.32, 0.03, 0.1), (0, 1.01, 0.34), M["plate"], bevel=0.01)
    p.box((0.7, 0.04, 0.06), (0, -1.0, 0.36), M["dark"], bevel=0.02)
    p.limb((-0.3, -0.42, 0.78), (0.1, -0.44, 0.84), 0.01, 0.01, M["dark"], segs=4)  # ワイパー
    p.finish(root, loc=loc, rot_z=rot_z)


def build_splash(root, origin, toward):
    """車のタイヤが水たまりの水をはね上げる。origin から toward（向きのベクトル）へ、弧を描いて飛ぶしぶき。"""
    p = Part("splash")
    o = Vector(origin)
    fwd = Vector((*toward, 0)).normalized()
    side = Vector((-fwd.y, fwd.x, 0))
    # しぶきの粒。放物線に沿って飛ぶ向きに少し伸ばし、根元は大きく密に、先は小さくまばらにする
    for _ in range(300):
        spread = rng.gauss(0, 0.3)
        d = rng.random() ** 0.7 * 0.95
        lift = rng.uniform(0.75, 1.1)
        dir2 = (fwd + side * spread).normalized()
        pos = o + dir2 * d + Vector((0, 0, 3.0 * d * (1 - d) * lift + 0.03))
        tangent = (dir2 + Vector((0, 0, 3.0 * (1 - 2 * d) * lift))).normalized()
        r = rng.uniform(0.012, 0.03) * (1.3 - d * 0.8)
        p.limb(tuple(pos - tangent * r * 1.5), tuple(pos + tangent * r * 2.5), r, r * 0.4, M["splash"], segs=8)
    # 根元の、タイヤから立ち上がる水の膜
    for k in range(5):
        t = (k - 2) / 2
        base = o + side * t * 0.25 + fwd * 0.1
        p.blob(0.11 - abs(t) * 0.03, tuple(base + Vector((0, 0, 0.1))), M["splash"],
               scale=(1, 0.5, 1.3), bumpy=0.4, subdiv=2, seed=k * 1.9)
    p.finish(root)


def build_rain(root):
    """降っている雨（少し斜めの細い線）。店の中と人の体には入れない。"""
    p = Part("rain")
    placed = 0
    while placed < 650:
        x, y, z = rng.uniform(-HALF + 0.15, HALF - 0.15), rng.uniform(-HALF + 0.15, HALF - 0.15), rng.uniform(0.15, 4.2)
        if y > SHOP_Y - 0.1 and z < 3.6:
            continue
        if 1.3 < x < 3.3 and -0.15 < y < 0.7 and z < 2.2:   # バス停の屋根の下
            continue
        length = rng.uniform(0.16, 0.28)
        p.limb((x, y, z), (x - 0.035, y + 0.02, z + length), 0.005, 0.005, M["rain"], segs=4)
        placed += 1
    p.finish(root)


def build_cat(root, loc, rot_z):
    """窓台で雨宿りしている猫（座っている）。"""
    p = Part("cat")
    p.sphere(0.16, (0, 0.04, 0.17), M["cat"], scale=(0.9, 1.1, 1.05))            # 胴
    p.sphere(0.1, (0, -0.06, 0.18), M["cat_white"], scale=(0.9, 0.7, 1.2))        # 胸
    p.sphere(0.12, (0, -0.06, 0.4), M["cat"], scale=(1.1, 1, 0.95))               # 頭
    p.sphere(0.055, (0, -0.16, 0.37), M["cat_white"], scale=(1.3, 0.8, 0.8), segs=12)
    p.sphere(0.014, (0, -0.2, 0.39), M["cat_pink"], segs=8)
    for sx in (-1, 1):
        p.cyl(0.05, 0.0, 0.1, (sx * 0.07, -0.04, 0.53), M["cat"], rot=(0, sx * 0.25, 0), segs=4, smooth=False)
        p.cyl(0.028, 0.0, 0.06, (sx * 0.07, -0.06, 0.52), M["cat_pink"], rot=(0, sx * 0.25, 0), segs=4, smooth=False)
        p.sphere(0.02, (sx * 0.045, -0.165, 0.43), M["eye"], segs=8)
        p.sphere(0.04, (sx * 0.06, -0.12, 0.03), M["cat_white"], scale=(1, 1.3, 0.7), segs=10)   # 前足
        p.limb((sx * 0.06, -0.08, 0.2), (sx * 0.06, -0.12, 0.04), 0.035, 0.03, M["cat"], segs=8)
    # 体に巻きつけたしっぽ
    for k in range(10):
        a = -0.2 + k / 9 * 2.4
        p.sphere(0.035, (math.cos(a) * 0.17, 0.08 - math.sin(a) * 0.17, 0.03), M["cat"] if k < 8 else M["cat_white"], segs=8)
    p.finish(root, loc=loc, rot_z=rot_z)


def build_umbrella(root, name, loc, rot_z, hand, top):
    """開いた傘。hand は持ち手、top は先の位置（人と同じ向きのローカル座標）。"""
    p = Part(name)
    hand, top = Vector(hand), Vector(top)
    axis = (top - hand).normalized()
    p.limb(hand - axis * 0.1, top + axis * 0.08, 0.012, 0.012, M["dark"], segs=6)
    p.limb(hand - axis * 0.1, hand - axis * 0.1 + Vector((0, -0.05, -0.04)), 0.016, 0.016, M["dark"], segs=6)
    # 8 枚の布（外は青、裏は濃い青）。先から骨に沿って下がる
    ribs = 8
    rot = axis.to_track_quat("Z", "Y")
    rim = [top + rot @ Vector((math.cos(k / ribs * math.tau) * 0.68, math.sin(k / ribs * math.tau) * 0.68, -0.3)) for k in range(ribs)]
    for k in range(ribs):
        a, b = rim[k], rim[(k + 1) % ribs]
        mid = (a + b) / 2 + rot @ Vector((0, 0, 0.05))
        p.poly((top, a, mid), M["umbrella"])
        p.poly((top, mid, b), M["umbrella"])
        under = rot @ Vector((0, 0, -0.012))   # 裏地は少し下に、下向きに張る
        p.poly((top + under, mid + under, a + under), M["umbrella_inner"])
        p.poly((top + under, b + under, mid + under), M["umbrella_inner"])
        p.sphere(0.016, tuple(a), M["dark"], segs=6)
    p.finish(root, loc=loc, rot_z=rot_z)


def build_bag(root, loc, rot_z, z, scale):
    """女の子が頭にのせている通学かばん。z と scale は女の子に合わせる。"""
    p = Part("girl_bag")
    p.box((0.46, 0.28, 0.09), (0, -0.04, z), M["bag_navy"], bevel=0.03)
    p.box((0.4, 0.02, 0.06), (0, -0.19, z - 0.01), M["metal"], bevel=0.01)
    p.limb((-0.12, -0.04, z + 0.05), (0.12, -0.04, z + 0.05), 0.015, 0.015, M["dark"], segs=6)
    p.finish(root, loc=loc, rot_z=rot_z, scale=scale)


def build_newspaper(root, loc, rot_z):
    p = Part("newspaper")
    for side in (-1, 1):
        p.box((0.25, 0.01, 0.34), (side * 0.12, -0.33, 0.95), M["paper"], rot=(0, 0, side * -0.25))
    for k in range(5):
        p.box((0.16, 0.012, 0.02), (-0.12, -0.335, 1.05 - k * 0.05), M["dark"], rot=(0, 0, 0.25))
    p.finish(root, loc=loc, rot_z=rot_z)


def build_rainy_street() -> bpy.types.Object:
    root = bpy.data.objects.new("rainy_street", None)
    bpy.context.scene.collection.objects.link(root)
    build_ground(root)
    build_road(root)
    build_puddles(root)
    build_bakery(root)
    build_flower_shop(root)
    build_flower_stand(root, (2.95, 1.4))
    build_umbrella_stand(root, (0.25, 1.5))
    build_a_board(root, (-0.4, 1.2), 0.3)
    build_bus_shelter(root, (2.25, -0.05))
    build_mailbox(root, (-3.35, 1.3))
    build_lamp(root, (-3.3, -0.62))

    # 水たまりを走り抜けて、歩道に水をはね上げる赤い車
    car = ((-0.65, NEAR_LANE), math.pi / 2)
    build_car(root, *car)
    build_splash(root, (0.0, -1.15, 0.0), (0.25, 1.0))

    # 傘をさして、左（バスの来るほう）を見てバスを待つ女性
    woman = {"skin": M["skin"], "hair": M["hair_brown"], "top": M["coat_cream"], "bottom": M["jeans"], "shoe": M["shoe_brown"],
             "eye": M["eye"], "cheek": M["cheek"], "mouth": M["mouth"], "hair_style": "long"}
    woman_at = ((0.95, -0.4), -0.25)
    person(root, "woman_umbrella", *woman_at, woman, hands=[(-0.27, 0.0, -0.5), (0.04, -0.22, -0.2)])
    build_umbrella(root, "umbrella", *woman_at, hand=(0.04, -0.22, 1.1), top=(0.12, 0.05, 2.35))
    q = Part("handbag")
    q.box((0.26, 0.1, 0.2), (-0.29, 0.0, 0.62), M["handbag"], bevel=0.03)
    q.limb((-0.29, 0.0, 0.73), (-0.27, 0.0, 0.79), 0.012, 0.012, M["dark"], segs=6)
    q.finish(root, loc=woman_at[0], rot_z=woman_at[1])

    # 傘がなく、かばんを頭にのせてバス停へ走る女の子
    girl = {"skin": M["skin"], "hair": M["hair_black"], "top": M["hoodie"], "bottom": M["jeans"], "shoe": M["shoe_white"],
            "eye": M["eye"], "cheek": M["cheek"], "mouth": M["mouth"], "hair_style": "bun"}
    girl_at = ((-0.25, -0.3), math.pi / 2 - 0.45)
    person(root, "girl_running", *girl_at, girl, pose="run", scale=0.9, hands=[(-0.2, -0.04, 0.44), (0.2, -0.04, 0.44)])
    build_bag(root, *girl_at, z=0.78 + 0.5 + 0.5, scale=0.9)   # 走るポーズの肩（0.78 + 0.5）の上、手の高さ

    # 黄色のレインコートで、水たまりに跳びこむ男の子
    boy = {"skin": M["skin"], "hair": M["raincoat"], "top": M["raincoat"], "bottom": M["pants_navy"], "shoe": M["boots"],
           "eye": M["eye"], "cheek": M["cheek"], "mouth": M["mouth"], "hair_style": "hood"}
    person(root, "boy_raincoat", (-2.1, -0.15), 0.35, boy, scale=0.75, lift=0.22, hands=[(-0.36, -0.06, 0.32), (0.36, -0.06, 0.32)])
    crown = Part("boy_splash")
    for k in range(26):
        a = k / 26 * math.tau
        d = rng.uniform(0.3, 0.5)
        crown.sphere(rng.uniform(0.02, 0.04), (-2.1 + math.cos(a) * d, -0.15 + math.sin(a) * d * 0.8, rng.uniform(0.08, 0.32)), M["splash"], segs=8)
        crown.limb((-2.1 + math.cos(a) * 0.2, -0.15 + math.sin(a) * 0.16, 0.04),
                   (-2.1 + math.cos(a) * 0.32, -0.15 + math.sin(a) * 0.26, 0.2), 0.025, 0.008, M["splash"], segs=6)
    crown.finish(root)

    # バス停のベンチで新聞を読むおじいさん
    grandpa = {"skin": M["skin"], "hair": M["hair_gray"], "top": M["cardigan"], "bottom": M["slacks"], "shoe": M["shoe_black"],
               "eye": M["eye"], "cheek": M["cheek"]}
    grandpa_at = ((2.05, 0.18), 0.0)
    person(root, "old_man_reading", *grandpa_at, grandpa, pose="sit", hands=[(-0.22, -0.3, -0.05), (0.22, -0.3, -0.05)])
    build_newspaper(root, *grandpa_at)

    # パン屋の窓台で雨宿りする猫
    build_cat(root, (-2.55, SHOP_Y - 0.12, 0.41), 0.25)

    build_rain(root)
    return root


def build():
    make_materials()
    return build_rainy_street()


# くもりの雨の日。太陽は弱く、背景は灰色がかった青
ENV = {"sun_elevation": 25, "sky_strength": 0.45, "sun_energy": 0.8, "sun_color": "#e3ebf5",
       "bg_strength": 1.6, "bg_edge": "#6f7b8c", "bg_center": "#c3cbd6", "exposure": -0.55}

run("rainy_street", build, lens=35, env=ENV)
