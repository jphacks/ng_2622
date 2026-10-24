"""海辺のジオラマ（3D シーン）を作り、アプリ用の USDZ と発表用の画像を書き出す。

手前が砂浜、奥が海。砂浜はなだらかに下がって海に入る。難易度は「ふつう」。共通の道具は common.py。

使い方:
  blender --background --factory-startup --python scripts/scene/beach.py -- [--out assets/scenes] [--no-render] [--samples 128]
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector, noise

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HALF, SIZE, Part, material, materials, person, run  # noqa: E402

rng = random.Random(58)
M: dict = {}

SEA_Z = -0.1           # 海面の高さ
SLOPE_Y0, SLOPE_Y1 = -0.5, 1.4  # 砂浜が海へ下がり始める所と、海底に着く所
SEABED_Z = -0.55
CORNER = 0.8           # 島の角の丸み


def make_materials() -> None:
    M.update(materials({
        "sand_side": ("#d8b77c", 0.95), "base_dark": ("#9a7a52", 0.95),
        "foam": ("#ffffff", 0.4), "rock": ("#8d8d94", 0.8), "rock_dark": ("#6a6a72", 0.85),
        "bark": ("#8a6440", 0.9), "bark_ring": ("#6f4e30", 0.9), "frond": ("#3f9a3a", 0.6), "frond2": ("#5cb848", 0.6),
        "coconut": ("#6b4428", 0.7),
        "castle": ("#e3c48c", 0.95), "castle_wet": ("#c9a46a", 0.9), "flag": ("#e8484a", 0.5), "stick": ("#a8683a", 0.7),
        "bucket": ("#e8484a", 0.35), "shovel": ("#ffd23a", 0.35), "shovel_handle": ("#3f7fe0", 0.4),
        "umbrella_red": ("#e8484a", 0.5), "umbrella_white": ("#fbf6ee", 0.5), "pole": ("#f2f2f2", 0.4),
        "towel_blue": ("#3f7fe0", 0.85), "towel_white": ("#f7f4ec", 0.85),
        "mat_red": ("#e05a4f", 0.85), "mat_white": ("#fbf6ee", 0.85), "basket": ("#c98e5a", 0.8),
        "bread": ("#f2d9a6", 0.8), "crust": ("#c98a45", 0.7), "lettuce": ("#7cc24a", 0.6), "tomato": ("#e8484a", 0.5),
        "plate": ("#ffffff", 0.4), "juice": ("#ff9f2e", 0.2), "cap": ("#3f9a3a", 0.4),
        "cooler": ("#3fa7d9", 0.4), "cooler_lid": ("#f2f2f2", 0.4),
        "straw": ("#e9cf8a", 0.85), "hat_band": ("#3f7fe0", 0.6),
        "gull": ("#fbfbf8", 0.6), "gull_gray": ("#a9b0ba", 0.6), "gull_black": ("#2a2a30", 0.5), "beak": ("#ffc23a", 0.4),
        "crab": ("#e8573a", 0.45), "crab_dark": ("#b83a26", 0.5),
        "shell_pink": ("#f7b6c8", 0.5), "shell_white": ("#fff4e6", 0.5), "starfish": ("#ff8a3d", 0.7),
        "ring_red": ("#e8484a", 0.3), "ring_white": ("#fbfbf8", 0.3),
        "hull": ("#fbfbf8", 0.35), "hull_stripe": ("#3f7fe0", 0.4), "sail": ("#fffaf0", 0.6), "mast": ("#a8683a", 0.6),
        "surf": ("#ffd23a", 0.3), "surf_stripe": ("#e8484a", 0.3), "sand_print": ("#dcc08c", 0.95),
        "ball_red": ("#e8484a", 0.35), "ball_yellow": ("#ffd23a", 0.35), "ball_blue": ("#3f7fe0", 0.35), "ball_white": ("#fbfbf8", 0.35),
        "skin": ("#f6caa6", 0.55), "skin_tan": ("#d9a47a", 0.55), "eye": ("#2a211c", 0.3), "cheek": ("#f59a9a", 0.7), "mouth": ("#a8463d", 0.5),
        "hair_brown": ("#6b4428", 0.6), "hair_black": ("#2a1f1a", 0.6), "hair_blond": ("#e3b45a", 0.6),
        "tee_yellow": ("#ffcf3a", 0.7), "tee_green": ("#5cc08a", 0.7), "shorts_blue": ("#3d6fb6", 0.7), "shorts_red": ("#e05a4f", 0.7),
        "dress": ("#ff9fbf", 0.75), "aloha": ("#3fb8c8", 0.7), "sandal": ("#3f7fe0", 0.5), "swim": ("#3f7fe0", 0.5),
    }))
    M["sand"] = sand_material()
    # 海は透かして、水の下の砂浜が見えるようにする（USDZ では不透明な水色になる）
    M["sea"] = material("sea", "#2fb3c6", 0.04, ior=1.33, trans=0.75)
    M["sea_side"] = material("sea_side", "#1f8fb3", 0.05, ior=1.33, trans=0.6)


def sand_material() -> bpy.types.Material:
    """砂。画像では細かい凸凹を付ける（USDZ では色だけ）。"""
    mat = material("sand", "#f2dcaa", 0.95)
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 180.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(tex.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], nt.nodes["Principled BSDF"].inputs["Normal"])
    return mat


# ---------- 地面と海 ----------

def smooth01(t: float) -> float:
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def sand_height(x: float, y: float) -> float:
    s = smooth01((y - SLOPE_Y0) / (SLOPE_Y1 - SLOPE_Y0))
    dune = 0.035 * noise.noise(Vector((x * 0.55, y * 0.55, 0.3))) * (1 - s)
    return SEABED_Z * s + dune


def sea_height(x: float, y: float) -> float:
    return SEA_Z + 0.012 * math.sin(x * 2.6 + y * 1.3) + 0.008 * math.sin(x * 5.1 - y * 3.7)


SHORE_Y = -0.02  # 砂浜と海の境目（sand_height が SEA_Z になるあたり）


def build_island(root):
    p = Part("island")
    p.terrain(-HALF, HALF, -HALF, HALF, 0.1, sand_height, -0.9, M["sand"], M["sand_side"], CORNER, CORNER)
    p.slab(SIZE - 0.4, -0.9, 0.18, 0.6, M["base_dark"])
    p.finish(root)


def build_sea(root):
    """海。島の縁より少しだけ外に出して、横から水の層が見えるようにする。"""
    p = Part("sea")
    e = 0.015
    p.terrain(-HALF - e, HALF + e, SHORE_Y - 0.1, HALF + e, 0.1, sea_height, SEABED_Z - 0.3, M["sea"], M["sea_side"], 0.0, CORNER + e)
    p.finish(root)


def build_foam(root):
    """波打ち際の白い泡と、沖で砕ける波。"""
    p = Part("waves")
    x = -HALF + 0.15
    while x < HALF - 0.15:
        y = SHORE_Y + 0.04 * math.sin(x * 2.2) + rng.uniform(-0.03, 0.03)
        p.blob(rng.uniform(0.09, 0.15), (x, y, SEA_Z + 0.005), M["foam"], scale=(1.6, 0.6, 0.18), bumpy=0.4, subdiv=2, seed=x * 3)
        x += rng.uniform(0.12, 0.2)
    for y0, n in ((1.75, 9), (2.9, 6)):
        for k in range(n):
            x = -HALF + 0.5 + (SIZE - 1.0) * (k + rng.uniform(0.1, 0.9)) / n
            y = y0 + rng.uniform(-0.15, 0.15)
            for j in range(4):
                p.blob(rng.uniform(0.07, 0.1), (x + j * 0.12, y + rng.uniform(-0.02, 0.02), SEA_Z + 0.015), M["foam"],
                       scale=(1.4, 0.5, 0.35), bumpy=0.4, subdiv=2, seed=k * 7 + j + y0)
    p.finish(root)


# ---------- 砂浜のもの ----------

def build_palm(root, name, loc, height, lean, rot_z):
    """ヤシの木。幹は曲がりながら lean の向きに傾き、先に葉とヤシの実。"""
    p = Part(name)
    pts = []
    for k in range(9):
        t = k / 8
        pts.append(Vector((lean * t * t * height * 0.35, 0, t * height)))
    for k in range(8):
        r = 0.16 - 0.06 * k / 8
        p.limb(pts[k], pts[k + 1], r, r * 0.92, M["bark"], segs=12)
        p.cyl(r * 1.08, r * 1.0, 0.05, tuple(pts[k + 1] - Vector((0, 0, 0.03))), M["bark_ring"], segs=12)
    top = pts[-1]
    for k in range(3):
        a = k / 3 * math.tau
        p.sphere(0.1, (top.x + math.cos(a) * 0.12, top.y + math.sin(a) * 0.12, top.z - 0.12), M["coconut"], segs=12)
    # 葉: 先に向かって細くなり、弧を描いて垂れる帯
    for k in range(8):
        a = k / 8 * math.tau + 0.2
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        length = rng.uniform(1.3, 1.6)
        mat = M["frond"] if k % 2 else M["frond2"]
        prev = None
        for j in range(9):
            t = j / 8
            c = top + d * t * length + Vector((0, 0, 0.35 * t - 1.0 * t * t))
            w = 0.24 * math.sin(min(t * 1.2, 1.0) * math.pi * 0.9 + 0.15)
            cur = (c - side * w + Vector((0, 0, 0.04)), c + side * w + Vector((0, 0, 0.04)), c)
            if prev:   # 表と裏の両方を張る（アプリは裏を描かないため）
                for quad in ((prev[2], prev[1], cur[1], cur[2]), (prev[0], prev[2], cur[2], cur[0])):
                    p.poly(quad, mat, smooth=True)
                    p.poly(quad[::-1], mat, smooth=True)
            prev = cur
    p.finish(root, loc=(*loc, sand_height(*loc) - 0.05), rot_z=rot_z)


def build_sandcastle(root, loc):
    """砂の城。真ん中の塔に旗、まわりに堀。"""
    p = Part("sandcastle")
    # 堀（水が入っている）
    p.cyl(0.62, 0.62, 0.02, (0, 0, 0.005), M["castle_wet"], segs=36, smooth=False)
    p.cyl(0.58, 0.58, 0.02, (0, 0, 0.012), M["sea"], segs=36, smooth=False)
    p.cyl(0.46, 0.5, 0.12, (0, 0, 0.06), M["castle"], segs=32)
    towers = [(0, 0, 0.26, 0.42), (-0.28, -0.2, 0.15, 0.26), (0.3, -0.18, 0.15, 0.26), (-0.22, 0.26, 0.14, 0.24), (0.26, 0.24, 0.14, 0.24)]
    for x, y, r, h in towers:
        p.cyl(r, r * 0.86, h, (x, y, 0.12 + h / 2), M["castle"], segs=20)
        for k in range(6):   # 塔の上のぎざぎざ
            a = k / 6 * math.tau
            p.box((r * 0.32, r * 0.32, 0.06), (x + math.cos(a) * r * 0.72, y + math.sin(a) * r * 0.72, 0.12 + h + 0.03), M["castle"],
                  rot=(0, 0, a), bevel=0.01, segments=1)
    for (x0, y0, _, _), (x1, y1, _, _) in zip(towers[1:], towers[2:] + towers[1:2]):
        mid = Vector(((x0 + x1) / 2, (y0 + y1) / 2, 0.2))
        length = math.hypot(x1 - x0, y1 - y0)
        p.box((length, 0.08, 0.14), tuple(mid), M["castle"], rot=(0, 0, math.atan2(y1 - y0, x1 - x0)), bevel=0.02)
    p.box((0.1, 0.03, 0.12), (0, -0.25, 0.4), M["castle_wet"], bevel=0.02)   # 門
    p.limb((0, 0, 0.6), (0, 0, 0.95), 0.008, 0.008, M["stick"], segs=6)
    p.poly(((0, 0, 0.94), (0.16, 0, 0.88), (0, 0, 0.82)), M["flag"])
    p.poly(((0, 0, 0.94), (0, 0, 0.82), (0.16, 0, 0.88)), M["flag"])
    p.finish(root, loc=(*loc, sand_height(*loc)))


def build_bucket_shovel(root, loc, rot_z):
    p = Part("bucket_and_shovel")
    p.cyl(0.13, 0.1, 0.22, (0, 0, 0.11), M["bucket"], segs=20)
    p.cyl(0.115, 0.115, 0.01, (0, 0, 0.215), M["castle_wet"], segs=20)
    p.limb((-0.13, 0, 0.21), (0, 0, 0.32), 0.008, 0.008, M["bucket"], segs=6)
    p.limb((0, 0, 0.32), (0.13, 0, 0.21), 0.008, 0.008, M["bucket"], segs=6)
    p.finish(root, loc=(*loc, sand_height(*loc)), rot_z=rot_z)


def shovel(p, hand, tip, mat_blade, mat_handle):
    """持ち手から先へのスコップ（子どもの手に持たせる）。"""
    hand, tip = Vector(hand), Vector(tip)
    p.limb(hand + (hand - tip).normalized() * 0.05, tip, 0.015, 0.015, mat_handle, segs=6)
    d = (tip - hand).normalized()
    p.box((0.1, 0.13, 0.015), tuple(tip + d * 0.06), mat_blade, rot=d.to_track_quat("Y", "Z").to_euler(), bevel=0.006)


def build_beach_umbrella(root, loc, tilt=0.22):
    """赤と白のビーチパラソル。tilt だけ奥（+Y）へ傾けて砂に刺す。"""
    p = Part("beach_umbrella")
    top = Vector((0.0, 0.0, 2.3))
    p.limb((0, 0, -0.2), top + Vector((0, 0, 0.12)), 0.025, 0.025, M["pole"], segs=8)
    p.sphere(0.04, tuple(top + Vector((0, 0, 0.14))), M["umbrella_white"], segs=10)
    ribs = 12
    rim = [top + Vector((math.cos(k / ribs * math.tau) * 1.15, math.sin(k / ribs * math.tau) * 1.15, -0.42)) for k in range(ribs)]
    for k in range(ribs):
        a, b = rim[k], rim[(k + 1) % ribs]
        mid = (a + b) / 2 + Vector((0, 0, 0.05))
        mat = M["umbrella_red"] if k % 2 else M["umbrella_white"]
        p.poly((top, a, mid), mat)
        p.poly((top, mid, b), mat)
        p.poly((top, mid, a), mat)   # 裏
        p.poly((top, b, mid), mat)
        # 縁のたれ
        p.poly((a, a + Vector((0, 0, -0.1)), b + Vector((0, 0, -0.1)), b), mat)
        p.poly((a, b, b + Vector((0, 0, -0.1)), a + Vector((0, 0, -0.1))), mat)
    obj = p.finish(root, loc=(*loc, sand_height(*loc)))
    obj.rotation_euler = (-tilt, 0, 0)


def build_towel(root, name, loc, rot_z, size, mats):
    p = Part(name)
    w, d = size
    n = 6
    for k in range(n):
        p.box((w / n + 0.002, d, 0.02), (-w / 2 + w / n * (k + 0.5), 0, 0.01), mats[k % 2])
    p.finish(root, loc=(*loc, sand_height(*loc) + 0.005), rot_z=rot_z)


def build_picnic(root, loc, rot_z):
    """チェックのシートと、かご・サンドイッチの皿・ジュース。"""
    p = Part("picnic")
    n = 6
    for i in range(n):
        for j in range(n):
            p.box((0.2, 0.2, 0.015), (-0.5 + 0.2 * (i + 0.5), -0.5 + 0.2 * (j + 0.5), 0.008), M["mat_red"] if (i + j) % 2 else M["mat_white"])
    # かご
    p.box((0.42, 0.3, 0.22), (0.25, 0.22, 0.13), M["basket"], bevel=0.04)
    p.limb((0.08, 0.22, 0.24), (0.25, 0.22, 0.4), 0.012, 0.012, M["crust"], segs=6)
    p.limb((0.25, 0.22, 0.4), (0.42, 0.22, 0.24), 0.012, 0.012, M["crust"], segs=6)
    # 皿とサンドイッチ（1 つはカモメが持っていった）
    p.cyl(0.15, 0.13, 0.02, (-0.15, -0.15, 0.025), M["plate"], segs=24, smooth=False)
    sandwich(p, (-0.2, -0.12, 0.04), 0.3)
    p.cyl(0.035, 0.035, 0.18, (0.3, -0.25, 0.1), M["juice"], segs=12)
    p.cyl(0.02, 0.02, 0.03, (0.3, -0.25, 0.205), M["cap"], segs=10)
    p.finish(root, loc=(*loc, sand_height(*loc) + 0.005), rot_z=rot_z)


def sandwich(p, loc, rot_z, scale=1.0):
    """三角のサンドイッチ（パン・レタス・トマト・パン）。"""
    x, y, z = loc
    s = scale
    tri = [Vector((math.cos(a) * 0.09 * s, math.sin(a) * 0.09 * s, 0)) for a in (rot_z, rot_z + 2.1, rot_z + 4.2)]
    layers = [(M["bread"], 0.0, 0.03), (M["lettuce"], 0.03, 0.012), (M["tomato"], 0.042, 0.01), (M["bread"], 0.052, 0.03)]
    for mat, z0, h in layers:
        z0, h = z0 * s, h * s
        grow = 1.08 if mat in (M["lettuce"],) else 1.0
        bot = [Vector((x, y, z + z0)) + v * grow for v in tri]
        top = [v + Vector((0, 0, h)) for v in bot]
        p.poly(bot[::-1], mat)
        p.poly(top, mat)
        for k in range(3):
            p.poly((bot[k], bot[(k + 1) % 3], top[(k + 1) % 3], top[k]), M["crust"] if mat == M["bread"] else mat)


def build_seagull(root, loc, rot_z, scale=1.0):
    """サンドイッチをくわえて飛んでいくカモメ。正面は -Y。"""
    p = Part("seagull")
    p.sphere(0.13, (0, 0.02, 0), M["gull"], scale=(0.85, 1.7, 0.8))
    p.sphere(0.09, (0, -0.22, 0.06), M["gull"])
    p.cyl(0.03, 0.0, 0.1, (0, -0.33, 0.04), M["beak"], rot=(math.pi / 2 + 0.2, 0, 0), segs=8)
    for sx in (-1, 1):
        p.sphere(0.016, (sx * 0.055, -0.27, 0.09), M["gull_black"], segs=8)
        # 翼（浅い V の字に広げた形）。付け根は灰色、先は黒
        root_pt = Vector((sx * 0.08, 0.0, 0.04))
        elbow = Vector((sx * 0.4, 0.04, 0.13))
        tip = Vector((sx * 0.75, 0.1, 0.17))
        for a, b, w, mat in ((root_pt, elbow, 0.13, M["gull_gray"]), (elbow, tip, 0.1, M["gull_gray"])):
            d = Vector((0, 1, 0)) * w
            p.poly((a - d * 0.4, b - d * 0.4, b + d, a + d), mat, smooth=True)
            p.poly((a + d, b + d, b - d * 0.4, a - d * 0.4), mat, smooth=True)
        d = Vector((0, 1, 0)) * 0.08
        p.poly((tip - d * 0.3, tip + Vector((sx * 0.12, 0.04, 0.05)), tip + d), M["gull_black"])
        p.poly((tip + d, tip + Vector((sx * 0.12, 0.04, 0.05)), tip - d * 0.3), M["gull_black"])
    # しっぽ
    p.poly(((-0.07, 0.22, 0.0), (0.07, 0.22, 0.0), (0.05, 0.36, 0.03), (-0.05, 0.36, 0.03)), M["gull"])
    p.poly(((-0.05, 0.36, 0.03), (0.05, 0.36, 0.03), (0.07, 0.22, 0.0), (-0.07, 0.22, 0.0)), M["gull"])
    sandwich(p, (0, -0.42, -0.03), 0.5, scale=0.9)
    p.finish(root, loc=loc, rot_z=rot_z, scale=scale)


def build_crab(root, loc, rot_z):
    p = Part("crab")
    p.sphere(0.11, (0, 0, 0.07), M["crab"], scale=(1.3, 0.9, 0.5))
    for sx in (-1, 1):
        p.limb((sx * 0.04, -0.06, 0.1), (sx * 0.05, -0.08, 0.17), 0.01, 0.01, M["crab"], segs=6)
        p.sphere(0.022, (sx * 0.05, -0.08, 0.18), M["eye"], segs=8)
        # はさみ（振り上げている）
        p.limb((sx * 0.12, -0.05, 0.07), (sx * 0.2, -0.12, 0.14), 0.02, 0.018, M["crab"], segs=8)
        p.sphere(0.045, (sx * 0.22, -0.15, 0.18), M["crab_dark"], scale=(0.8, 1, 1.1), segs=12)
        p.cyl(0.018, 0.0, 0.06, (sx * 0.22, -0.18, 0.23), M["crab_dark"], rot=(0.4, 0, 0), segs=6)
        for k in range(3):
            y = 0.0 + k * 0.04
            p.limb((sx * 0.12, y, 0.06), (sx * 0.2, y + 0.01, 0.07), 0.012, 0.011, M["crab"], segs=6)
            p.limb((sx * 0.2, y + 0.01, 0.07), (sx * 0.25, y + 0.02, 0.0), 0.011, 0.008, M["crab"], segs=6)
    p.finish(root, loc=(*loc, sand_height(*loc)), rot_z=rot_z)


def build_rocks(root, spots):
    p = Part("rocks")
    for i, (x, y, s) in enumerate(spots):
        z = sand_height(x, y)
        p.blob(s, (x, y, z + s * 0.25), M["rock"], scale=(1.2, 1, 0.75), bumpy=0.3, subdiv=2, seed=i * 2.3, smooth=False)
        p.blob(s * 0.6, (x + s * 0.9, y - s * 0.4, z + s * 0.15), M["rock_dark"], scale=(1.1, 1, 0.7), bumpy=0.3, subdiv=2, seed=i * 4.1, smooth=False)
    p.finish(root)


def build_shells(root, n=14):
    """貝がらとヒトデ。"""
    p = Part("shells")
    for k in range(n):
        x, y = rng.uniform(-3.4, 3.4), rng.uniform(-3.4, -0.4)
        z = sand_height(x, y)
        if k % 4 == 0:   # ヒトデ
            for j in range(5):
                a = j / 5 * math.tau + k
                p.limb((x, y, z + 0.015), (x + math.cos(a) * 0.09, y + math.sin(a) * 0.09, z + 0.01), 0.025, 0.008, M["starfish"], segs=6)
        else:            # 扇形の貝
            a = rng.random() * math.tau
            p.cyl(0.05, 0.0, 0.03, (x, y, z + 0.012), rng.choice([M["shell_pink"], M["shell_white"]]), rot=(0, 0, a), segs=7, smooth=False)
    p.finish(root)


def build_beach_ball(root, loc):
    """赤・黄・青・白の 4 色で塗り分けたビーチボール。"""
    p = Part("beach_ball")
    r, z0 = 0.2, sand_height(*loc) + 0.19
    colors = [M["ball_red"], M["ball_white"], M["ball_yellow"], M["ball_white"], M["ball_blue"], M["ball_white"]]
    lon, lat = 36, 12

    def pt(i, j):
        a, b = i / lon * math.tau, j / lat * math.pi
        return Vector((math.sin(b) * math.cos(a) * r, math.sin(b) * math.sin(a) * r, math.cos(b) * r + z0))

    for i in range(lon):
        mat = colors[i * len(colors) // lon]
        for j in range(lat):
            if j == 0:            # 極は三角
                p.poly((pt(i, 0), pt(i, 1), pt(i + 1, 1)), mat)
            elif j == lat - 1:
                p.poly((pt(i, j), pt(i, lat), pt(i + 1, j)), mat)
            else:
                p.poly((pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)), mat)
    p.cyl(0.04, 0.04, 0.01, (0, 0, z0 + r), M["ball_white"], segs=12)
    p.finish(root, loc=loc)


def build_float_ring(root, loc, z, r=0.3, tube=0.09):
    """浮き輪（赤と白）。"""
    p = Part("float_ring")
    n = 16
    for k in range(n):
        a, b = k / n * math.tau, (k + 1) / n * math.tau
        p.limb((math.cos(a) * r, math.sin(a) * r, 0), (math.cos(b) * r, math.sin(b) * r, 0), tube, tube,
               M["ring_red"] if (k // 2) % 2 else M["ring_white"], segs=12)
        p.sphere(tube, (math.cos(b) * r, math.sin(b) * r, 0), M["ring_red"] if (k // 2) % 2 else M["ring_white"], segs=12)
    p.finish(root, loc=(*loc, z))


def build_sailboat(root, loc, rot_z):
    p = Part("sailboat")
    p.box((0.5, 1.4, 0.24), (0, 0, 0.0), M["hull"], bevel=0.11)
    p.box((0.52, 1.2, 0.05), (0, 0.02, 0.05), M["hull_stripe"])
    p.limb((0, -0.05, 0.1), (0, -0.05, 1.75), 0.022, 0.018, M["mast"], segs=8)
    p.limb((0, -0.05, 0.32), (0, 0.6, 0.32), 0.016, 0.016, M["mast"], segs=6)
    p.poly(((0.003, -0.05, 1.75), (0.003, -0.05, 1.62), (0.003, 0.16, 1.68)), M["flag"])
    p.poly(((-0.003, -0.05, 1.75), (-0.003, 0.16, 1.68), (-0.003, -0.05, 1.62)), M["flag"])
    sail = ((0, -0.03, 0.36), (0, -0.03, 1.65), (0, 0.58, 0.36))
    p.poly(sail, M["sail"])
    p.poly(sail[::-1], M["sail"])
    jib = ((0, -0.08, 0.32), (0, -0.08, 1.45), (0, -0.66, 0.14))
    p.poly(jib, M["sail"])
    p.poly(jib[::-1], M["sail"])
    p.finish(root, loc=(*loc, SEA_Z + 0.02), rot_z=rot_z)


def build_cooler(root, loc, rot_z):
    p = Part("cooler")
    p.box((0.5, 0.32, 0.3), (0, 0, 0.15), M["cooler"], bevel=0.04)
    p.box((0.52, 0.34, 0.07), (0, 0, 0.32), M["cooler_lid"], bevel=0.03)
    p.limb((-0.15, 0, 0.36), (0.15, 0, 0.36), 0.015, 0.015, M["cooler_lid"], segs=6)
    p.finish(root, loc=(*loc, sand_height(*loc)), rot_z=rot_z)


def build_straw_hat(root, name, loc, rot):
    p = Part(name)
    p.cyl(0.3, 0.3, 0.02, (0, 0, 0.0), M["straw"], segs=28)
    p.sphere(0.15, (0, 0, 0.02), M["straw"], scale=(1, 1, 0.75), segs=20)
    p.cyl(0.152, 0.152, 0.04, (0, 0, 0.04), M["hat_band"], segs=24)
    obj = p.finish(root, loc=loc)
    obj.rotation_euler = rot


def build_surfboard(root, loc, rot_z):
    """砂に立てたサーフボード。"""
    p = Part("surfboard")
    p.sphere(1.0, (0, 0, 0.75), M["surf"], scale=(0.24, 0.05, 0.85), segs=28)
    p.sphere(1.0, (0, -0.005, 0.75), M["surf_stripe"], scale=(0.05, 0.052, 0.84), segs=20)
    p.finish(root, loc=(*loc, sand_height(*loc) - 0.1), rot_z=rot_z)


def build_flip_flops(root, loc, rot_z):
    p = Part("flip_flops")
    for sx in (-1, 1):
        p.sphere(1.0, (sx * 0.08, 0, 0.012), M["sandal"], scale=(0.05, 0.12, 0.012), segs=14)
        p.limb((sx * 0.08, -0.06, 0.02), (sx * 0.08 - 0.035, 0.0, 0.03), 0.006, 0.006, M["ball_white"], segs=4)
        p.limb((sx * 0.08, -0.06, 0.02), (sx * 0.08 + 0.035, 0.0, 0.03), 0.006, 0.006, M["ball_white"], segs=4)
    p.finish(root, loc=(*loc, sand_height(*loc)), rot_z=rot_z)


def build_footprints(root, start, end):
    """砂の上の足あと（左右交互）。"""
    p = Part("footprints")
    a, b = Vector(start), Vector(end)
    d = (b - a).normalized()
    side = Vector((-d.y, d.x))
    n = int((b - a).length / 0.28)
    for k in range(n):
        c = a + d * (k * 0.28) + side * (0.07 if k % 2 else -0.07)
        p.sphere(1.0, (c.x, c.y, sand_height(c.x, c.y) + 0.002), M["sand_print"], scale=(0.045, 0.09, 0.006),
                 rot=(0, 0, math.atan2(d.y, d.x) - math.pi / 2), segs=10)
    p.finish(root)


def build_beach() -> bpy.types.Object:
    root = bpy.data.objects.new("beach", None)
    bpy.context.scene.collection.objects.link(root)
    build_island(root)
    build_sea(root)
    build_foam(root)
    build_palm(root, "palm_back", (-3.0, -0.75), 3.5, 1.0, 0.5)
    build_palm(root, "palm_front", (-3.15, -2.95), 2.9, 1.0, -0.6)
    build_rocks(root, [(2.75, 0.05, 0.38), (3.3, 0.45, 0.26), (-1.9, 0.7, 0.22)])
    build_shells(root)

    kid = {"skin": M["skin"], "eye": M["eye"], "cheek": M["cheek"], "mouth": M["mouth"]}

    # 砂の城を作っている 2 人の子ども（1 人はスコップ、もう 1 人は手で形を整える）
    castle = (-1.55, -1.55)
    build_sandcastle(root, castle)
    build_bucket_shovel(root, (-2.35, -1.05), 0.3)
    boy = {**kid, "hair": M["hair_black"], "top": M["tee_yellow"], "bottom": M["shorts_blue"], "shoe": M["skin"]}
    girl = {**kid, "hair": M["hair_brown"], "top": M["tee_green"], "bottom": M["shorts_red"], "shoe": M["skin"], "hair_style": "bun"}
    # 男の子は城の奥から手前（カメラのほう）を向き、女の子は横から城を向く
    boy_at = ((castle[0] + 0.05, castle[1] + 0.85), 0.1)
    girl_at = ((castle[0] + 0.9, castle[1] + 0.1), -math.pi / 2 + 0.45)
    kneel_sh = 1.0   # ひざ立ちの肩の高さ
    shovel_hand = (0.14, -0.45, -0.45)
    person(root, "boy_building", *boy_at, boy, pose="kneel", scale=0.7, hands=[(-0.18, -0.4, -0.55), shovel_hand])
    person(root, "girl_building", *girl_at, girl, pose="kneel", scale=0.7, hands=[(-0.16, -0.45, -0.62), (0.16, -0.45, -0.62)])
    q = Part("shovel")
    shovel(q, (shovel_hand[0], shovel_hand[1], kneel_sh + shovel_hand[2]), (0.16, -0.62, 0.12), M["shovel"], M["shovel_handle"])
    q.finish(root, loc=boy_at[0], rot_z=boy_at[1], scale=0.7)

    # ピクニックのシートと、サンドイッチを取られて驚く女性。カモメはサンドイッチをくわえて海へ飛んでいく
    picnic = (0.05, -0.55)
    build_picnic(root, picnic, -0.2)
    woman = {**kid, "skin": M["skin"], "hair": M["hair_blond"], "top": M["dress"], "bottom": M["dress"], "shoe": M["sandal"],
             "skirt": True, "hair_style": "long"}
    person(root, "woman_surprised", (-0.45, -0.95), -0.35, woman, hands=[(-0.12, -0.2, 0.12), (0.34, -0.25, 0.62)])
    build_seagull(root, (-0.15, -0.35, 1.9), 1.45, scale=1.5)   # 画像のカメラに対して斜め 45° に飛ぶ（翼が広がって見える）

    # パラソルの下で、麦わら帽子を顔にのせて昼寝している男性
    build_beach_umbrella(root, (2.05, -0.95))
    towel_c, towel_rot = Vector((1.75, -1.6, 0)), 0.25
    build_towel(root, "towel", towel_c.xy, towel_rot, (0.8, 1.9), [M["towel_blue"], M["towel_white"]])
    # あお向けに寝かせる: 立った人を X 軸で -90° 倒すと、頭が +Y、顔が上を向く。背中の厚み（0.2）だけ浮かせる
    axis = Vector((-math.sin(towel_rot), math.cos(towel_rot), 0))
    feet = towel_c - axis * 0.85
    man = {**kid, "skin": M["skin_tan"], "hair": M["hair_black"], "top": M["aloha"], "bottom": M["shorts_red"], "shoe": M["skin_tan"]}
    sleeper = person(root, "man_sleeping", feet.xy, 0.0, man, hands=[(-0.14, -0.2, -0.42), (0.14, -0.2, -0.42)], lift=0.2)
    sleeper.rotation_euler = (-math.pi / 2, 0, towel_rot)
    head = feet + axis * 1.52   # 立ったときの頭の中心の高さ
    build_straw_hat(root, "straw_hat", (head.x, head.y, 0.2 + 0.17), (-0.2, 0.0, towel_rot))
    build_cooler(root, (2.95, -1.45), -0.3)

    # 浮き輪で海に浮かぶ男の子と、沖のヨット
    swimmer_at = (-0.9, 2.0)
    swimmer = {**kid, "hair": M["hair_blond"], "top": M["skin"], "bottom": M["swim"], "shoe": M["skin"]}
    person(root, "boy_swimming", swimmer_at, -0.3, swimmer, scale=0.7, lift=SEA_Z - 0.7 * 0.95,
           hands=[(-0.36, -0.1, 0.0), (0.36, -0.1, 0.0)])
    build_float_ring(root, swimmer_at, SEA_Z + 0.02, r=0.3, tube=0.085)
    build_sailboat(root, (2.0, 2.7), -0.9)   # 帆を画像のカメラに向ける

    build_crab(root, (2.15, -0.45), -0.4)
    build_beach_ball(root, (-2.1, -2.75))
    build_surfboard(root, (1.15, -3.05), 0.5)
    build_flip_flops(root, (2.55, -2.45), 0.3)
    build_footprints(root, (-0.9, -3.4), (-0.55, -1.1))
    return root


def build():
    make_materials()
    return build_beach()


# 夏の晴れた昼。太陽は高く、背景は明るい空色
ENV = {"sun_elevation": 50, "sun_energy": 2.8, "sun_color": "#fff4e0", "bg_strength": 2.0, "bg_edge": "#86c3e8", "bg_center": "#f2fbff"}

run("beach", build, lens=42, env=ENV)
