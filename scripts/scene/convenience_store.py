"""コンビニのジオラマ（3D シーン）を作り、アプリ用の USDZ と発表用の画像を書き出す。

奥の壁の棚（商品がぎっしり）、左の壁のドリンクの冷蔵ケース、中央の通路を挟む 2 つの島の棚、
右奥の冷蔵庫、手前のレジカウンターと店員、ホットスナックのケース、回転する菓子ラック、
雑誌ラック、買い物かごを置く。客は買い物かごを持って歩き、棚やケースの前で選ぶ。
共通の道具は common.py。

使い方:
  blender --background --factory-startup --python scripts/scene/convenience_store.py -- [--out assets/scenes] [--no-render] [--samples 128]
"""
from __future__ import annotations

import math
import random
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HALF, SIZE, Part, material, materials, person, run  # noqa: E402

rng = random.Random(7711)
M: dict = {}

WALL_H = 3.0
WALL_T = 0.25
BACK_Y = HALF - WALL_T / 2
LEFT_X = -HALF + WALL_T / 2
BASE_R = 0.35
ROUND_CORNERS = ((-1, -1), (1, -1), (1, 1))
WALL_END = HALF - BASE_R

PRODUCT_COLORS = ["cola_red", "water_blue", "tea_green", "milk_white", "juice_orange", "coffee_brown",
                  "snack_yellow", "snack_pink", "snack_purple", "can_silver", "gold_pack", "navy_pack", "mint_pack"]


def make_materials() -> None:
    M.update(materials({
        "floor_a": ("#4d525c", 0.6), "floor_b": ("#41454e", 0.6), "base": ("#2f333b", 0.8), "base_dark": ("#25292f", 0.85),
        "wall": ("#363d47", 0.8), "wall_band": ("#1e7f4f", 0.6), "baseboard": ("#22262d", 0.6),
        "shelf": ("#6a707b", 0.45), "shelf_dark": ("#50565f", 0.45), "fridge_body": ("#7d8690", 0.4),
        "counter": ("#4a4640", 0.55), "counter_top": ("#1c1d22", 0.35), "belt": ("#22232a", 0.7),
        "register": ("#3a3a44", 0.35), "keys": ("#dadde3", 0.5), "warmer_body": ("#5d646e", 0.35),
        "rack_frame": ("#7a808a", 0.4), "magazine": ("#c94f4f", 0.6), "magazine_b": ("#4f7fc9", 0.6),
        "cart_metal": ("#9aa1ab", 0.35), "basket": ("#d9303f", 0.5), "basket_dark": ("#8b1d28", 0.5),
        "bottle_glass": ("#cfe9e0", 0.1), "can": ("#c7ccd4", 0.25), "bag_paper": ("#f0d59a", 0.8),
        "onigiri": ("#fbfbf5", 0.7), "nori": ("#1d2a1d", 0.7), "hotdog": ("#c4623a", 0.6), "bun": ("#e6b77a", 0.7),
        "sign_red": ("#e0402f", 0.4), "sign_blue": ("#2c7fd9", 0.4), "sign_yellow": ("#ffd23a", 0.4),
        "label_white": ("#fafafa", 0.6), "cap_dark": ("#303036", 0.4), "cap_red": ("#c42a2a", 0.4),
        "skin_l": ("#f6caa6", 0.55), "skin_m": ("#d9a07a", 0.55), "skin_t": ("#c68a5e", 0.55), "skin_d": ("#8d5a3b", 0.55),
        "eye": ("#2a211c", 0.3), "hair_black": ("#2a1f1a", 0.6), "hair_brown": ("#5a3a22", 0.6), "hair_grey": ("#9a9aa0", 0.6),
        "uniform": ("#d9303f", 0.7), "uniform_vest": ("#1e3a6e", 0.7), "pants_navy": ("#2f3b63", 0.7),
        "top_yellow": ("#f2c94c", 0.8), "top_green": ("#5cae6a", 0.8), "top_grey": ("#9a9aa3", 0.8),
        "bottom_beige": ("#d9c7a4", 0.7), "bottom_black": ("#2a2a30", 0.7),
        "shoe_brown": ("#6b4428", 0.5), "shoe_white": ("#f2f2f2", 0.5), "shoe_black": ("#25252a", 0.5),
    }))
    M["glass_cool"] = material("glass_cool", "#9fd6ea", 0.1, emit=0.25)
    M["glass_warm"] = material("glass_warm", "#e8b77a", 0.1, emit=0.3)
    M["sign_light"] = material("sign_light", "#c9c3a8", 0.4, emit=0.3)
    for name, hexc in {
        "cola_red": "#c42a2a", "water_blue": "#4aa3e0", "tea_green": "#5fae5a", "milk_white": "#f4f4ef",
        "juice_orange": "#f29a32", "coffee_brown": "#6b4026", "snack_yellow": "#f5c63a", "snack_pink": "#f08aa8",
        "snack_purple": "#8f6ad1", "can_silver": "#c7ccd4", "gold_pack": "#d9a53a", "navy_pack": "#2d3f70",
        "mint_pack": "#7ed4b8",
    }.items():
        M[name] = material(name, hexc, 0.35)


# ---------- 部屋 ----------

def build_room(root) -> None:
    p = Part("room")
    p.slab(SIZE, 0.0, 0.2, BASE_R, M["base"], corners=ROUND_CORNERS)
    p.slab(SIZE - 0.2, -0.2, 0.45, BASE_R - 0.05, M["base_dark"], corners=ROUND_CORNERS)
    tiles = 8
    for i in range(tiles):
        for j in range(tiles):
            x = -HALF + 0.35 + (SIZE - 0.7) * (i + 0.5) / tiles
            y = -HALF + 0.35 + (SIZE - 0.7) * (j + 0.5) / tiles
            mat = M["floor_a"] if (i + j) % 2 else M["floor_b"]
            p.box(((SIZE - 0.7) / tiles - 0.02, (SIZE - 0.7) / tiles - 0.02, 0.02), (x, y, 0.01), mat)
    back_len = HALF + WALL_END
    side_len = WALL_END + HALF - WALL_T
    p.box((back_len, WALL_T, WALL_H), (WALL_END - back_len / 2, BACK_Y, WALL_H / 2), M["wall"])
    p.box((WALL_T, side_len, WALL_H), (LEFT_X, -WALL_END + side_len / 2, WALL_H / 2), M["wall"])
    # 奥の壁の緑の帯（店のライン）
    p.box((back_len, 0.02, 0.22), (WALL_END - back_len / 2, BACK_Y - WALL_T / 2 - 0.01, 2.85), M["wall_band"])
    p.box((back_len + 0.04, WALL_T + 0.04, 0.12), (WALL_END - back_len / 2, BACK_Y, 0.06), M["baseboard"])
    p.box((WALL_T + 0.04, side_len, 0.12), (LEFT_X, -WALL_END + side_len / 2 - 0.02, 0.06), M["baseboard"])
    p.finish(root)


# ---------- 商品 ----------

def product_row(p: Part, x0: float, x1: float, z: float, y: float, depth: float) -> None:
    """棚の 1 段に商品を並べる。ペットボトル・缶・箱・袋を混ぜる。"""
    x = x0
    while x < x1 - 0.04:
        roll = rng.random()
        color = M[rng.choice(PRODUCT_COLORS)]
        if roll < 0.35:
            # ペットボトル（キャップつき）
            h = rng.uniform(0.17, 0.27)
            r = rng.uniform(0.032, 0.04)
            p.cyl(r, r, h, (x + r, y, z + h / 2), color, rot=(0, 0, 0), segs=12)
            p.cyl(r * 0.45, r * 0.45, 0.02, (x + r, y, z + h + 0.01), M["cap_dark"], segs=8)
            step = 2 * r + 0.01
        elif roll < 0.6:
            # 缶
            h = 0.12
            r = 0.031
            p.cyl(r, r, h, (x + r, y, z + h / 2), M["can"], segs=14)
            p.cyl(r + 0.001, r + 0.001, 0.02, (x + r, y, z + h * 0.7), color, segs=14)
            step = 2 * r + 0.008
        elif roll < 0.85:
            # 箱（お菓子・カップ麺など）
            w = rng.uniform(0.06, 0.1)
            h = rng.uniform(0.12, 0.17)
            p.box((w, depth * 0.8, h), (x + w / 2, y, z + h / 2), color, bevel=0.004)
            p.box((w * 0.7, 0.005, h * 0.5), (x + w / 2, y - depth * 0.4 - 0.002, z + h * 0.55), M["label_white"])
            step = w + 0.008
        else:
            # 袋のお菓子（薄くて平たい）
            w = rng.uniform(0.1, 0.14)
            h = rng.uniform(0.15, 0.2)
            p.box((w, 0.02, h), (x + w / 2, y, z + h / 2), color, bevel=0.006)
            p.box((w * 0.5, 0.005, 0.03), (x + w / 2, y - 0.012, z + h * 0.8), M["label_white"])
            step = w + 0.01
        x += step


def shelf_unit(root, name: str, loc, rot_z: float, width: float, levels: int = 4, depth: float = 0.5,
               both_sides: bool = False) -> None:
    """棚（ゴンドラ）。正面は -Y。両面のときは裏側にも商品を置く。"""
    p = Part(name)
    h = 1.8
    for i in range(levels):
        z = 0.05 + i * (h - 0.1) / (levels - 1)
        p.box((width, depth, 0.03), (0, 0, z), M["shelf"])
    for sx in (-1, 1):
        p.box((0.03, depth, h), (sx * (width / 2 - 0.015), 0, h / 2), M["shelf_dark"])
    for i in range(levels):
        z = 0.08 + i * (h - 0.1) / (levels - 1)
        product_row(p, -width / 2 + 0.05, width / 2 - 0.05, z, -depth / 2 + 0.1, depth)
        if both_sides:
            product_row(p, -width / 2 + 0.05, width / 2 - 0.05, z, depth / 2 - 0.1, depth)
    # 上の看板（色つき）
    sign = rng.choice(["sign_red", "sign_blue", "sign_yellow"])
    p.box((width * 0.8, 0.04, 0.2), (0, -depth / 2 + 0.02, h + 0.1), M[sign], bevel=0.01)
    p.box((width * 0.6, 0.02, 0.06), (0, -depth / 2 - 0.005, h + 0.1), M["sign_light"])
    p.finish(root, loc=loc, rot_z=rot_z)


def fridge_case(root, name: str, loc, rot_z: float, width: float = 1.5) -> None:
    """ドリンクの冷蔵ケース。ガラスの扉の向こうに飲み物が並ぶ。正面は -Y。"""
    p = Part(name)
    depth = 0.6
    p.box((width, depth, 0.9), (0, 0, 0.45), M["fridge_body"], bevel=0.02)
    p.box((width - 0.1, 0.01, 0.7), (0, -depth / 2 + 0.005, 0.5), M["glass_cool"])
    for z in (0.22, 0.42, 0.62):
        p.box((width - 0.12, depth - 0.12, 0.012), (0, 0, z), M["shelf"])
        product_row(p, -width / 2 + 0.07, width / 2 - 0.07, z + 0.012, -depth / 2 + 0.22, depth)
    p.box((width, 0.02, 0.03), (0, -depth / 2 - 0.01, 0.92), M["shelf_dark"])
    p.finish(root, loc=loc, rot_z=rot_z)


def drink_cooler(root, name: str, loc) -> None:
    """奥右の縦型の冷蔵庫（ガラス扉）。"""
    p = Part(name)
    w, d, h = 0.9, 0.7, 1.9
    p.box((w, d, h), (0, 0, h / 2), M["fridge_body"], bevel=0.02)
    p.box((w - 0.1, 0.01, h - 0.2), (0, -d / 2 + 0.005, h / 2), M["glass_cool"])
    for z in (0.3, 0.7, 1.1, 1.5):
        p.box((w - 0.12, d - 0.14, 0.012), (0, 0, z), M["shelf"])
        product_row(p, -w / 2 + 0.07, w / 2 - 0.07, z + 0.012, -d / 2 + 0.22, d)
    p.finish(root, loc=loc)


def hot_food_warmer(root, loc) -> None:
    """ホットスナックのケース。おにぎり・ホットドッグ・肉まんが見える。"""
    p = Part("hot_food")
    w, d = 1.1, 0.6
    p.box((w, d, 0.5), (0, 0, 0.25), M["warmer_body"], bevel=0.02)
    p.box((w - 0.06, d - 0.06, 0.02), (0, 0, 0.52), M["glass_warm"])
    for i in range(5):
        x = -w / 2 + 0.12 + i * 0.2
        p.blob(0.085, (x, -0.1, 0.62), M["onigiri"], scale=(0.9, 0.9, 1.1), bumpy=0.05, subdiv=2, seed=i)
        p.box((0.05, 0.1, 0.04), (x, -0.1, 0.56), M["nori"])
    for i in range(3):
        x = -w / 2 + 0.2 + i * 0.3
        p.cyl(0.04, 0.04, 0.18, (x, 0.12, 0.6), M["bun"], rot=(0, math.pi / 2, 0), segs=10)
        p.cyl(0.02, 0.02, 0.2, (x, 0.12, 0.6), M["hotdog"], rot=(0, math.pi / 2, 0), segs=8)
    p.finish(root, loc=loc)


def snack_rack(root, loc) -> None:
    """回転する菓子ラック。周りにお菓子の袋を下げている。"""
    p = Part("snack_rack")
    p.cyl(0.02, 0.02, 1.3, (0, 0, 0.65), M["rack_frame"], segs=8)
    p.cyl(0.36, 0.36, 0.02, (0, 0, 0.3), M["rack_frame"], segs=24)
    p.cyl(0.36, 0.36, 0.02, (0, 0, 0.9), M["rack_frame"], segs=24)
    for i in range(10):
        a = i * math.tau / 10
        color = M[rng.choice(PRODUCT_COLORS)]
        bz = 0.7 + rng.uniform(-0.08, 0.08)
        bx, by = math.cos(a) * 0.3, math.sin(a) * 0.3
        # 袋を中心の柱から出た腕でつるす
        p.limb((0, 0, bz + 0.05), (bx, by, bz + 0.05), 0.008, 0.008, M["rack_frame"], segs=6)
        p.box((0.1, 0.03, 0.14), (bx, by, bz), color, bevel=0.004, rot=(0, 0, a))
    p.finish(root, loc=loc)


def magazine_rack(root, loc) -> None:
    p = Part("magazine_rack")
    p.box((0.8, 0.3, 1.0), (0, 0, 0.5), M["rack_frame"], bevel=0.01)
    for i in range(4):
        x = -0.32 + i * 0.2
        p.box((0.16, 0.22, 0.02), (x, 0.02, 0.9), M["magazine" if i % 2 else "magazine_b"], bevel=0.003)
    p.finish(root, loc=loc)


# ---------- レジ ----------

def checkout(root) -> None:
    loc = (2.6, -2.8)
    p = Part("checkout")
    p.box((1.8, 0.6, 0.92), (0, 0, 0.46), M["counter"], bevel=0.02)
    p.box((1.9, 0.66, 0.04), (0, 0, 0.94), M["counter_top"], bevel=0.01)
    # ベルトコンベア（客の商品を載せる）
    p.box((0.9, 0.5, 0.02), (-0.3, -0.05, 0.97), M["belt"])
    # レジ本体とタッチパネル
    p.box((0.42, 0.3, 0.22), (0.6, 0.02, 1.05), M["register"], bevel=0.02)
    p.box((0.34, 0.02, 0.14), (0.6, -0.12, 1.2), M["sign_light"], rot=(-0.4, 0, 0))
    for i in range(3):
        for j in range(3):
            p.box((0.04, 0.02, 0.03), (0.5 + i * 0.07, 0.1 + j * 0.05, 1.12), M["keys"])
    # カード端末とレシートプリンタ
    p.box((0.14, 0.1, 0.06), (0.9, 0.1, 1.0), M["cap_dark"], bevel=0.01)
    p.box((0.1, 0.1, 0.12), (0.85, -0.12, 1.02), M["keys"], bevel=0.01)
    # 袋とかご（レジ裏の台）
    for i in range(3):
        p.box((0.2, 0.14, 0.04), (-0.8 + i * 0.12, 0.2, 1.0 + i * 0.03), M["bag_paper"], rot=(0, 0, 0.1 * i))
    p.finish(root, loc=(loc[0], loc[1], 0))

    # レジ横のタバコ棚（後ろの壁側）
    cig = Part("cigarette_shelf")
    # 床から立つ高さ 1.5 m のキャビネット（足元まで箱がある）
    cig.box((0.9, 0.2, 1.5), (0, 0, 0.75), M["shelf_dark"], bevel=0.01)
    for i in range(4):
        for j in range(5):
            cig.box((0.05, 0.02, 0.1), (-0.36 + j * 0.18, -0.11, 0.35 + i * 0.3), M[rng.choice(["navy_pack", "gold_pack", "mint_pack"])])
    cig.finish(root, loc=(2.6, -1.55, 0))


def basket_stack(root, loc) -> None:
    """買い物かご（積み重ね）と、中に入った商品。"""
    p = Part("baskets")
    for i in range(3):
        z = 0.02 + i * 0.12
        p.box((0.46, 0.34, 0.1), (0, 0, z), M["basket"] if i % 2 else M["basket_dark"], bevel=0.01)
    p.box((0.46, 0.34, 0.01), (0, 0, 0.4), M["cart_metal"])
    p.finish(root, loc=loc, rot_z=0.2)


# ---------- 組み立て ----------

def build_store() -> bpy.types.Object:
    root = bpy.data.objects.new("convenience_store", None)
    bpy.context.scene.collection.objects.link(root)
    build_room(root)
    # 奥の壁の棚（3 つ）と右奥の縦型冷蔵庫
    shelf_unit(root, "back_shelf_left", (-2.6, BACK_Y - WALL_T / 2 - 0.3, 0), 0.0, 1.8)
    shelf_unit(root, "back_shelf_mid", (-0.4, BACK_Y - WALL_T / 2 - 0.3, 0), 0.0, 1.8)
    shelf_unit(root, "back_shelf_right", (1.8, BACK_Y - WALL_T / 2 - 0.3, 0), 0.0, 1.8)
    drink_cooler(root, "drink_cooler", (3.2, BACK_Y - WALL_T / 2 - 0.4))
    # 左の壁の冷蔵ケース（壁に向けて正面は右）
    fridge_case(root, "fridge_front", (LEFT_X + WALL_T / 2 + 0.3, 1.3, 0), math.pi / 2)
    fridge_case(root, "fridge_back", (LEFT_X + WALL_T / 2 + 0.3, -1.5, 0), math.pi / 2)
    # 中央の島（両面に棚）
    shelf_unit(root, "island_north", (-0.6, 0.2, 0), 0.0, 2.0, both_sides=True)
    shelf_unit(root, "island_south", (-0.6, -1.6, 0), 0.0, 2.0, both_sides=True)
    checkout(root)
    hot_food_warmer(root, (0.2, -3.2 + 0.3))
    snack_rack(root, (-1.9, -3.2))
    magazine_rack(root, (-3.0, -3.3))
    basket_stack(root, (1.4, -1.0))
    people(root)
    return root


def people(root) -> None:
    # レジの店員（制服・ベスト）。カウンター（-Y 側）の方を向く
    staff = {"skin": M["skin_t"], "hair": M["hair_black"], "top": M["uniform"], "bottom": M["pants_navy"],
             "shoe": M["shoe_black"], "eye": M["eye"], "hair_style": "bun"}
    person(root, "cashier", (2.6, -2.05), 0.0, staff, pose="point", point_side=-1)
    # カウンターの前で会計する客（+Y 側を向く）
    customer = {"skin": M["skin_l"], "hair": M["hair_brown"], "top": M["top_yellow"], "bottom": M["bottom_beige"],
                "shoe": M["shoe_white"], "eye": M["eye"], "hair_style": "long"}
    person(root, "customer_paying", (2.6, -3.55), math.pi, customer, pose="stand")
    # 冷蔵ケースの前で選ぶ客（左の壁の方を向く）
    drinks = {"skin": M["skin_m"], "hair": M["hair_grey"], "top": M["top_grey"], "bottom": M["bottom_black"],
              "shoe": M["shoe_brown"], "eye": M["eye"], "hair_style": "short"}
    person(root, "customer_fridge", (-2.6, 0.2), -math.pi / 2, drinks, pose="point", point_side=1)
    # 通路で買い物かごを持って歩く客（島の方へ）
    walker = {"skin": M["skin_d"], "hair": M["hair_black"], "top": M["top_green"], "bottom": M["bottom_black"],
              "shoe": M["shoe_white"], "eye": M["eye"], "hair_style": "bun"}
    person(root, "customer_walking", (0.9, -0.4), 0.9, walker, pose="walk")
    # 棚の前で商品を見ている客（スマホを見ながら）
    phone = {"skin": M["skin_t"], "hair": M["hair_black"], "top": M["top_green"], "bottom": M["bottom_beige"],
             "shoe": M["shoe_brown"], "eye": M["eye"], "hair_style": "long", "skirt": True}
    person(root, "customer_phone", (-1.4, 1.25), 0.0, phone, pose="phone")


def build() -> bpy.types.Object:
    make_materials()
    return build_store()


run("convenience_store", build)
