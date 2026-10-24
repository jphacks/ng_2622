"""カフェのジオラマ（3D シーン）を作り、アプリ用の USDZ と発表用の画像を書き出す。

床と奥・左の 2 面の壁だけの、断面図のような店内。奥にカウンター、左に大きな窓。難易度は「ふつう」。共通の道具は common.py。

使い方:
  blender --background --factory-startup --python scripts/scene/cafe.py -- [--out assets/scenes] [--no-render] [--samples 128]
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

rng = random.Random(404)
M: dict = {}

WALL_H = 3.2
WALL_T = 0.25
BACK_Y = HALF - WALL_T / 2      # 奥の壁（カウンター）
LEFT_X = -HALF + WALL_T / 2     # 左の壁（窓）
BACK_IN = BACK_Y - WALL_T / 2   # 奥の壁の内側の面
LEFT_IN = LEFT_X + WALL_T / 2   # 左の壁の内側の面
TABLE_Z = 0.74                  # テーブルの天板の高さ
SIT_SH = 0.98                   # 座ったときの肩の高さ（person の sit）


def make_materials() -> None:
    M.update(materials({
        "floor_a": ("#b7804c", 0.45), "floor_b": ("#a6703f", 0.45), "base": ("#d9d0c4", 0.8), "base_dark": ("#a99f92", 0.85),
        "wall": ("#f4ead9", 0.85), "wainscot": ("#6f4a30", 0.55), "trim": ("#5a3a24", 0.5),
        "counter_wood": ("#7a4f32", 0.5), "marble": ("#f4f2ee", 0.25), "shelf": ("#8a5a35", 0.55),
        "board": ("#2c3330", 0.85), "chalk": ("#f4f4ef", 0.9), "chalk_y": ("#ffe58a", 0.9), "chalk_p": ("#ffb3c7", 0.9),
        "steel": ("#c4cad1", 0.25), "black": ("#26262b", 0.4), "dark": ("#2a2a30", 0.4),
        "cup": ("#ffffff", 0.3), "cup_blue": ("#7fa7d9", 0.35), "coffee": ("#4a2a17", 0.15), "latte": ("#c99a6a", 0.3),
        "jar": ("#d8ecf0", 0.1), "beans": ("#5a3420", 0.6),
        "cake_sponge": ("#f6dfa8", 0.7), "cream": ("#fffaf2", 0.55), "strawberry": ("#e8343f", 0.35),
        "choco": ("#5a3424", 0.5), "matcha": ("#9cc46a", 0.6), "plate": ("#ffffff", 0.3), "tart": ("#e8a94f", 0.6),
        "table": ("#9a6a42", 0.4), "table_leg": ("#2a2a30", 0.4), "chair": ("#c48a55", 0.5), "cushion": ("#4f7d5a", 0.8),
        "pot": ("#d9784f", 0.7), "pot_white": ("#f2efe8", 0.6), "leaf": ("#3f9a3a", 0.6), "leaf2": ("#5cb848", 0.6),
        "frame_wood": ("#8a5a35", 0.5), "art_a": ("#f2b45a", 0.7), "art_b": ("#5aa0c8", 0.7), "art_c": ("#e8787a", 0.7),
        "laptop": ("#b9bec6", 0.3), "keys": ("#3a3d44", 0.5),
        "register": ("#3a3d44", 0.4), "receipt": ("#ffffff", 0.6),
        "dog": ("#e3b07a", 0.8), "dog_white": ("#f6efe4", 0.8), "dog_ear": ("#b9824e", 0.8),
        "skin": ("#f6caa6", 0.55), "eye": ("#2a211c", 0.3), "cheek": ("#f59a9a", 0.7), "mouth": ("#a8463d", 0.5),
        "hair_brown": ("#5a3a22", 0.6), "hair_black": ("#2a1f1a", 0.6), "hair_red": ("#a8502e", 0.6), "hair_blond": ("#e3b45a", 0.6),
        "shirt_white": ("#f7f7f2", 0.7), "apron_black": ("#2f3138", 0.7), "apron_green": ("#2f7d55", 0.7), "pants_black": ("#2b2d33", 0.7),
        "shoe_black": ("#222226", 0.5), "shoe_brown": ("#6b4428", 0.5), "shoe_white": ("#f2f2f2", 0.5),
        "sweater_mustard": ("#e0a83a", 0.8), "jeans": ("#3d5a8a", 0.8),
        "knit_lilac": ("#b49ad9", 0.8), "skirt_gray": ("#6a6f78", 0.8),
        "shirt_stripe": ("#5a8fd6", 0.7), "chinos": ("#c9b38a", 0.7),
        "dress_red": ("#e05a5f", 0.75), "tights": ("#f2efe8", 0.7),
    }))
    M["sky"] = material("sky", "#bfe2ff", 0.2, emit=0.9)
    M["case_glass"] = material("case_glass", "#eef8ff", 0.02, trans=0.92, alpha=0.25)
    M["lamp"] = material("lamp", "#ffd98a", 0.2, emit=10.0)
    M["screen"] = material("screen", "#9fd0ff", 0.2, emit=1.5)
    M["spill"] = material("spill", "#4a2a17", 0.03, coat=1.0)


# ---------- 部屋 ----------

def build_room(root):
    p = Part("room")
    p.slab(SIZE, 0.0, 0.2, 0.35, M["base"])
    p.slab(SIZE - 0.2, -0.2, 0.45, 0.3, M["base_dark"])
    planks = 18
    for i in range(planks):
        x = -HALF + 0.3 + (SIZE - 0.6) * (i + 0.5) / planks
        # 板は長さをずらして継ぎ目を作る
        y = -HALF + 0.3
        k = 0
        while y < HALF - 0.3:
            length = min(rng.uniform(1.2, 2.4), HALF - 0.3 - y)
            p.box(((SIZE - 0.6) / planks - 0.012, length - 0.012, 0.02), (x, y + length / 2, 0.01),
                  M["floor_a"] if (i + k) % 2 else M["floor_b"])
            y += length
            k += 1
    # 奥と左の壁。下半分は木の腰板
    p.box((SIZE, WALL_T, WALL_H), (0, BACK_Y, WALL_H / 2), M["wall"])
    p.box((WALL_T, SIZE - WALL_T, WALL_H), (LEFT_X, -WALL_T / 2, WALL_H / 2), M["wall"])
    p.box((SIZE - WALL_T, 0.04, 1.0), (WALL_T / 2, BACK_IN - 0.02, 0.5), M["wainscot"])
    p.box((0.04, SIZE - WALL_T, 1.0), (LEFT_IN + 0.02, -WALL_T / 2, 0.5), M["wainscot"])
    p.box((SIZE - WALL_T, 0.08, 0.05), (WALL_T / 2, BACK_IN - 0.04, 1.02), M["trim"])
    p.box((0.08, SIZE - WALL_T, 0.05), (LEFT_IN + 0.04, -WALL_T / 2, 1.02), M["trim"])
    p.box((SIZE, WALL_T + 0.06, 0.1), (0, BACK_Y, WALL_H + 0.05), M["trim"])
    p.box((WALL_T + 0.06, SIZE, 0.1), (LEFT_X, 0, WALL_H + 0.05), M["trim"])
    p.finish(root)


def build_windows(root):
    """左の壁の大きな窓。窓台に小さな鉢植え。"""
    p = Part("windows")
    x = LEFT_IN
    for cy in (-2.0, 0.6):
        p.box((0.02, 2.0, 1.55), (x + 0.01, cy, 1.95), M["sky"])
        for dy in (-1.0, 0, 1.0):
            p.box((0.1, 0.07, 1.63), (x + 0.03, cy + dy, 1.95), M["trim"], bevel=0.01)
        for dz in (-0.78, 0.78):
            p.box((0.1, 2.07, 0.07), (x + 0.03, cy, 1.95 + dz), M["trim"], bevel=0.01)
        p.box((0.24, 2.1, 0.05), (x + 0.1, cy, 1.16), M["trim"], bevel=0.01)
        for dy in (-0.6, 0.55):
            p.cyl(0.08, 0.06, 0.13, (x + 0.11, cy + dy, 1.25), M["pot_white"], segs=14)
            p.blob(0.1, (x + 0.11, cy + dy, 1.4), M["leaf2"], bumpy=0.35, subdiv=2, seed=cy + dy)
    p.finish(root)


def build_counter(root):
    """奥のカウンター。木の前板と大理石の天板。上にケーキのケース・レジ・エスプレッソマシン。"""
    p = Part("counter")
    x0, x1 = -1.2, 3.4
    cx, w = (x0 + x1) / 2, x1 - x0
    cy, d = 2.95, 0.7
    p.box((w, d, 1.0), (cx, cy, 0.5), M["counter_wood"], bevel=0.02)
    p.box((w + 0.08, d + 0.08, 0.06), (cx, cy, 1.03), M["marble"], bevel=0.015)
    # 前板の縦の溝
    for k in range(int(w / 0.3)):
        p.box((0.02, 0.02, 0.85), (x0 + 0.15 + k * 0.3, cy - d / 2 - 0.005, 0.5), M["trim"])
    p.box((w, 0.06, 0.08), (cx, cy - d / 2 + 0.03, 0.04), M["trim"])
    p.finish(root)


def cake_slice(p, loc, rot_z, kind):
    """三角のケーキ。kind は strawberry / choco / matcha。"""
    x, y, z = loc
    body = {"strawberry": M["cake_sponge"], "choco": M["choco"], "matcha": M["matcha"]}[kind]
    top = {"strawberry": M["cream"], "choco": M["choco"], "matcha": M["cream"]}[kind]
    r = 0.09
    pts = [Vector((x, y, 0)), Vector((x + math.cos(rot_z) * r, y + math.sin(rot_z) * r, 0)),
           Vector((x + math.cos(rot_z + 0.8) * r, y + math.sin(rot_z + 0.8) * r, 0))]
    for z0, h, mat in ((z, 0.035, body), (z + 0.035, 0.012, M["cream"]), (z + 0.047, 0.035, body), (z + 0.082, 0.012, top)):
        bot = [v + Vector((0, 0, z0)) for v in pts]
        up = [v + Vector((0, 0, z0 + h)) for v in pts]
        p.poly(bot[::-1], mat)
        p.poly(up, mat)
        for k in range(3):
            p.poly((bot[k], bot[(k + 1) % 3], up[(k + 1) % 3], up[k]), mat)
    c = sum(pts, Vector()) / 3
    if kind == "strawberry":
        p.sphere(0.022, (c.x, c.y, z + 0.11), M["strawberry"], scale=(1, 1, 1.2), segs=10)
    elif kind == "choco":
        p.box((0.03, 0.005, 0.02), (c.x, c.y, z + 0.1), M["cream"])


def build_cake_case(root, loc):
    """ガラスのケーキのショーケース（2 段）。"""
    p = Part("cake_case")
    w, d, h = 1.2, 0.5, 0.48
    p.box((w, d, 0.04), (0, 0, 0.02), M["counter_wood"], bevel=0.01)
    p.box((w - 0.04, d - 0.04, 0.015), (0, 0, 0.24), M["case_glass"])
    kinds = ["strawberry", "choco", "matcha", "strawberry", "choco"]
    for row, z in enumerate((0.04, 0.25)):
        for k in range(4):
            x = -0.42 + k * 0.28
            p.cyl(0.09, 0.09, 0.01, (x, 0.0, z + 0.005), M["plate"], segs=20, smooth=False)
            if row == 0 and k == 3:   # タルト
                p.cyl(0.08, 0.075, 0.04, (x, 0.0, z + 0.03), M["tart"], segs=20)
                for j in range(5):
                    a = j / 5 * math.tau
                    p.sphere(0.018, (x + math.cos(a) * 0.045, math.sin(a) * 0.045, z + 0.06), M["strawberry"], segs=8)
            else:
                cake_slice(p, (x - 0.03, -0.03, z + 0.01), 0.3 + k, kinds[(k + row) % len(kinds)])
    p.box((w, d, h), (0, 0, h / 2 + 0.04), M["case_glass"], bevel=0.01)
    p.finish(root, loc=loc)


def build_espresso(root, loc, rot_z):
    """エスプレッソマシン。湯気の出るカップ付き。"""
    p = Part("espresso_machine")
    p.box((0.7, 0.45, 0.5), (0, 0, 0.25), M["steel"], bevel=0.03)
    p.box((0.72, 0.47, 0.06), (0, 0, 0.52), M["black"], bevel=0.02)
    p.box((0.62, 0.02, 0.18), (0, -0.23, 0.38), M["black"], bevel=0.01)
    for sx in (-1, 1):
        p.cyl(0.04, 0.035, 0.08, (sx * 0.16, -0.18, 0.22), M["black"], segs=12)
        p.limb((sx * 0.16, -0.22, 0.22), (sx * 0.16, -0.38, 0.24), 0.018, 0.018, M["black"], segs=8)
        p.cyl(0.05, 0.04, 0.08, (sx * 0.16, -0.2, 0.04), M["cup"], segs=14)
    p.box((0.6, 0.15, 0.02), (0, -0.18, 0.01), M["black"])
    for k in range(5):   # 上に並べたカップ
        p.cyl(0.05, 0.04, 0.07, (-0.24 + k * 0.12, 0.05, 0.585), M["cup_blue" if k % 2 else "cup"], segs=14)
    p.finish(root, loc=loc, rot_z=rot_z)


def build_register(root, loc, rot_z):
    p = Part("cash_register")
    p.box((0.38, 0.32, 0.1), (0, 0, 0.05), M["register"], bevel=0.02)
    p.box((0.3, 0.04, 0.2), (0, 0.06, 0.2), M["register"], rot=(-0.3, 0, 0), bevel=0.01)
    p.box((0.26, 0.01, 0.15), (0, 0.035, 0.2), M["screen"], rot=(-0.3, 0, 0))
    p.box((0.08, 0.01, 0.12), (0.12, -0.12, 0.13), M["receipt"])
    p.finish(root, loc=loc, rot_z=rot_z)


def build_back_wall(root):
    """奥の壁の黒板のメニュー、棚（マグとコーヒー豆のびん）、額の絵。"""
    p = Part("menu_board")
    y = BACK_IN
    bx, bz = 0.3, 2.25
    p.box((1.9, 0.06, 1.0), (bx, y - 0.03, bz), M["frame_wood"], bevel=0.02)
    p.box((1.8, 0.04, 0.9), (bx, y - 0.06, bz), M["board"])
    # 見出し（コーヒーカップの絵）と、メニューの行
    p.cyl(0.07, 0.055, 0.1, (bx - 0.65, y - 0.085, bz + 0.3), M["chalk"], rot=(math.pi / 2, 0, 0), segs=12)
    for row in range(5):
        z = bz + 0.3 - row * 0.15
        x0 = bx - 0.5
        w = rng.uniform(0.6, 0.9)
        p.box((w, 0.01, 0.035), (x0 + w / 2, y - 0.085, z), [M["chalk_y"], M["chalk"], M["chalk"], M["chalk_p"], M["chalk"]][row])
        p.box((0.12, 0.01, 0.035), (bx + 0.72, y - 0.085, z), M["chalk"])
    p.finish(root)

    q = Part("shelves")
    for z in (1.75, 2.25):
        q.box((1.3, 0.25, 0.04), (2.6, y - 0.13, z), M["shelf"], bevel=0.008)
        for sx in (-1, 1):
            q.box((0.04, 0.2, 0.12), (2.6 + sx * 0.55, y - 0.1, z - 0.07), M["shelf"])
    for k in range(5):
        q.cyl(0.055, 0.05, 0.1, (2.08 + k * 0.26, y - 0.13, 1.82), M["cup_blue" if k % 2 else "cup"], segs=14)
        q.limb((2.08 + k * 0.26 + 0.05, y - 0.13, 1.84), (2.08 + k * 0.26 + 0.08, y - 0.13, 1.8), 0.012, 0.012, M["cup_blue" if k % 2 else "cup"], segs=6)
    for k in range(4):
        x = 2.15 + k * 0.3
        h = rng.uniform(0.18, 0.26)
        q.cyl(0.07, 0.07, h * 0.7, (x, y - 0.13, 2.27 + h * 0.35), M["beans"], segs=14)
        q.cyl(0.075, 0.075, h, (x, y - 0.13, 2.27 + h / 2), M["jar"], segs=14)
        q.cyl(0.078, 0.078, 0.04, (x, y - 0.13, 2.27 + h + 0.02), M["shelf"], segs=14)
    q.finish(root)

    r = Part("pictures")
    for x, z, w, h, art in ((-2.6, 2.1, 0.7, 0.9, M["art_a"]), (-1.6, 2.25, 0.55, 0.55, M["art_b"])):
        r.box((w, 0.05, h), (x, y - 0.025, z), M["frame_wood"], bevel=0.015)
        r.box((w - 0.12, 0.02, h - 0.12), (x, y - 0.055, z), M["cream"])
        r.sphere(min(w, h) * 0.25, (x, y - 0.06, z), art, scale=(1, 0.08, 1), segs=16)
    r.box((0.04, 0.6, 0.8), (LEFT_IN + 0.025, 2.3, 2.15), M["frame_wood"], bevel=0.015)
    r.box((0.02, 0.48, 0.68), (LEFT_IN + 0.05, 2.3, 2.15), M["cream"])
    r.sphere(0.16, (LEFT_IN + 0.06, 2.3, 2.1), M["art_c"], scale=(0.08, 1, 1.3), segs=16)
    r.finish(root)


def build_lamps(root):
    """カウンターの上の梁と、つり下げたランプ。"""
    p = Part("hanging_lamps")
    y = 2.75
    end = 3.7
    p.box((end - LEFT_IN, 0.14, 0.14), ((LEFT_IN + end) / 2, y, WALL_H - 0.07), M["trim"])
    p.box((0.14, 0.14, WALL_H), (end, y, WALL_H / 2), M["trim"])   # 梁を支える柱
    for x in (-0.6, 0.9, 2.4):
        p.limb((x, y, WALL_H - 0.14), (x, y, 2.25), 0.008, 0.008, M["black"], segs=6)
        p.cyl(0.05, 0.22, 0.24, (x, y, 2.13), M["black"], segs=20)
        p.sphere(0.09, (x, y, 2.02), M["lamp"], segs=14)
    p.finish(root)


def build_table(root, name, loc, chairs):
    """丸いテーブル。chairs は椅子の向き（テーブルの中心から見た角度）の一覧。"""
    p = Part(name)
    p.cyl(0.45, 0.45, 0.04, (0, 0, TABLE_Z - 0.02), M["table"], segs=32)
    p.cyl(0.04, 0.04, TABLE_Z - 0.04, (0, 0, (TABLE_Z - 0.04) / 2), M["table_leg"], segs=10)
    p.cyl(0.25, 0.28, 0.03, (0, 0, 0.015), M["table_leg"], segs=20)
    p.finish(root, loc=loc)
    for k, a in enumerate(chairs):
        build_chair(root, f"{name}_chair_{k + 1}", (loc[0] + math.cos(a) * 0.62, loc[1] + math.sin(a) * 0.62), a - math.pi / 2)


def build_chair(root, name, loc, rot_z):
    """木の椅子。正面は -Y（座った人と同じ向き）。"""
    p = Part(name)
    p.box((0.42, 0.42, 0.04), (0, 0, 0.45), M["chair"], bevel=0.012)
    p.box((0.38, 0.38, 0.03), (0, 0, 0.48), M["cushion"], bevel=0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.02, 0.018, 0.45, (sx * 0.17, sy * 0.17, 0.225), M["chair"], segs=8)
        p.cyl(0.02, 0.02, 0.5, (sx * 0.17, 0.19, 0.72), M["chair"], segs=8)
    p.box((0.38, 0.03, 0.14), (0, 0.19, 0.88), M["chair"], bevel=0.01)
    p.box((0.38, 0.03, 0.05), (0, 0.19, 0.68), M["chair"], bevel=0.01)
    p.finish(root, loc=loc, rot_z=rot_z)


def cup(p, loc, saucer=True, drink="coffee"):
    x, y, z = loc
    if saucer:
        p.cyl(0.07, 0.06, 0.012, (x, y, z + 0.006), M["cup"], segs=18, smooth=False)
        z += 0.012
    p.cyl(0.042, 0.034, 0.075, (x, y, z + 0.0375), M["cup"], segs=16)
    p.cyl(0.037, 0.037, 0.005, (x, y, z + 0.072), M[drink], segs=16, smooth=False)
    p.limb((x + 0.04, y, z + 0.055), (x + 0.065, y, z + 0.03), 0.01, 0.01, M["cup"], segs=6)


def build_table_items(root):
    # 窓ぎわのテーブル: ノートパソコンとラテ
    p = Part("laptop")
    lx, ly = -2.75, 0.75
    p.box((0.36, 0.25, 0.015), (lx, ly - 0.02, TABLE_Z + 0.008), M["laptop"], bevel=0.004)
    p.box((0.3, 0.14, 0.004), (lx, ly - 0.05, TABLE_Z + 0.017), M["keys"])
    p.box((0.36, 0.015, 0.24), (lx, ly - 0.15 + 0.0, TABLE_Z + 0.13), M["laptop"], rot=(-0.25, 0, 0), bevel=0.004)
    p.box((0.32, 0.005, 0.2), (lx, ly - 0.14, TABLE_Z + 0.13), M["screen"], rot=(-0.25, 0, 0))
    p.sphere(0.02, (lx, ly - 0.16, TABLE_Z + 0.14), M["cup"], scale=(1, 0.3, 1), segs=10)
    cup(p, (lx + 0.3, ly + 0.05, TABLE_Z), drink="latte")
    p.finish(root)
    # 真ん中のテーブル: 倒れたカップと、こぼれたコーヒー（テーブルから床へたれる）
    q = Part("spilled_coffee")
    sx, sy = 0.25, -0.75
    q.cyl(0.07, 0.06, 0.012, (sx + 0.08, sy + 0.05, TABLE_Z + 0.006), M["cup"], segs=18, smooth=False)   # 残ったソーサー
    # 横倒しのカップ。口を手前（テーブルの端）に向ける
    cup_x, cup_y = sx - 0.03, sy - 0.12
    q.cyl(0.042, 0.034, 0.09, (cup_x, cup_y, TABLE_Z + 0.043), M["cup"], rot=(math.pi / 2, 0, 0.0), segs=18)
    q.cyl(0.036, 0.036, 0.004, (cup_x, cup_y - 0.046, TABLE_Z + 0.043), M["coffee"], rot=(math.pi / 2, 0, 0), segs=18, smooth=False)
    q.limb((cup_x + 0.04, cup_y + 0.0, TABLE_Z + 0.07), (cup_x + 0.065, cup_y + 0.02, TABLE_Z + 0.045), 0.01, 0.01, M["cup"], segs=6)
    # カップの口からテーブルの端まで広がるコーヒー
    edge_y = sy - 0.43
    q.blob(1.0, (cup_x - 0.01, (cup_y + edge_y) / 2 + 0.02, TABLE_Z + 0.003), M["spill"], scale=(0.14, (cup_y - edge_y) / 2 + 0.02, 0.005),
           bumpy=0.3, subdiv=3, seed=2)
    # 端から床へ流れ落ちる筋（少し外へふくらむ）と、まわりのしずく
    stream = [(cup_x - 0.02, edge_y - 0.01, TABLE_Z + 0.003), (cup_x - 0.02, edge_y - 0.05, TABLE_Z - 0.06),
              (cup_x - 0.02, edge_y - 0.08, TABLE_Z - 0.25), (cup_x - 0.02, edge_y - 0.095, TABLE_Z - 0.48),
              (cup_x - 0.02, edge_y - 0.1, 0.02)]
    for k, (a, b) in enumerate(zip(stream, stream[1:])):
        q.limb(a, b, 0.024 - k * 0.003, 0.021 - k * 0.003, M["spill"], segs=10)
        q.sphere(0.021 - k * 0.003, b, M["spill"], segs=10)
    for dx, dy, z in ((0.05, -0.03, 0.4), (-0.06, -0.06, 0.25), (0.03, -0.09, 0.12), (-0.03, -0.02, 0.55)):
        q.sphere(0.012, (cup_x - 0.02 + dx, edge_y - 0.08 + dy, z), M["spill"], scale=(1, 1, 1.5), segs=8)
    # 床の水たまりと、はねたしずく
    fx, fy = cup_x - 0.02, edge_y - 0.12
    q.blob(1.0, (fx, fy, 0.022), M["spill"], scale=(0.32, 0.24, 0.005), bumpy=0.35, subdiv=3, seed=5)
    for k in range(10):
        a = k / 10 * math.tau
        q.sphere(0.012, (fx + math.cos(a) * 0.12, fy + math.sin(a) * 0.1, 0.05 + (k % 3) * 0.02), M["spill"], segs=8)
    q.cyl(0.08, 0.08, 0.012, (sx + 0.15, sy - 0.05, TABLE_Z + 0.006), M["plate"], segs=18, smooth=False)
    cake_slice(q, (sx + 0.12, sy - 0.08, TABLE_Z + 0.012), 1.0, "choco")
    q.finish(root)
    # 手前のテーブル: ケーキとジュース、お母さんのコーヒー
    r = Part("cake_table_items")
    tx, ty = -1.25, -2.1
    r.cyl(0.09, 0.08, 0.012, (tx - 0.12, ty - 0.02, TABLE_Z + 0.006), M["plate"], segs=18, smooth=False)
    cake_slice(r, (tx - 0.14, ty - 0.05, TABLE_Z + 0.012), 0.2, "strawberry")
    r.limb((tx - 0.02, ty - 0.1, TABLE_Z + 0.012), (tx + 0.02, ty - 0.02, TABLE_Z + 0.012), 0.006, 0.006, M["steel"], segs=4)
    cup(r, (tx + 0.12, ty + 0.18, TABLE_Z))
    r.cyl(0.04, 0.035, 0.14, (tx + 0.18, ty - 0.12, TABLE_Z + 0.07), M["jar"], segs=14)
    r.cyl(0.036, 0.032, 0.1, (tx + 0.18, ty - 0.12, TABLE_Z + 0.055), M["tart"], segs=14)
    r.limb((tx + 0.19, ty - 0.12, TABLE_Z + 0.08), (tx + 0.21, ty - 0.13, TABLE_Z + 0.2), 0.006, 0.006, M["strawberry"], segs=4)
    r.finish(root)


def build_dog(root, loc, rot_z):
    """テーブルの下で丸くなって寝ている犬。"""
    p = Part("dog")
    p.sphere(0.2, (0, 0, 0.13), M["dog"], scale=(1.25, 0.95, 0.65))
    p.sphere(0.12, (-0.2, -0.1, 0.13), M["dog"], scale=(1, 1, 0.85))
    p.sphere(0.07, (-0.27, -0.2, 0.1), M["dog_white"], scale=(1, 1.2, 0.8), segs=14)
    p.sphere(0.022, (-0.29, -0.28, 0.12), M["dark"], segs=8)
    for sx in (-1, 1):
        p.box((0.045, 0.012, 0.01), (-0.2 + sx * 0.05, -0.205, 0.17), M["dark"], rot=(0, 0, 0.6))   # 閉じた目
    p.sphere(0.07, (-0.12, -0.04, 0.2), M["dog_ear"], scale=(0.6, 1, 0.4), rot=(0, 0, 0.4), segs=12)
    p.sphere(0.07, (-0.3, 0.02, 0.18), M["dog_ear"], scale=(0.6, 1, 0.4), rot=(0, 0, -0.4), segs=12)
    for x in (-0.1, 0.0):
        p.sphere(0.05, (x, -0.2, 0.04), M["dog_white"], scale=(1, 1.4, 0.7), segs=10)
    for k in range(6):
        a = k / 6 * 1.6
        p.sphere(0.045 - k * 0.003, (0.22 - math.sin(a) * 0.15, -0.05 - (1 - math.cos(a)) * 0.2, 0.06), M["dog"], segs=10)
    p.finish(root, loc=loc, rot_z=rot_z)


def build_tray(root, loc, rot_z, hand):
    """店員がかかげるトレーと、2 つのコーヒー。hand は手の位置（店員のローカル座標）。"""
    p = Part("tray")
    x, y, z = hand
    p.cyl(0.22, 0.22, 0.02, (x, y, z + 0.03), M["steel"], segs=28)
    p.cyl(0.23, 0.23, 0.025, (x, y, z + 0.035), M["steel"], segs=28)
    cup(p, (x - 0.08, y + 0.04, z + 0.048))
    cup(p, (x + 0.09, y - 0.05, z + 0.048), drink="latte")
    p.finish(root, loc=loc, rot_z=rot_z)


def build_apron(root, name, loc, rot_z, mat, hip_z=0.8, scale=1.0):
    """エプロン（人の前に重ねる）。"""
    p = Part(name)
    p.box((0.34, 0.03, 0.55), (0, -0.175, hip_z - 0.05), mat, bevel=0.01)
    p.box((0.26, 0.03, 0.3), (0, -0.17, hip_z + 0.35), mat, rot=(0.08, 0, 0), bevel=0.01)
    p.limb((-0.19, -0.1, hip_z + 0.15), (0.19, -0.1, hip_z + 0.15), 0.015, 0.015, mat, segs=6)
    p.finish(root, loc=loc, rot_z=rot_z, scale=scale)


def build_plant(root, name, loc, size=1.0):
    p = Part(name)
    p.cyl(0.24 * size, 0.18 * size, 0.42 * size, (0, 0, 0.21 * size), M["pot_white"], segs=18)
    p.cyl(0.22 * size, 0.22 * size, 0.03, (0, 0, 0.41 * size), M["shelf"], segs=18)
    p.cyl(0.03, 0.03, 0.8 * size, (0, 0, 0.8 * size), M["shelf"], segs=8)
    for i, (x, y, z, r) in enumerate([(0, 0, 1.25, 0.38), (0.24, 0.08, 1.0, 0.3), (-0.22, -0.1, 1.05, 0.3), (0.02, 0.12, 1.55, 0.28), (-0.1, -0.2, 1.4, 0.24)]):
        p.blob(r * size, (x * size, y * size, z * size), M["leaf"] if i % 2 else M["leaf2"], bumpy=0.3, subdiv=3, seed=i * 2.7 + loc[0])
    p.finish(root, loc=loc)


def build_empty_table_items(root, loc):
    """空いているテーブルの花びんとメニュー立て。"""
    p = Part("table_right_items")
    x, y = loc
    p.cyl(0.05, 0.04, 0.16, (x, y, TABLE_Z + 0.08), M["jar"], segs=14)
    for k in range(3):
        a = k / 3 * math.tau
        top = (x + math.cos(a) * 0.05, y + math.sin(a) * 0.05, TABLE_Z + 0.3)
        p.limb((x, y, TABLE_Z + 0.1), top, 0.006, 0.006, M["leaf"], segs=4)
        p.blob(0.035, top, [M["strawberry"], M["chalk_y"], M["chalk_p"]][k], bumpy=0.3, subdiv=1, seed=k)
    p.box((0.14, 0.05, 0.2), (x + 0.18, y - 0.1, TABLE_Z + 0.1), M["board"], rot=(0, 0, 0.4), bevel=0.01)
    p.finish(root)


def build_coat_rack(root, loc):
    """入口の近くのコートかけ。コートと傘をかけている。"""
    p = Part("coat_rack")
    p.cyl(0.22, 0.25, 0.04, (0, 0, 0.02), M["trim"], segs=20)
    p.cyl(0.025, 0.025, 1.75, (0, 0, 0.9), M["trim"], segs=10)
    p.sphere(0.04, (0, 0, 1.8), M["trim"], segs=10)
    for k in range(4):
        a = k / 4 * math.tau
        p.limb((0, 0, 1.6), (math.cos(a) * 0.16, math.sin(a) * 0.16, 1.7), 0.012, 0.012, M["trim"], segs=6)
    p.box((0.3, 0.12, 0.7), (0.12, 0.0, 1.25), M["apron_green"], rot=(0, 0.08, 0), bevel=0.05)   # コート
    p.sphere(0.05, (0.12, 0, 1.6), M["apron_green"], segs=10)
    p.limb((-0.14, 0.05, 1.58), (-0.2, 0.08, 0.6), 0.045, 0.015, M["strawberry"], segs=8)       # たたんだ傘
    p.finish(root, loc=loc)


def build_cafe() -> bpy.types.Object:
    root = bpy.data.objects.new("cafe", None)
    bpy.context.scene.collection.objects.link(root)
    build_room(root)
    build_windows(root)
    build_counter(root)
    build_cake_case(root, (-0.35, 2.85, 1.06))
    build_register(root, (1.15, 2.8, 1.06), 0.0)
    build_espresso(root, (2.75, 3.0, 1.06), -2.5)   # 正面をバリスタに向ける
    build_back_wall(root)
    build_lamps(root)
    build_plant(root, "plant_corner", (-3.35, 3.35), 1.1)
    build_plant(root, "plant_front", (3.35, -3.3), 0.9)

    # テーブルは 3 つ。椅子の角度はテーブルの中心から見た向き（+Y が奥）
    build_table(root, "table_window", (-2.75, 0.75), [math.pi / 2])
    build_table(root, "table_middle", (0.25, -0.75), [math.pi / 2, -0.2])
    build_table(root, "table_front", (-1.25, -2.1), [math.pi / 2, math.pi])
    build_table(root, "table_right", (2.35, 0.55), [math.pi * 0.75, -math.pi * 0.25])
    build_table_items(root)
    build_empty_table_items(root, (2.35, 0.55))
    build_coat_rack(root, (3.4, -1.9))

    face = {"skin": M["skin"], "eye": M["eye"], "cheek": M["cheek"], "mouth": M["mouth"]}
    chair_off = 0.62

    # 窓ぎわでノートパソコンを打つ女性と、足もとで寝ている犬
    woman = {**face, "hair": M["hair_red"], "top": M["sweater_mustard"], "bottom": M["jeans"], "shoe": M["shoe_brown"], "hair_style": "bun"}
    person(root, "woman_laptop", (-2.75, 0.75 + chair_off), 0.0, woman, pose="sit", hands=[(-0.12, -0.45, -0.21), (0.12, -0.45, -0.21)])
    build_dog(root, (-2.55, 0.35), 0.4)

    # 真ん中のテーブル: コーヒーをこぼして驚く男性
    man = {**face, "hair": M["hair_black"], "top": M["shirt_stripe"], "bottom": M["chinos"], "shoe": M["shoe_brown"]}
    # 右手はカップを倒したところ（カップのすぐ後ろ）、左手は驚いて上げる
    person(root, "man_spilling", (0.25, -0.75 + chair_off), 0.0, man, pose="sit", hands=[(-0.34, -0.12, 0.28), (0.02, -0.6, -0.21)])

    # トレーにコーヒーを 2 つのせて運ぶ店員
    waiter_at = ((1.75, -1.45), -math.pi / 2 + 0.35)   # 左（テーブルのほう）へ、少し手前を向いて歩く
    waiter = {**face, "hair": M["hair_brown"], "top": M["shirt_white"], "bottom": M["pants_black"], "shoe": M["shoe_black"]}
    tray_hand = (0.24, -0.22, 0.12)
    person(root, "waiter", *waiter_at, waiter, pose="walk", hands=[(-0.26, 0.17, -0.5), tray_hand])
    build_apron(root, "waiter_apron", *waiter_at, M["apron_black"])
    build_tray(root, *waiter_at, (tray_hand[0], tray_hand[1], 1.3 + tray_hand[2]))

    # カウンターの中で、エスプレッソマシンでコーヒーをいれるバリスタ
    barista_at = ((2.0, 3.45), 0.75)
    barista = {**face, "hair": M["hair_black"], "top": M["shirt_white"], "bottom": M["pants_black"], "shoe": M["shoe_black"], "hair_style": "bun"}
    person(root, "barista", *barista_at, barista, hands=[(-0.12, -0.42, -0.12), (0.14, -0.42, -0.06)])
    build_apron(root, "barista_apron", *barista_at, M["apron_green"])

    # 手前のテーブル: ケーキを食べる女の子と、ケーキの写真をスマホで撮るお母さん
    mother = {**face, "hair": M["hair_brown"], "top": M["knit_lilac"], "bottom": M["skirt_gray"], "shoe": M["shoe_white"],
              "skirt": True, "hair_style": "long"}
    person(root, "mother_photo", (-1.25, -2.1 + chair_off), 0.0, mother, pose="sit", hands=[(-0.07, -0.32, 0.02), (0.07, -0.32, 0.02)])
    q = Part("phone")
    q.box((0.09, 0.015, 0.16), (0, -0.34, SIT_SH + 0.06), M["dark"], rot=(0.35, 0, 0), bevel=0.01)
    q.finish(root, loc=(-1.25, -2.1 + chair_off), rot_z=0.0)
    girl = {**face, "hair": M["hair_blond"], "top": M["dress_red"], "bottom": M["dress_red"], "shoe": M["shoe_white"],
            "skirt": True, "hair_style": "long"}
    girl_at = ((-1.25 - chair_off, -2.1), math.pi / 2)   # 左の椅子から +X（テーブル）を向く
    person(root, "girl_cake", *girl_at, girl, pose="sit", scale=0.75, lift=0.1, hands=[(-0.16, -0.42, -0.1), (0.12, -0.3, 0.2)])
    return root


def build():
    make_materials()
    return build_cafe()


# 窓から日が入る昼。光は少し暖かい色
ENV = {"sun_elevation": 35, "sun_rotation": 160, "sun_energy": 2.2, "sun_color": "#ffe9c8", "bg_edge": "#c9b9a6", "bg_center": "#fbf5ee"}

run("cafe", build, lens=42, env=ENV)
