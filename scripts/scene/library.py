"""図書館のジオラマ（3D シーン）を作り、アプリ用の USDZ と発表用の画像を書き出す。

本棚のある奥と左の壁、3 つの閲覧テーブル（それぞれ 4 人が座って話し合ったり読んだりしている）、
窓際で 1 人で読む人、棚を見ている人、受付の司書、本のカートを置く。
共通の道具は common.py。

使い方:
  blender --background --factory-startup --python scripts/scene/library.py -- [--out assets/scenes] [--no-render] [--samples 128]
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HALF, SIZE, Part, material, materials, person, run  # noqa: E402

rng = random.Random(2026)
M: dict = {}

WALL_H = 3.0
WALL_T = 0.25
BACK_Y = HALF - WALL_T / 2      # 奥の壁
LEFT_X = -HALF + WALL_T / 2     # 左の壁
BASE_R = 0.35
ROUND_CORNERS = ((-1, -1), (1, -1), (1, 1))
WALL_END = HALF - BASE_R

BOOK_KEYS = ["book_r", "book_b", "book_g", "book_y", "book_p", "book_teal", "book_cream", "book_brown", "book_navy"]

# 閲覧テーブル（中心の x, y）。各テーブルに 4 人（x ±0.4、y ±0.75）
TABLES = [(-1.5, 0.4), (1.0, 0.4), (-0.25, -2.4)]


def make_materials() -> None:
    M.update(materials({
        "floor_a": ("#c8935a", 0.5), "floor_b": ("#b8814a", 0.5), "base": ("#d9d4cc", 0.8), "base_dark": ("#a9a39a", 0.85),
        "wall": ("#f3ead8", 0.85), "baseboard": ("#7a5230", 0.6), "shelf": ("#a46d40", 0.6), "shelf_dark": ("#7d4f2c", 0.6),
        "table": ("#b07a48", 0.5), "table_leg": ("#6b4428", 0.5), "rug_red": ("#8c4a5a", 0.95), "rug_blue": ("#3e6a8f", 0.95),
        "chair_wood": ("#c49a6c", 0.5), "cushion": ("#e0583f", 0.9), "armchair": ("#3e8a7a", 0.9),
        "cart": ("#9c8a72", 0.5), "counter": ("#f0e2c8", 0.6), "counter_top": ("#8a5a35", 0.45),
        "frame": ("#7a5230", 0.55), "poster_a": ("#e76f51", 0.8), "poster_b": ("#2a9d8f", 0.8), "poster_c": ("#e9c46a", 0.8),
        "clock_face": ("#ffffff", 0.4), "clock_hand": ("#2a2a30", 0.4), "metal": ("#8e959e", 0.4),
        "pot": ("#d9784f", 0.7), "leaf": ("#3f9a3a", 0.7), "leaf2": ("#5cb848", 0.7), "bin": ("#6f8fa8", 0.5),
        "pages": ("#fff8ec", 0.8), "notebook": ("#fffbe6", 0.8), "notebook_b": ("#9cc8ff", 0.8), "notebook_g": ("#a9e3a0", 0.8),
        "cup": ("#ffffff", 0.3), "cup_brown": ("#8a5a35", 0.3), "bottle": ("#7fd1ff", 0.1),
        "lamp": ("#f2c94c", 0.4), "laptop": ("#9aa3ad", 0.35), "screen": ("#1e2a3a", 0.2), "phone": ("#2a2a30", 0.3),
        "pen": ("#2b5fb8", 0.4), "bag": ("#d93b3b", 0.5), "bag_navy": ("#2f3b63", 0.6),
        "skin_l": ("#f6caa6", 0.55), "skin_m": ("#d9a07a", 0.55), "skin_t": ("#c68a5e", 0.55), "skin_d": ("#8d5a3b", 0.55),
        "eye": ("#2a211c", 0.3),
        "hair_black": ("#2a1f1a", 0.6), "hair_brown": ("#5a3a22", 0.6), "hair_gold": ("#c9a25b", 0.6), "hair_grey": ("#9a9aa0", 0.6),
        "top_blue": ("#5b8fd6", 0.8), "top_red": ("#d9534f", 0.8), "top_green": ("#5cae6a", 0.8), "top_yellow": ("#f2c94c", 0.8),
        "top_white": ("#f7f7f2", 0.7), "top_purple": ("#9a7ad9", 0.8), "top_grey": ("#9a9aa3", 0.8), "top_pink": ("#f29bb5", 0.8),
        "bottom_navy": ("#2f3b63", 0.7), "bottom_black": ("#2a2a30", 0.7), "bottom_beige": ("#d9c7a4", 0.7),
        "skirt_red": ("#b23a48", 0.8),
        "shoe_brown": ("#6b4428", 0.5), "shoe_white": ("#f2f2f2", 0.5), "shoe_black": ("#25252a", 0.5),
        "book_r": ("#e05a4f", 0.6), "book_b": ("#4f7fd9", 0.6), "book_g": ("#4fb36a", 0.6), "book_y": ("#f2c04a", 0.6),
        "book_p": ("#a678e0", 0.6), "book_teal": ("#2f9e9a", 0.6), "book_cream": ("#eadbb8", 0.6),
        "book_brown": ("#7a4a2a", 0.6), "book_navy": ("#2d3b5e", 0.6),
    }))
    M["window_sky"] = material("window_sky", "#9fd0ff", 0.2, emit=0.6)
    M["lamp_glow"] = material("lamp_glow", "#fff3c4", 0.5, emit=1.2)


def outfit(skin, hair, top, bottom, shoe, style="short", skirt=False) -> dict:
    return {"skin": M[skin], "hair": M[hair], "top": M[top], "bottom": M[bottom], "shoe": M[shoe],
            "eye": M["eye"], "hair_style": style, "skirt": skirt}


def face_toward(loc, target) -> float:
    """loc の人が target の方を向く rot_z。人物の正面は -Y。"""
    dx, dy = target[0] - loc[0], target[1] - loc[1]
    return math.atan2(dx, -dy)


# ---------- 部屋 ----------

def build_room(root) -> None:
    p = Part("room")
    p.slab(SIZE, 0.0, 0.2, BASE_R, M["base"], corners=ROUND_CORNERS)
    p.slab(SIZE - 0.2, -0.2, 0.45, BASE_R - 0.05, M["base_dark"], corners=ROUND_CORNERS)
    planks = 16
    for i in range(planks):
        y = -HALF + 0.35 + (SIZE - 0.7) * (i + 0.5) / planks
        p.box((SIZE - 0.6, (SIZE - 0.7) / planks - 0.01, 0.02), (0.15, y, 0.01), M["floor_a"] if i % 2 else M["floor_b"])
    back_len = HALF + WALL_END
    side_len = WALL_END + HALF - WALL_T
    p.box((back_len, WALL_T, WALL_H), (WALL_END - back_len / 2, BACK_Y, WALL_H / 2), M["wall"])
    p.box((WALL_T, side_len, WALL_H), (LEFT_X, -WALL_END + side_len / 2, WALL_H / 2), M["wall"])
    p.box((back_len + 0.04, WALL_T + 0.04, 0.12), (WALL_END - back_len / 2, BACK_Y, 0.06), M["baseboard"])
    p.box((WALL_T + 0.04, side_len, 0.12), (LEFT_X, -WALL_END + side_len / 2 - 0.02, 0.06), M["baseboard"])
    p.finish(root)

    # 床の敷物（テーブルの下）
    rugs = Part("rugs")
    for (tx, ty), mat in zip(TABLES, ("rug_red", "rug_blue", "rug_red")):
        rugs.box((2.6, 2.2, 0.012), (tx, ty, 0.006), M[mat], bevel=0.01)
    rugs.finish(root)


def build_bookcase(root, name, loc, rot_z, width, height=2.2, depth=0.36) -> None:
    """本がぎっしり入った本棚。正面は -Y（rot_z で壁に向ける）。"""
    p = Part(name)
    levels = 5
    for i in range(levels):
        p.box((width, depth, 0.04), (0, 0, 0.04 + i * (height - 0.04) / (levels - 1)), M["shelf"])
    for sx in (-1, 1):
        p.box((0.04, depth, height), (sx * (width / 2 - 0.02), 0, height / 2), M["shelf"])
    p.box((width, 0.03, height), (0, depth / 2 - 0.015, height / 2), M["shelf_dark"])
    for i in range(levels - 1):
        z0 = 0.08 + i * (height - 0.04) / (levels - 1)
        z1 = (i + 1) * (height - 0.04) / (levels - 1)
        x = -width / 2 + 0.06
        while x < width / 2 - 0.1:
            t = rng.uniform(0.025, 0.045)
            bh = rng.uniform(0.22, 0.32) if (i + x) % 3 else rng.uniform(0.12, 0.18)
            if x + t > width / 2 - 0.06:
                break
            # たまに本を倒して置く
            if rng.random() < 0.06:
                p.box((bh, t, t), (x + bh / 2, -0.02, z0 + t / 2 + 0.01), M[rng.choice(BOOK_KEYS)], bevel=0.003)
                x += bh + 0.01
                continue
            p.box((t, depth - 0.1, bh), (x + t / 2, -0.02, z0 + bh / 2), M[rng.choice(BOOK_KEYS)], bevel=0.004)
            x += t + 0.008
        # 段の上の小物（置物・ファイル）
        if i % 2 == 0:
            p.box((0.14, 0.14, 0.16), (width / 2 - 0.2, 0.0, z0 + 0.08), M[rng.choice(["pot", "lamp", "bag"])], bevel=0.01)
    p.finish(root, loc=loc, rot_z=rot_z)


def build_windows(root) -> None:
    """奥の壁の窓（明るい空）。白い枠と桟つき。"""
    cx, cz, w, h = 1.3, 1.75, 1.5, 1.9
    p = Part("window")
    p.box((w, 0.02, h), (cx, BACK_Y - WALL_T / 2 + 0.01, cz), M["window_sky"])
    for dx in (-w / 2 + 0.02, w / 2 - 0.02):
        p.box((0.05, 0.05, h + 0.06), (cx + dx, BACK_Y - 0.05, cz), M["frame"])
    p.box((w + 0.06, 0.05, 0.05), (cx, BACK_Y - 0.05, cz + h / 2), M["frame"])
    p.box((w + 0.06, 0.05, 0.05), (cx, BACK_Y - 0.05, cz - h / 2), M["frame"])
    p.box((0.03, 0.04, h), (cx, BACK_Y - 0.05, cz), M["frame"])
    p.box((w, 0.04, 0.03), (cx, BACK_Y - 0.05, cz), M["frame"])
    p.finish(root)


def build_clock(root) -> None:
    """奥の壁の丸い時計。"""
    p = Part("clock")
    y = BACK_Y - WALL_T / 2 - 0.03
    p.cyl(0.26, 0.26, 0.05, (-0.7, y, 2.62), M["frame"], rot=(math.pi / 2, 0, 0), segs=32)
    p.cyl(0.22, 0.22, 0.02, (-0.7, y + 0.02, 2.62), M["clock_face"], rot=(math.pi / 2, 0, 0), segs=32)
    p.box((0.015, 0.01, 0.13), (-0.7, y + 0.0, 2.7), M["clock_hand"])
    p.box((0.10, 0.01, 0.015), (-0.7 + 0.05, y + 0.0, 2.62), M["clock_hand"])
    p.finish(root)


def build_posters(root) -> None:
    """奥の壁の掲示板（ポスター 3 枚）。"""
    p = Part("posters")
    y = BACK_Y - WALL_T / 2 - 0.01
    for x, z, w, h, mat in [(-2.2, 2.2, 0.5, 0.65, "poster_a"), (-1.6, 2.3, 0.4, 0.5, "poster_c"), (2.9, 2.4, 0.6, 0.6, "poster_b")]:
        p.box((w, 0.02, h), (x, y, z), M[mat])
        p.box((w * 0.7, 0.01, 0.02), (x, y - 0.01, z + 0.1), M["wall"])
        p.box((w * 0.5, 0.01, 0.02), (x, y - 0.01, z - 0.1), M["wall"])
    p.finish(root)


# ---------- テーブルと椅子 ----------

def build_table(root, name, loc) -> None:
    """閲覧テーブル。4 人分の本・ノート・カップ・電気スタンドつき。"""
    tx, ty = loc
    p = Part(name)
    p.box((1.5, 0.84, 0.04), (0, 0, 0.74), M["table"], bevel=0.015)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.03, 0.03, 0.72, (sx * 0.68, sy * 0.36, 0.36), M["table_leg"], segs=10)
    p.box((1.3, 0.04, 0.1), (0, 0.36, 0.67), M["table_leg"])
    p.box((1.3, 0.04, 0.1), (0, -0.36, 0.67), M["table_leg"])
    # 中央：本の山とスタンド
    p.box((0.26, 0.2, 0.03), (0.0, 0.0, 0.775), M["book_teal"], bevel=0.003)
    p.box((0.24, 0.19, 0.025), (0.01, 0.0, 0.8), M["book_cream"], bevel=0.003)
    p.box((0.22, 0.17, 0.03), (-0.01, 0.0, 0.83), M["book_r"], bevel=0.003)
    p.cyl(0.015, 0.015, 0.4, (0.6, 0.3, 0.94), M["metal"], segs=8)
    p.cyl(0.07, 0.11, 0.1, (0.6, 0.3, 1.14), M["lamp"], segs=16)
    p.sphere(0.04, (0.6, 0.3, 1.1), M["lamp_glow"], segs=10)
    p.cyl(0.035, 0.035, 0.22, (-0.6, -0.12, 0.85), M["bottle"], segs=12)
    # 4 人分の席まわり（x: 左右、y: 手前と奥の席）
    for k, (sx, sy) in enumerate([(-1, -1), (1, -1), (-1, 1), (1, 1)]):
        ox, oy = sx * 0.4, sy * 0.25
        # 開いた本（白い紙と表紙）
        p.box((0.2, 0.26, 0.008), (ox, oy, 0.765), M["book_navy" if k % 2 else "book_y"])
        p.box((0.19, 0.24, 0.012), (ox + 0.005 * sx, oy, 0.772), M["pages"])
        # ノートとペン
        p.box((0.18, 0.24, 0.01), (sx * 0.16, oy + sy * 0.02, 0.765), M["notebook_b" if k % 2 == 0 else "notebook_g"], rot=(0, 0, 0.1 * sx))
        p.cyl(0.006, 0.006, 0.14, (sx * 0.14 + 0.02, oy + sy * 0.1, 0.775), M["pen"], rot=(0, math.pi / 2, 0.3), segs=6)
        # カップ（飲み物）
        p.cyl(0.04, 0.035, 0.09, (sx * 0.56, sy * 0.3, 0.81), M["cup"] if k % 2 == 0 else M["cup_brown"], segs=14)
        # スマホ（一部の席）
        if k in (1, 2):
            p.box((0.07, 0.14, 0.01), (sx * 0.5, sy * 0.05, 0.765), M["phone"], rot=(0, 0, 0.3 * sx))
    # ノートパソコン（1 人だけ）
    p.box((0.34, 0.24, 0.01), (0.38, 0.0, 0.765), M["laptop"], rot=(0, 0, 0.12))
    p.box((0.34, 0.01, 0.22), (0.38, 0.12, 0.88), M["screen"], rot=(-0.25, 0, 0.12))
    # かばん（テーブルの下、床に）
    p.box((0.36, 0.2, 0.26), (-0.74, -0.7, 0.13), M["bag"], bevel=0.03)
    p.finish(root, loc=(tx, ty, 0))


def build_chair(root, name, loc, rot_z, backpack=False) -> None:
    """木の椅子（背もたれは座る人の後ろ側）。椅子は座る人と同じ向き。"""
    p = Part(name)
    p.box((0.46, 0.44, 0.05), (0, 0, 0.44), M["chair_wood"], bevel=0.012)
    p.box((0.46, 0.05, 0.44), (0, 0.22, 0.7), M["chair_wood"], bevel=0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.018, 0.018, 0.42, (sx * 0.2, sy * 0.18, 0.21), M["table_leg"], segs=8)
    if backpack:
        p.box((0.3, 0.14, 0.36), (0, 0.32, 0.6), M["bag_navy"], bevel=0.04)
        p.box((0.22, 0.04, 0.12), (0, 0.4, 0.46), M["bag_navy"], bevel=0.02)
    p.finish(root, loc=loc, rot_z=rot_z)


def build_armchair(root, name, loc, rot_z) -> None:
    p = Part(name)
    p.box((0.8, 0.7, 0.12), (0, 0, 0.36), M["armchair"], bevel=0.04)
    p.box((0.8, 0.14, 0.6), (0, 0.28, 0.7), M["armchair"], bevel=0.05)
    for sx in (-1, 1):
        p.box((0.14, 0.7, 0.3), (sx * 0.4, 0, 0.5), M["armchair"], bevel=0.04)
        p.box((0.14, 0.7, 0.04), (sx * 0.4, 0, 0.66), M["cushion"], bevel=0.02)
    p.box((0.4, 0.1, 0.36), (0.1, 0.3, 0.9), M["cushion"], bevel=0.04)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.03, 0.03, 0.12, (sx * 0.34, sy * 0.28, 0.06), M["table_leg"], segs=8)
    p.finish(root, loc=loc, rot_z=rot_z)


# ---------- その他の家具と小物 ----------

def build_counter(root) -> None:
    """受付カウンター（右前）。"""
    p = Part("counter")
    p.box((1.6, 0.6, 1.0), (0, 0, 0.5), M["counter"], bevel=0.02)
    p.box((1.7, 0.66, 0.05), (0, 0, 1.02), M["counter_top"], bevel=0.015)
    p.box((0.4, 0.02, 0.2), (-0.4, -0.31, 1.12), M["notebook_b"], bevel=0.005)  # 貸し出しカード
    p.cyl(0.04, 0.04, 0.12, (0.5, 0.1, 1.1), M["cup_brown"], segs=12)
    p.box((0.34, 0.24, 0.02), (0.0, 0.05, 1.07), M["book_r"], bevel=0.003)
    p.box((0.3, 0.22, 0.02), (0.0, 0.05, 1.09), M["book_b"], bevel=0.003)
    p.finish(root, loc=(3.0, -2.6, 0))


def build_cart(root) -> None:
    """返却された本を載せた本のカート。"""
    p = Part("book_cart")
    w, d, h = 0.62, 0.9, 1.0
    for z in (0.12, 0.52, 0.92):
        p.box((w, d, 0.03), (0, 0, z), M["cart"], bevel=0.005)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.02, 0.02, h, (sx * (w / 2 - 0.03), sy * (d / 2 - 0.03), h / 2), M["metal"], segs=8)
    for z in (0.135, 0.535, 0.935):
        x = -w / 2 + 0.05
        while x < w / 2 - 0.08:
            t = rng.uniform(0.03, 0.05)
            bh = rng.uniform(0.2, 0.28)
            p.box((t, 0.2, bh), (x + t / 2, rng.uniform(-0.25, 0.1), z + bh / 2), M[rng.choice(BOOK_KEYS)], bevel=0.003)
            x += t + 0.01
    p.finish(root, loc=(2.2, -0.9, 0), rot_z=0.15)


def build_plant(root, loc) -> None:
    p = Part("plant")
    p.cyl(0.24, 0.18, 0.4, (0, 0, 0.2), M["pot"], segs=16)
    p.cyl(0.22, 0.22, 0.03, (0, 0, 0.39), M["frame"], segs=16)
    for i, (x, y, z, r) in enumerate([(0, 0, 0.75, 0.3), (0.18, 0.05, 0.62, 0.22), (-0.15, -0.08, 0.64, 0.22), (0.02, 0.1, 1.0, 0.2)]):
        p.blob(r, (x, y, z), M["leaf"] if i % 2 else M["leaf2"], bumpy=0.25, subdiv=3, seed=i * 2.7)
    p.finish(root, loc=loc)


def build_bin(root, loc) -> None:
    p = Part("bin")
    p.cyl(0.2, 0.17, 0.45, (0, 0, 0.225), M["bin"], segs=20)
    p.cyl(0.21, 0.21, 0.03, (0, 0, 0.45), M["bin"], segs=20)
    p.finish(root, loc=loc)


# ---------- 人物 ----------

def build_people(root) -> None:
    # テーブルごとに 4 人。出身や服装が違うように組み合わせた
    groups = [
        [outfit("skin_l", "hair_brown", "top_blue", "bottom_navy", "shoe_white", "long", skirt=False),
         outfit("skin_m", "hair_black", "top_yellow", "bottom_beige", "shoe_brown", "bun"),
         outfit("skin_t", "hair_black", "top_green", "skirt_red", "shoe_black", "long", skirt=True),
         outfit("skin_d", "hair_grey", "top_white", "bottom_black", "shoe_white", "short")],
        [outfit("skin_d", "hair_black", "top_pink", "bottom_navy", "shoe_black", "short"),
         outfit("skin_l", "hair_gold", "top_purple", "skirt_red", "shoe_white", "long", skirt=True),
         outfit("skin_m", "hair_brown", "top_grey", "bottom_black", "shoe_brown", "bun"),
         outfit("skin_t", "hair_brown", "top_red", "bottom_beige", "shoe_white", "short")],
        [outfit("skin_m", "hair_black", "top_green", "bottom_navy", "shoe_white", "long"),
         outfit("skin_l", "hair_brown", "top_white", "bottom_black", "shoe_black", "short"),
         outfit("skin_d", "hair_black", "top_blue", "skirt_red", "shoe_brown", "bun", skirt=True),
         outfit("skin_t", "hair_grey", "top_yellow", "bottom_navy", "shoe_white", "short")],
    ]
    names = ["reader", "explainer", "note_taker", "listener"]
    for ti, (tx, ty) in enumerate(TABLES):
        seats = [(sx, sy) for sy in (-1, 1) for sx in (-1, 1)]
        for k, ((sx, sy), o) in enumerate(zip(seats, groups[ti])):
            loc = (tx + sx * 0.4, ty + sy * 0.75)
            rot = face_toward(loc, (tx, ty))
            build_chair(root, f"chair_{ti}_{k}", loc, rot, backpack=(ti == 0 and k == 0))
            person(root, f"guest_{ti}_{names[k]}", loc, rot, o, pose="sit")
    # テーブル本体（人より先に作る必要はないが、同じ親にまとめる）
    for ti, (tx, ty) in enumerate(TABLES):
        build_table(root, f"table_{ti}", (tx, ty))


def build_solo_reader(root) -> None:
    """窓際のひじかけ椅子で 1 人で本を読む人。"""
    loc = (2.5, 2.35)
    build_armchair(root, "armchair", loc, 0.0)
    o = outfit("skin_m", "hair_black", "top_red", "bottom_black", "shoe_brown", "long", skirt=False)
    person(root, "solo_reader", loc, 0.0, o, pose="sit")


def build_browser_and_librarian(root) -> None:
    """左の本棚を見ている人と、右前の受付の司書。"""
    o_browse = outfit("skin_l", "hair_gold", "top_purple", "bottom_navy", "shoe_black", "bun")
    person(root, "browser", (-2.9, 0.2), -math.pi / 2, o_browse, pose="stand")
    o_lib = outfit("skin_d", "hair_black", "top_white", "skirt_red", "shoe_black", "long", skirt=True)
    person(root, "librarian", (3.0, -1.95), 0.0, o_lib, pose="point", point_side=-1)


# ---------- 組み立て ----------

def build_library() -> bpy.types.Object:
    root = bpy.data.objects.new("library", None)
    bpy.context.scene.collection.objects.link(root)
    build_room(root)
    # 奥の壁の本棚（窓を挟んで左右）、左の壁の本棚
    build_bookcase(root, "bookcase_back_left", (-2.6, BACK_Y - WALL_T / 2 - 0.2, 0), 0.0, 1.4)
    build_bookcase(root, "bookcase_back_mid", (-0.8, BACK_Y - WALL_T / 2 - 0.2, 0), 0.0, 1.4)
    build_bookcase(root, "bookcase_back_right", (3.0, BACK_Y - WALL_T / 2 - 0.2, 0), 0.0, 1.2)
    build_bookcase(root, "bookcase_left_front", (LEFT_X + WALL_T / 2 + 0.2, -2.4, 0), math.pi / 2, 2.0)
    build_bookcase(root, "bookcase_left_mid", (LEFT_X + WALL_T / 2 + 0.2, 0.2, 0), math.pi / 2, 1.4)
    build_bookcase(root, "bookcase_left_back", (LEFT_X + WALL_T / 2 + 0.2, 2.6, 0), math.pi / 2, 1.6)
    build_windows(root)
    build_clock(root)
    build_posters(root)
    build_counter(root)
    build_cart(root)
    build_plant(root, (-3.3, -3.2))
    build_plant(root, (3.3, 2.9))
    build_bin(root, (-3.35, -1.2))
    build_people(root)
    build_solo_reader(root)
    build_browser_and_librarian(root)
    return root


def build() -> bpy.types.Object:
    make_materials()
    return build_library()


run("library", build)
