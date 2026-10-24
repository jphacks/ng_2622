"""教室のジオラマ（3D シーン）を作り、アプリ用の USDZ と発表用の画像を書き出す。

床と奥の 2 面の壁だけの、断面図のような教室。共通の道具は common.py。

使い方:
  blender --background --factory-startup --python scripts/scene/classroom.py -- [--out assets/scenes] [--no-render] [--samples 128]
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HALF, SIZE, Part, material, materials, person, run  # noqa: E402

rng = random.Random(7)
M: dict = {}

WALL_H = 3.0
WALL_T = 0.25
BACK_Y = HALF - WALL_T / 2      # 奥の壁（黒板）
LEFT_X = -HALF + WALL_T / 2     # 左の壁（窓）


def make_materials() -> None:
    M.update(materials({
        "floor_a": ("#c8935a", 0.5), "floor_b": ("#b8814a", 0.5), "base": ("#d9d4cc", 0.8), "base_dark": ("#a9a39a", 0.85),
        "wall": ("#f3ead8", 0.85), "baseboard": ("#9a6b45", 0.6), "frame": ("#8a5a35", 0.55),
        "board": ("#2f5e45", 0.85), "chalk": ("#f4f4ef", 0.9), "chalk_y": ("#ffe58a", 0.9),
        "desk_top": ("#d9a868", 0.45), "metal": ("#8e959e", 0.4), "chair": ("#c79358", 0.5),
        "white": ("#ffffff", 0.5), "dark": ("#2a2a30", 0.4), "cork": ("#c9a06a", 0.9),
        "paper_pink": ("#ffb3c7", 0.8), "paper_blue": ("#9cc8ff", 0.8), "paper_yellow": ("#ffe17a", 0.8), "paper_green": ("#a9e3a0", 0.8),
        "curtain": ("#ffe3a3", 0.8), "shelf": ("#a46d40", 0.6),
        "book_r": ("#e05a4f", 0.6), "book_b": ("#4f7fd9", 0.6), "book_g": ("#4fb36a", 0.6), "book_y": ("#f2c04a", 0.6), "book_p": ("#a678e0", 0.6),
        "pot": ("#d9784f", 0.7), "leaf": ("#3f9a3a", 0.7), "leaf2": ("#5cb848", 0.7),
        "apple": ("#d9352b", 0.4), "globe_sea": ("#3f8fd9", 0.4), "globe_land": ("#5cb848", 0.6),
        "bag": ("#d93b3b", 0.5), "bin": ("#6f8fa8", 0.5),
        "skin": ("#f6caa6", 0.55), "eye": ("#2a211c", 0.3),
        "hair_brown": ("#5a3a22", 0.6), "hair_black": ("#2a1f1a", 0.6), "hair_teacher": ("#3d2a1e", 0.6),
        "cardigan": ("#7a9fd6", 0.8), "skirt_navy": ("#2f3b63", 0.8), "shoe_brown": ("#6b4428", 0.5),
        "shirt_white": ("#f7f7f2", 0.7), "shirt_yellow": ("#ffcf3a", 0.7), "pants_navy": ("#2f3b63", 0.7),
        "sweater_pink": ("#f29bb5", 0.8), "shoe_white": ("#f2f2f2", 0.5), "shoe_red": ("#e3483c", 0.5),
    }))
    # 窓の外は明るい空。少し光らせて、窓から光が入っているように見せる
    M["sky"] = material("sky", "#9fd0ff", 0.2, emit=0.5)
    M["clock_face"] = material("clock_face", "#ffffff", 0.4)


def build_room(root):
    p = Part("room")
    p.slab(SIZE, 0.0, 0.2, 0.35, M["base"])
    p.slab(SIZE - 0.2, -0.2, 0.45, 0.3, M["base_dark"])
    # 板張りの床
    planks = 16
    for i in range(planks):
        y = -HALF + 0.35 + (SIZE - 0.7) * (i + 0.5) / planks
        p.box((SIZE - 0.6, (SIZE - 0.7) / planks - 0.01, 0.02), (0.15, y, 0.01), M["floor_a"] if i % 2 else M["floor_b"])
    # 奥と左の壁
    p.box((SIZE, WALL_T, WALL_H), (0, BACK_Y, WALL_H / 2), M["wall"])
    p.box((WALL_T, SIZE - WALL_T, WALL_H), (LEFT_X, -WALL_T / 2, WALL_H / 2), M["wall"])
    p.box((SIZE, WALL_T + 0.04, 0.12), (0, BACK_Y, 0.06), M["baseboard"])
    p.box((WALL_T + 0.04, SIZE - WALL_T, 0.12), (LEFT_X, -WALL_T / 2, 0.06), M["baseboard"])
    p.finish(root)


def build_blackboard(root):
    p = Part("blackboard")
    y = BACK_Y - WALL_T / 2
    p.box((4.3, 0.08, 1.65), (0.3, y - 0.04, 1.7), M["frame"], bevel=0.02)
    p.box((4.1, 0.06, 1.45), (0.3, y - 0.09, 1.7), M["board"])
    p.box((4.2, 0.16, 0.05), (0.3, y - 0.12, 0.9), M["frame"], bevel=0.01)
    for x, mat in [(-0.6, M["chalk"]), (-0.45, M["chalk_y"]), (1.6, M["chalk"])]:
        p.cyl(0.015, 0.015, 0.12, (x, y - 0.14, 0.94), mat, rot=(0, math.pi / 2, 0), segs=6)
    p.box((0.18, 0.08, 0.05), (1.9, y - 0.14, 0.95), M["dark"], bevel=0.01)
    # チョークで書いた文字の線（手書きのように長さと高さを散らす）
    for row, (z, n) in enumerate([(2.15, 5), (1.85, 4), (1.55, 6)]):
        x = -1.4
        for _ in range(n):
            w = rng.uniform(0.25, 0.6)
            p.box((w, 0.01, 0.045), (x + w / 2, y - 0.125, z + rng.uniform(-0.02, 0.02)), M["chalk_y"] if row == 0 else M["chalk"])
            x += w + rng.uniform(0.1, 0.18)
    p.finish(root)


def build_clock(root):
    p = Part("clock")
    y = BACK_Y - WALL_T / 2 - 0.04
    p.cyl(0.34, 0.34, 0.06, (3.0, y, 2.45), M["dark"], rot=(math.pi / 2, 0, 0), segs=32, smooth=False)
    p.cyl(0.3, 0.3, 0.07, (3.0, y - 0.01, 2.45), M["clock_face"], rot=(math.pi / 2, 0, 0), segs=32, smooth=False)
    p.box((0.03, 0.02, 0.18), (3.0, y - 0.06, 2.53), M["dark"])                        # 長針
    p.box((0.03, 0.02, 0.13), (3.05, y - 0.06, 2.42), M["dark"], rot=(0, -2.1, 0))    # 短針
    for k in range(12):
        a = k / 12 * math.tau
        p.box((0.02, 0.02, 0.04), (3.0 + math.sin(a) * 0.25, y - 0.05, 2.45 + math.cos(a) * 0.25), M["dark"], rot=(0, -a, 0))
    p.finish(root)


def build_bulletin(root):
    p = Part("bulletin_board")
    y = BACK_Y - WALL_T / 2
    p.box((1.3, 0.05, 1.0), (-2.75, y - 0.025, 1.75), M["frame"], bevel=0.015)
    p.box((1.2, 0.05, 0.9), (-2.75, y - 0.045, 1.75), M["cork"])
    papers = [(-3.1, 1.95, "paper_pink"), (-2.6, 2.0, "paper_blue"), (-3.05, 1.55, "paper_yellow"), (-2.5, 1.55, "paper_green")]
    for x, z, m in papers:
        p.box((0.36, 0.01, 0.3), (x, y - 0.075, z), M[m], rot=(0, rng.uniform(-0.12, 0.12), 0))
        p.sphere(0.02, (x, y - 0.085, z + 0.12), M["apple"], segs=8)
    p.finish(root)


def build_windows(root):
    p = Part("windows")
    x = LEFT_X + WALL_T / 2
    for cy in (-1.6, 1.2):
        p.box((0.04, 1.7, 1.4), (x + 0.005, cy, 1.75), M["sky"])
        for dy in (-0.85, 0, 0.85):
            p.box((0.08, 0.07, 1.48), (x + 0.04, cy + dy, 1.75), M["white"], bevel=0.01)
        for dz in (-0.7, 0.7):
            p.box((0.08, 1.78, 0.07), (x + 0.04, cy, 1.75 + dz), M["white"], bevel=0.01)
        p.box((0.2, 1.8, 0.05), (x + 0.1, cy, 1.02), M["white"], bevel=0.01)  # 窓台
        # 左右にまとめたカーテン
        for side in (-1, 1):
            p.box((0.1, 0.3, 1.6), (x + 0.14, cy + side * 1.0, 1.75), M["curtain"], bevel=0.04)
        p.box((0.06, 2.4, 0.06), (x + 0.16, cy, 2.58), M["metal"])
    p.finish(root)


def build_teacher_desk(root):
    p = Part("teacher_desk")
    p.box((1.6, 0.7, 0.06), (0, 0, 0.78), M["desk_top"], bevel=0.015)
    p.box((1.5, 0.6, 0.7), (0, 0.02, 0.4), M["frame"], bevel=0.02)
    p.box((0.3, 0.22, 0.06), (-0.45, 0, 0.84), M["book_b"], bevel=0.008)
    p.box((0.28, 0.2, 0.05), (-0.45, 0.01, 0.895), M["book_r"], rot=(0, 0, 0.2), bevel=0.008)
    p.sphere(0.07, (0.05, -0.1, 0.88), M["apple"], scale=(1, 1, 0.9), segs=14)
    p.cyl(0.008, 0.006, 0.05, (0.05, -0.1, 0.96), M["frame"], segs=6)
    # 地球儀
    p.cyl(0.08, 0.1, 0.03, (0.5, 0.05, 0.825), M["frame"], segs=14)
    p.cyl(0.012, 0.012, 0.12, (0.5, 0.05, 0.9), M["metal"], segs=6)
    p.blob(0.13, (0.5, 0.05, 1.04), M["globe_sea"], bumpy=0.0, subdiv=3)
    p.blob(0.132, (0.5, 0.05, 1.04), M["globe_land"], scale=(0.6, 1.0, 0.7), bumpy=0.35, subdiv=2, seed=3)
    p.finish(root, loc=(0.3, 2.85))


def build_desk_set(root, name, loc, bag=False, notebook=False):
    """生徒の机と椅子。生徒は黒板（+Y）を向いて座る。"""
    p = Part(name)
    p.box((1.0, 0.6, 0.04), (0, 0, 0.72), M["desk_top"], bevel=0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.022, 0.022, 0.7, (sx * 0.44, sy * 0.25, 0.35), M["metal"], segs=8)
    p.box((0.9, 0.5, 0.12), (0, 0.02, 0.62), M["metal"], bevel=0.01)
    # 椅子（机の手前）
    cy = -0.55
    p.box((0.42, 0.4, 0.04), (0, cy, 0.44), M["chair"], bevel=0.01)
    p.box((0.42, 0.04, 0.3), (0, cy - 0.2, 0.7), M["chair"], bevel=0.01)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.018, 0.018, 0.44, (sx * 0.18, cy + sy * 0.17, 0.22), M["metal"], segs=8)
        p.cyl(0.018, 0.018, 0.34, (sx * 0.18, cy - 0.2, 0.6), M["metal"], segs=8)
    if notebook:
        p.box((0.36, 0.26, 0.015), (0.05, -0.05, 0.75), M["white"])
        p.cyl(0.008, 0.008, 0.16, (0.18, -0.08, 0.765), M["book_y"], rot=(0, math.pi / 2, 0.4), segs=6)
    if bag:
        # 机の横にかけたランドセル
        p.box((0.3, 0.2, 0.34), (0.58, 0, 0.5), M["bag"], bevel=0.05)
        p.box((0.3, 0.05, 0.2), (0.58, -0.11, 0.57), M["bag"], bevel=0.03)
    p.finish(root, loc=loc)


def build_bookshelf(root):
    p = Part("bookshelf")
    w, d, h = 0.4, 1.4, 1.5
    p.box((w, d, 0.05), (0, 0, h), M["shelf"], bevel=0.01)
    for z in (0.03, 0.52, 1.01):
        p.box((w, d, 0.04), (0, 0, z), M["shelf"])
    for sy in (-1, 1):
        p.box((w, 0.05, h), (0, sy * d / 2, h / 2), M["shelf"])
    p.box((0.03, d, h), (-w / 2 + 0.015, 0, h / 2), M["shelf"])
    books = ["book_r", "book_b", "book_g", "book_y", "book_p"]
    for z in (0.05, 0.54, 1.03):
        y = -d / 2 + 0.08
        while y < d / 2 - 0.1:
            t = rng.uniform(0.05, 0.09)
            bh = rng.uniform(0.3, 0.42)
            p.box((0.28, t, bh), (0.0, y + t / 2, z + bh / 2), M[rng.choice(books)], bevel=0.006)
            y += t + 0.01
    p.finish(root, loc=(LEFT_X + WALL_T / 2 + 0.22, -3.1))


def build_plant(root, loc):
    p = Part("plant")
    p.cyl(0.24, 0.18, 0.4, (0, 0, 0.2), M["pot"], segs=16)
    p.cyl(0.22, 0.22, 0.03, (0, 0, 0.39), M["frame"], segs=16)
    for i, (x, y, z, r) in enumerate([(0, 0, 0.75, 0.3), (0.18, 0.05, 0.62, 0.22), (-0.15, -0.08, 0.64, 0.22), (0.02, 0.1, 1.0, 0.2)]):
        p.blob(r, (x, y, z), M["leaf"] if i % 2 else M["leaf2"], bumpy=0.25, subdiv=3, seed=i * 2.7)
    p.finish(root, loc=loc)


def build_bin(root, loc):
    p = Part("trash_bin")
    p.cyl(0.2, 0.17, 0.45, (0, 0, 0.225), M["bin"], segs=20)
    p.cyl(0.21, 0.21, 0.03, (0, 0, 0.45), M["bin"], segs=20)
    p.finish(root, loc=loc)


def build_classroom() -> bpy.types.Object:
    root = bpy.data.objects.new("classroom", None)
    bpy.context.scene.collection.objects.link(root)
    build_room(root)
    build_blackboard(root)
    build_clock(root)
    build_bulletin(root)
    build_windows(root)
    build_teacher_desk(root)
    build_bookshelf(root)
    build_plant(root, (-3.35, 3.35))
    build_bin(root, (3.4, -3.3))

    desks = [(x, y) for y in (1.1, -0.8, -2.7) for x in (-1.5, 0.5, 2.5)]
    for i, (x, y) in enumerate(desks):
        build_desk_set(root, f"desk_{i + 1}", (x, y), bag=(i == 5), notebook=(i in (0, 4, 6)))

    # 黒板の前で、生徒のほうを向いて黒板を指さす先生
    teacher = {"skin": M["skin"], "hair": M["hair_teacher"], "top": M["cardigan"], "bottom": M["skirt_navy"],
               "shoe": M["shoe_brown"], "eye": M["eye"], "skirt": True, "hair_style": "bun"}
    person(root, "teacher", (2.0, 2.75), 0.0, teacher, pose="point", point_side=-1)
    # 生徒は黒板（+Y）を向いて座る。椅子は机の 0.55 m 手前
    boy = {"skin": M["skin"], "hair": M["hair_black"], "top": M["shirt_yellow"], "bottom": M["pants_navy"],
           "shoe": M["shoe_red"], "eye": M["eye"]}
    girl = {"skin": M["skin"], "hair": M["hair_brown"], "top": M["sweater_pink"], "bottom": M["skirt_navy"],
            "shoe": M["shoe_white"], "eye": M["eye"], "skirt": True, "hair_style": "long"}
    student = {"skin": M["skin"], "hair": M["hair_brown"], "top": M["shirt_white"], "bottom": M["pants_navy"],
               "shoe": M["shoe_white"], "eye": M["eye"]}
    reader = {"skin": M["skin"], "hair": M["hair_black"], "top": M["cardigan"], "bottom": M["skirt_navy"],
              "shoe": M["shoe_brown"], "eye": M["eye"], "skirt": True, "hair_style": "bun"}
    person(root, "student_raising_hand", (0.5, -0.8 - 0.6), math.pi, boy, pose="raise_hand", scale=0.9)
    person(root, "student_writing", (-1.5, 1.1 - 0.6), math.pi, girl, pose="sit", scale=0.9)
    person(root, "student_listening", (2.5, 1.1 - 0.6), math.pi, student, pose="sit", scale=0.9)
    person(root, "student_reading", (-1.5, -2.7 - 0.6), math.pi, reader, pose="sit", scale=0.9)
    return root


def build():
    make_materials()
    return build_classroom()


run("classroom", build)
