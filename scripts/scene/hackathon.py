"""ハッカソン会場のジオラマ（3D）を作り、アプリ用の USDZ と確かめ用の画像を書き出す。

タイトル画面（ホーム）の企業の 3D 広告の見本で、JPHACKS が提供した場合に見立てる（遊ぶ場面ではない）。
床と奥・左の 2 面の壁だけの、断面図のような会場。奥の壁に横断幕、左の壁にホワイトボード、手前右に立体の看板、
長机が 2 つと、奥にピザと飲み物の台。共通の道具は common.py。

団体のロゴの画像や SVG は使わない。横断幕と看板の「JPHACKS」は、フォントの文字に色（JP は水色、HACKS は黒）を付けて立体にする。

使い方:
  blender --background --factory-startup --python scripts/scene/hackathon.py -- [--out assets/title] [--no-render] [--samples 128]
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HALF, REPO, SIZE, Part, material, materials, person, run  # noqa: E402

rng = random.Random(2026)
M: dict = {}

WALL_H = 3.0
WALL_T = 0.25
BACK_Y = HALF - WALL_T / 2
LEFT_X = -HALF + WALL_T / 2
BASE_R = 0.35
ROUND_CORNERS = ((-1, -1), (1, -1), (1, 1))
WALL_END = HALF - BASE_R

# 看板の字のフォント。上から順に、ある物を使う（どれも無ければ Blender の内蔵の字）
FONTS = (
    "/System/Library/Fonts/Avenir Next.ttc",             # macOS。先頭の書体が Avenir Next Bold
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",  # macOS
    "C:/Windows/Fonts/arialbd.ttf",                       # Windows
)


def make_materials() -> None:
    M.update(materials({
        "base": ("#d9d4cc", 0.8), "base_dark": ("#a9a39a", 0.85),
        "carpet_a": ("#8f9bb8", 0.95), "carpet_b": ("#8492b0", 0.95),
        "wall": ("#f3efe6", 0.85), "baseboard": ("#5d6478", 0.6),
        # 看板の色: JP の水色と HACKS の黒。ステッカーなどの差し色も水色にそろえる
        "jp_blue": ("#47a4dc", 0.5), "logo_ink": ("#231815", 0.5),
        "white": ("#ffffff", 0.5), "accent": ("#47a4dc", 0.5), "accent2": ("#4dc0ee", 0.5),
        "table": ("#f1f1ee", 0.45), "leg": ("#6c717c", 0.4), "chair": ("#3d4f7a", 0.6),
        "laptop": ("#c9ccd3", 0.3), "laptop_dark": ("#3a3d45", 0.35), "key": ("#2a2c33", 0.5),
        "board": ("#fbfbf8", 0.3), "board_frame": ("#9ea3ad", 0.4),
        "note_y": ("#ffe066", 0.8), "note_p": ("#ff9fc0", 0.8), "note_b": ("#8fd0ff", 0.8), "note_g": ("#a8e6a0", 0.8),
        "marker": ("#3a5fd9", 0.6), "marker_r": ("#e0473f", 0.6),
        "pizza_box": ("#d9b27a", 0.8), "crust": ("#e7a95a", 0.7), "cheese": ("#ffd36b", 0.6), "pepperoni": ("#c8402f", 0.6),
        "can_g": ("#36c46b", 0.3), "can_b": ("#2f6fe0", 0.3), "can_k": ("#25262b", 0.3), "bottle": ("#bfe3ff", 0.15),
        "pot": ("#d9784f", 0.7), "leaf": ("#3f9a3a", 0.7), "leaf2": ("#5cb848", 0.7),
        "skin": ("#f6caa6", 0.55), "eye": ("#2a211c", 0.3), "cheek": ("#f59a9a", 0.6), "mouth": ("#c4584f", 0.6),
        "hair_black": ("#2a1f1a", 0.6), "hair_brown": ("#5a3a22", 0.6), "hair_red": ("#8a3b22", 0.6),
        "hoodie_navy": ("#2f3b63", 0.85), "hoodie_orange": ("#ff8a2a", 0.85), "tee_white": ("#f7f7f2", 0.7),
        "tee_green": ("#2fc4a0", 0.75), "tee_yellow": ("#ffcf3a", 0.75), "cardigan": ("#b48cff", 0.8),
        "jeans": ("#3d5a8a", 0.8), "pants_dark": ("#2e3038", 0.8), "skirt": ("#4a4f63", 0.8),
        "shoe_white": ("#f2f2f2", 0.5), "shoe_red": ("#e3483c", 0.5), "shoe_dark": ("#2a2a30", 0.5),
    }))
    M["screen"] = material("screen", "#1b2540", 0.2, emit=0.6)
    M["code1"] = material("code1", "#7fe3ff", 0.3, emit=2.0)
    M["code2"] = material("code2", "#ffd36b", 0.3, emit=2.0)
    M["code3"] = material("code3", "#ff8fb3", 0.3, emit=2.0)
    M["code4"] = material("code4", "#a8f0a0", 0.3, emit=2.0)


# ---------- 文字 ----------

def load_font():
    for path in FONTS:
        if Path(path).exists():
            return bpy.data.fonts.load(path, check_existing=True)
    return None


def text(parent, name, segments, width, loc, rot, depth, bevel=0.0):
    """色を部分ごとに変えた 1 行の文字を、厚みのある形にして置く（USDZ に書き出せるよう、メッシュに直す）。

    segments は [(文字, マテリアル), ...] で、つなげて 1 行にする（JP を水色、HACKS を黒）。width は字の横幅（m）、
    depth は厚み（m）。原点は字の真ん中。rot が (90 度, 0, 0) なら、字は正面（-Y）を向いて立つ。
    """
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = "".join(s for s, _ in segments)
    font = load_font()
    if font:
        curve.font = font
    curve.size = 1.0
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    mats = []
    i = 0
    for s, mat in segments:
        if mat not in mats:
            mats.append(mat)
            curve.materials.append(mat)
        for ch in curve.body_format[i:i + len(s)]:
            ch.material_index = mats.index(mat)
        i += len(s)
    tmp = bpy.data.objects.new(name + "_tmp", curve)
    bpy.context.scene.collection.objects.link(tmp)
    # 大きさは字の幅で決める。厚みと面取りは大きさを決めてからかける
    depsgraph = bpy.context.evaluated_depsgraph_get()
    flat = bpy.data.meshes.new_from_object(tmp.evaluated_get(depsgraph))
    xs = [v.co.x for v in flat.vertices]
    k = width / (max(xs) - min(xs))
    bpy.data.meshes.remove(flat)
    curve.size = k
    curve.extrude = max(depth / 2 - bevel, 0.0)
    curve.bevel_depth = bevel
    curve.bevel_resolution = 2
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(tmp.evaluated_get(depsgraph))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(curve)
    # 字の真ん中を原点にする（align_y の CENTER は行の真ん中で、大文字の真ん中とずれる）
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    mesh.transform(Matrix.Translation((-(max(xs) + min(xs)) / 2, -(max(ys) + min(ys)) / 2, 0)))
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def height(obj) -> float:
    """text() で作った字の高さ（立てる前の y の幅）。"""
    ys = [v.co.y for v in obj.data.vertices]
    return max(ys) - min(ys)


# ---------- 部屋 ----------

def build_room(root):
    p = Part("room")
    p.slab(SIZE, 0.0, 0.2, BASE_R, M["base"], corners=ROUND_CORNERS)
    p.slab(SIZE - 0.2, -0.2, 0.45, BASE_R - 0.05, M["base_dark"], corners=ROUND_CORNERS)
    # タイルカーペット
    n = 8
    step = (SIZE - 0.6) / n
    for i in range(n):
        for j in range(n):
            x = -HALF + 0.3 + step * (i + 0.5)
            y = -HALF + 0.3 + step * (j + 0.5)
            p.box((step - 0.02, step - 0.02, 0.02), (x + 0.05, y + 0.05, 0.01), M["carpet_a"] if (i + j) % 2 else M["carpet_b"])
    back_len = HALF + WALL_END
    side_len = WALL_END + HALF - WALL_T
    p.box((back_len, WALL_T, WALL_H), (WALL_END - back_len / 2, BACK_Y, WALL_H / 2), M["wall"])
    p.box((WALL_T, side_len, WALL_H), (LEFT_X, -WALL_END + side_len / 2, WALL_H / 2), M["wall"])
    p.box((back_len + 0.04, WALL_T + 0.04, 0.12), (WALL_END - back_len / 2, BACK_Y, 0.06), M["baseboard"])
    p.box((WALL_T + 0.04, side_len, 0.12), (LEFT_X, -WALL_END + side_len / 2 - 0.02, 0.06), M["baseboard"])
    p.finish(root)


def build_banner(root):
    """奥の壁の横断幕。水色の縁の白い幕に、JPHACKS の字。"""
    y = BACK_Y - WALL_T / 2
    p = Part("banner")
    p.box((5.0, 0.05, 1.15), (0.35, y - 0.03, 2.1), M["jp_blue"], bevel=0.03)
    p.box((4.88, 0.06, 1.03), (0.35, y - 0.035, 2.1), M["white"], bevel=0.02)
    banner = p.finish(root)
    depth = 0.04
    text(banner, "banner_logo", [("JP", M["jp_blue"]), ("HACKS", M["logo_ink"])], 4.2,
         (0.35, y - 0.065 - depth / 2, 2.1), (math.pi / 2, 0, 0), depth)


def build_whiteboard(root):
    """左の壁のホワイトボードと付せん。"""
    x = LEFT_X + WALL_T / 2
    p = Part("whiteboard")
    p.box((0.05, 2.6, 1.45), (x + 0.03, -0.9, 1.65), M["board_frame"], bevel=0.015)
    p.box((0.05, 2.5, 1.35), (x + 0.05, -0.9, 1.65), M["board"])
    notes = [M["note_y"], M["note_p"], M["note_b"], M["note_g"]]
    for col in range(4):
        for row in range(3):
            if rng.random() < 0.2:
                continue
            yy = -1.95 + col * 0.36 + rng.uniform(-0.03, 0.03)
            zz = 2.05 - row * 0.32 + rng.uniform(-0.03, 0.03)
            p.box((0.012, 0.24, 0.24), (x + 0.085, yy, zz), notes[(col + row) % 4], rot=(rng.uniform(-0.08, 0.08), 0, 0))
    # 矢印と枠（画面の流れ）
    for i in range(3):
        cy = -0.35 + i * 0.55
        p.box((0.01, 0.38, 0.26), (x + 0.082, cy, 1.95), M["marker"])
        p.box((0.012, 0.32, 0.2), (x + 0.086, cy, 1.95), M["board"])
        if i < 2:
            p.box((0.01, 0.17, 0.025), (x + 0.082, cy + 0.275, 1.95), M["marker"])
    for i in range(4):
        p.box((0.01, rng.uniform(0.5, 1.0), 0.03), (x + 0.082, -0.15 + rng.uniform(-0.1, 0.1), 1.45 - i * 0.12), M["marker_r"] if i == 0 else M["marker"])
    p.finish(root)


def laptop(p, loc, facing, stickers=True):
    """ノート PC。facing は画面を見る人のいる向き（+1 で +Y、-1 で -Y）。"""
    x, y, z = loc
    p.box((0.42, 0.3, 0.02), (x, y, z + 0.01), M["laptop"], bevel=0.006)
    p.box((0.36, 0.14, 0.004), (x, y + facing * 0.03, z + 0.022), M["key"])
    # 画面は奥（見る人の反対側）の縁から、少し後ろへ倒して立てる
    hy = y - facing * 0.15
    tilt = math.radians(14) * facing
    p.box((0.42, 0.018, 0.29), (x, hy - facing * 0.03, z + 0.155), M["laptop"], rot=(tilt, 0, 0), bevel=0.006)
    p.box((0.38, 0.004, 0.25), (x, hy - facing * 0.03 + facing * 0.011, z + 0.155), M["screen"], rot=(tilt, 0, 0))
    for k in range(6):
        w = rng.uniform(0.08, 0.26)
        mat = rng.choice([M["code1"], M["code2"], M["code3"], M["code4"]])
        p.box((w, 0.004, 0.018), (x - 0.15 + (k % 2) * 0.04 + w / 2, hy - facing * 0.03 + facing * 0.014, z + 0.25 - k * 0.035),
              mat, rot=(tilt, 0, 0))
    if stickers:
        back = hy - facing * 0.03 - facing * 0.011
        for sx, sz, mat in [(-0.1, 0.2, M["accent"]), (0.08, 0.12, M["accent2"]), (0.1, 0.22, M["white"])]:
            p.cyl(0.04, 0.04, 0.004, (x + sx, back, z + sz), mat, rot=(math.pi / 2 + tilt, 0, 0), segs=16, smooth=False)


def build_table(root, name, loc, facing, seats):
    """長机とノート PC と椅子。facing は座る人のいる側（+1 で +Y 側に座り -Y を向く）。"""
    p = Part(name)
    top = 0.74
    p.box((2.6, 0.75, 0.04), (0, 0, top), M["table"], bevel=0.01)
    for sx in (-1, 1):
        p.box((0.05, 0.6, 0.7), (sx * 1.2, 0, 0.36), M["leg"])
    for sx in seats:
        laptop(p, (sx, 0, top + 0.02), facing)
        cy = facing * 0.62
        p.box((0.44, 0.42, 0.06), (sx, cy, 0.45), M["chair"], bevel=0.02)
        p.box((0.44, 0.05, 0.42), (sx, cy + facing * 0.22, 0.75), M["chair"], bevel=0.02)
        p.cyl(0.03, 0.03, 0.4, (sx, cy, 0.22), M["leg"], segs=8)
        p.cyl(0.22, 0.22, 0.03, (sx, cy, 0.03), M["leg"], segs=5, smooth=False)
    # 机の上の飲み物と電源
    for x, mat in [(-0.95, M["can_g"]), (0.45, M["can_b"])]:
        p.cyl(0.04, 0.04, 0.13, (x, -facing * 0.22, top + 0.085), mat, segs=14)
    p.cyl(0.035, 0.03, 0.22, (1.05, -facing * 0.2, top + 0.13), M["bottle"], segs=14)
    p.box((0.3, 0.08, 0.04), (0.0, -facing * 0.28, top + 0.04), M["laptop_dark"], bevel=0.01)
    p.finish(root, loc=loc)


def build_snacks(root):
    """右奥のピザと飲み物の台。"""
    p = Part("snacks")
    top = 0.8
    p.box((1.3, 0.65, 0.04), (0, 0, top), M["table"], bevel=0.01)
    for sx in (-1, 1):
        p.box((0.05, 0.5, 0.76), (sx * 0.6, 0, 0.39), M["leg"])
    for k, (x, y) in enumerate([(-0.3, 0.0), (0.3, 0.05)]):
        p.box((0.5, 0.5, 0.05), (x, y, top + 0.045), M["pizza_box"], bevel=0.005)
        p.cyl(0.22, 0.22, 0.02, (x, y, top + 0.08), M["crust"], segs=24, smooth=False)
        p.cyl(0.195, 0.195, 0.022, (x, y, top + 0.082), M["cheese"], segs=24, smooth=False)
        for _ in range(6):
            a, r = rng.uniform(0, math.tau), rng.uniform(0.04, 0.15)
            p.cyl(0.035, 0.035, 0.01, (x + math.cos(a) * r, y + math.sin(a) * r, top + 0.097), M["pepperoni"], segs=12, smooth=False)
        if k == 0:
            p.box((0.5, 0.02, 0.45), (x, y + 0.25, top + 0.29), M["pizza_box"], rot=(-0.25, 0, 0))
    p.finish(root, loc=(2.7, 3.0))
    c = Part("cans")
    for i in range(5):
        c.cyl(0.04, 0.04, 0.13, (0.15 * i, 0, 0.065), [M["can_g"], M["can_b"], M["can_k"]][i % 3], segs=14)
    c.finish(root, loc=(3.0, 2.6, 0.82))


def build_monument(root):
    """手前右の立体の看板。白い台の上に、大きな水色の JP と、その下に黒の HACKS を立てる。"""
    sign = bpy.data.objects.new("monument", None)
    bpy.context.scene.collection.objects.link(sign)
    sign.parent = root
    sign.location = (2.75, -2.75, 0)
    sign.rotation_euler = (0, 0, math.radians(20))
    p = Part("monument_base")
    p.box((1.6, 0.5, 0.3), (0, 0, 0.15), M["white"], bevel=0.04)
    p.box((1.62, 0.52, 0.05), (0, 0, 0.3), M["jp_blue"], bevel=0.02)
    p.finish(sign)
    top = 0.325
    hacks = text(sign, "monument_hacks", [("HACKS", M["logo_ink"])], 1.4, (0, 0, 0), (math.pi / 2, 0, 0), 0.16, bevel=0.01)
    hacks.location = (0, 0, top + height(hacks) / 2)
    jp = text(sign, "monument_jp", [("JP", M["jp_blue"])], 1.5, (0, 0, 0), (math.pi / 2, 0, 0), 0.2, bevel=0.015)
    jp.location = (0, 0, top + height(hacks) + 0.06 + height(jp) / 2)


def build_plant(root, loc):
    p = Part("plant")
    p.cyl(0.2, 0.16, 0.4, (0, 0, 0.2), M["pot"], segs=16)
    for i, (dx, dy, dz, r) in enumerate([(0, 0, 0.75, 0.32), (0.15, 0.05, 0.95, 0.24), (-0.12, -0.05, 1.0, 0.22)]):
        p.blob(r, (dx, dy, dz), M["leaf"] if i % 2 else M["leaf2"], bumpy=0.3, subdiv=2, seed=i * 1.7)
    p.finish(root, loc=loc)


def build_hackathon() -> bpy.types.Object:
    root = bpy.data.objects.new("hackathon", None)
    bpy.context.scene.collection.objects.link(root)
    build_room(root)
    build_banner(root)
    build_whiteboard(root)
    build_snacks(root)
    build_monument(root)
    build_plant(root, (-3.35, 3.35))

    # 奥の机は +Y 側に座ってこちら（-Y）を向く。手前の机は -Y 側に座って奥を向き、画面がこちらから見える
    back_table, front_table = (0.6, 1.0), (0.6, -1.5)
    build_table(root, "table_back", back_table, +1, seats=(-0.75, 0.0, 0.75))
    build_table(root, "table_front", front_table, -1, seats=(-0.6, 0.6))

    def outfit(top, hair, bottom, shoe, **kw):
        return {"skin": M["skin"], "hair": M[hair], "top": M[top], "bottom": M[bottom], "shoe": M[shoe],
                "eye": M["eye"], "cheek": M["cheek"], "mouth": M["mouth"], **kw}

    typing = [(-0.17, -0.42, -0.2), (0.17, -0.42, -0.2)]
    bx, by = back_table
    person(root, "coder_1", (bx - 0.75, by + 0.62), 0.0, outfit("hoodie_navy", "hair_black", "jeans", "shoe_white"), pose="sit", hands=typing, scale=0.92)
    person(root, "coder_2", (bx + 0.0, by + 0.62), 0.0, outfit("tee_green", "hair_brown", "skirt", "shoe_red", skirt=True, hair_style="long"), pose="sit", hands=typing, scale=0.92)
    person(root, "coder_3", (bx + 0.75, by + 0.62), 0.0, outfit("tee_yellow", "hair_red", "pants_dark", "shoe_dark", hair_style="bun"), pose="raise_hand", scale=0.92)
    fx, fy = front_table
    person(root, "coder_4", (fx - 0.6, fy - 0.62), math.pi, outfit("hoodie_orange", "hair_black", "jeans", "shoe_white", hair_style="hood"), pose="sit", hands=typing, scale=0.92)
    person(root, "coder_5", (fx + 0.6, fy - 0.62), math.pi, outfit("tee_white", "hair_brown", "pants_dark", "shoe_red"), pose="sit", hands=typing, scale=0.92)
    # ホワイトボードの前で、画面の流れを指さして説明する人
    person(root, "presenter", (-3.0, -0.6), math.radians(-60), outfit("cardigan", "hair_brown", "skirt", "shoe_dark", skirt=True, hair_style="bun"), pose="point", point_side=-1)
    # ピザを取りに来た人
    person(root, "snacker", (2.1, 2.2), math.radians(-150), outfit("tee_green", "hair_black", "jeans", "shoe_white"), pose="stand")
    return root


def build():
    make_materials()
    return build_hackathon()


run("hackathon", build, out=REPO / "assets" / "title")
