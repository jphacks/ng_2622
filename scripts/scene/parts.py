"""シーンを組み立てる部品（プロトコル v1）を作り、部品ごとの USDZ とメタデータの JSON を書き出す。

仕様は docs/design/scene-protocol.md の「部品」と「最初に作る部品（34 個）」。そのあと場面の文の調べ
（research/scene-sentence-coverage.md）で「足すと効く」とされた物と人物を足した（一覧は assets/parts/README.md）。
Blender の中で動かす（Blender 4.5 LTS と 4.0 で確認）。共通の道具は common.py。

  assets/parts/<id>/1.usdz   部品の 3D モデル。原点は底面の中心、正面は +Z、Y が上、メートル
  assets/parts/<id>/1.json   メタデータ（id・version・file・category・words・pose・size・label・anchors）
  assets/parts/index.json    全部品のメタデータの配列

形は今のシーン（park.py など）の部品を書き写して、大きさと向きをプロトコルに合わせたもの。
シーンのスクリプトは読み込むとそのシーンを書き出してしまうので、関数は呼ばずに写してある。

部品を作る関数は、置き方の手がかりの点（anchors）を Blender の座標で返せる（返さなければ anchors なし）。
  top:  上に物を置ける面の高さ        seat: 座る点        hip: 座るポーズの人の腰の点
書き出すときに、原点を動かした分と座標の向きを直してプロトコルの座標にする。

使い方:
  blender --background --factory-startup --python scripts/scene/parts.py -- [--only <id>] [--out assets/parts] [--meta-only]
"""
from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REPO, Part, _heights, export_usdz, hand_points, material, materials, person  # noqa: E402

VERSION = 1


# ---------- マテリアル ----------

M = {}


def make_materials() -> None:
    """部品ごとに Blender のデータを作り直すので、そのたびに呼ぶ。"""
    M.clear()
    M.update(materials({
        # 植物と地面（公園）
        "grass": ("#6dbb45", 0.9), "grass_dark": ("#4a9530", 0.9), "grass_light": ("#93d35c", 0.9),
        "bark": ("#6b4428", 0.9), "leaf": ("#3f9a3a", 0.7), "leaf2": ("#5cb848", 0.7), "leaf3": ("#2f7d33", 0.7),
        "stem": ("#4e9a33", 0.7),
        "flower_pink": ("#ff8fb3", 0.6), "flower_yellow": ("#ffd84a", 0.6),
        "flower_white": ("#fffaf0", 0.6), "flower_purple": ("#b48cff", 0.6),
        # 道路（駅前）
        "asphalt": ("#4a4c52", 0.9), "stripe": ("#f4f4f0", 0.7), "curb": ("#bdbab4", 0.8),
        # 公園のベンチ・犬・ボール
        "wood": ("#a8683a", 0.55), "dog": ("#e0893a", 0.7), "dog_white": ("#f6efe4", 0.7), "dog_dark": ("#2a211c", 0.3),
        "white": ("#ffffff", 0.6),
        # 乗り物と機械（駅前・雨のバス停）
        "tire": ("#1e1e22", 0.8), "metal": ("#8e959e", 0.4), "frame": ("#3a3f4a", 0.4), "dark": ("#2a2a30", 0.4),
        "bike": ("#3a7bd5", 0.4), "car_glass": ("#26344a", 0.08), "plate": ("#f4f4ef", 0.5),
        "vending": ("#d9352b", 0.4), "can_a": ("#4f7fd9", 0.5), "can_b": ("#f2c04a", 0.5), "can_c": ("#4fb36a", 0.5),
        "bin": ("#6f8fa8", 0.5), "bin_inside": ("#3d4f5e", 0.7),
        # 家具（カフェの椅子の色に合わせる）
        "table": ("#9a6a42", 0.4), "table_leg": ("#5a3a24", 0.5), "chair": ("#c48a55", 0.5), "cushion": ("#4f7d5a", 0.8),
        "sofa": ("#5a86b8", 0.85), "sofa_cushion": ("#6f9bcc", 0.85), "sofa_leg": ("#5a3a24", 0.5),
        # 小物
        "cardboard": ("#c8955a", 0.85), "tape": ("#a8743f", 0.6),
        "apple": ("#d9352b", 0.4), "apple_stem": ("#5a3a22", 0.8),
        "bag": ("#b0563a", 0.5), "bag_strap": ("#6b3424", 0.5),
        "book_cover": ("#3f6fc8", 0.6), "book_red": ("#e05a4f", 0.6), "page": ("#f7f3e8", 0.8),
        "bottle": ("#cfe8f5", 0.1), "bottle_cap": ("#2f6fd0", 0.4), "bottle_label": ("#4fb3e8", 0.5),
        "cup": ("#ffffff", 0.3), "coffee": ("#4a2a17", 0.15),
        # 人物
        "skin": ("#f6caa6", 0.55), "eye": ("#2a211c", 0.3), "cheek": ("#f59a9a", 0.7), "mouth": ("#a8463d", 0.5),
        "hair_black": ("#2a1f1a", 0.6), "hair_brown": ("#5a3a22", 0.6), "hair_gray": ("#c4c4c4", 0.6),
        "knit_brown": ("#8a6a4a", 0.75), "juice": ("#f29a2e", 0.2), "cloth": ("#f4f4f0", 0.8), "tray": ("#6b4a2f", 0.4),
        "cafe_wall": ("#c98f63", 0.8), "cafe_wood": ("#8a5a35", 0.5), "marble": ("#ece6dc", 0.3), "cake": ("#f0d9a8", 0.6),
        "cake_pink": ("#f5a8b8", 0.5), "cake_choco": ("#6b4028", 0.5), "pot": ("#e8e2d6", 0.6),
        "vest_black": ("#23262b", 0.6), "button_gold": ("#e0b84a", 0.3), "apron": ("#5fb89a", 0.7), "apron_pocket": ("#fff1cf", 0.7), "shirt_green": ("#3f9d6b", 0.7), "pants_beige": ("#c2a36f", 0.7),
        "bill": ("#7fbf7a", 0.7), "rain": ("#6ea6dc", 0.3), "puddle": ("#a3b6c6", 0.15),
        "book_blue": ("#7f9ab8", 0.6), "book_green": ("#93ad90", 0.6), "book_yellow": ("#d8c79a", 0.6), "book_purple": ("#a79cc0", 0.6), "book_brown": ("#b09880", 0.6),
        "shirt_blue": ("#5a8fd6", 0.7), "pants_gray": ("#4a4f5a", 0.7), "shoe_brown": ("#6b4428", 0.5),
        "knit_rose": ("#e07a8a", 0.8), "skirt_navy": ("#2f3b63", 0.8), "shoe_white": ("#f2f2f2", 0.5),
        "shirt_yellow": ("#ffcf3a", 0.7), "shorts_blue": ("#3d6fb6", 0.7), "shoe_red": ("#e3483c", 0.5),
        "dress_pink": ("#f29bb5", 0.75), "pen": ("#2f4fb0", 0.4), "mug": ("#3f8fd9", 0.4),
        # 建物の部分（扉・壁・窓）
        "door": ("#b07a4a", 0.55), "door_panel": ("#9a6538", 0.55), "door_frame": ("#ece6da", 0.6),
        "wall": ("#efe8dc", 0.9), "baseboard": ("#8a6a4a", 0.6), "window_frame": ("#d8dde3", 0.4),
        # 店（レジ・棚・かご・カート）
        "counter": ("#ece7dd", 0.6), "counter_top": ("#6b5a4a", 0.4), "register": ("#3a3f4a", 0.4), "receipt": ("#ffffff", 0.8),
        "shelf": ("#a46d40", 0.6), "basket": ("#d9352b", 0.5), "basket_rim": ("#a8261f", 0.5),
        # M1〜M10 の場面の物
        "jacket": ("#3f6d5c", 0.7), "jacket2": ("#8a5a3a", 0.7), "knife": ("#c9ced4", 0.25), "bird": ("#8d7a66", 0.7), "bird_belly": ("#efe6d6", 0.7),
        "bird_beak": ("#e8a33c", 0.5), "balloon": ("#e8453c", 0.3), "candle": ("#f7e7a0", 0.5), "flame": ("#ffb52e", 0.3),
        "ticket_body": ("#5c7f9e", 0.5), "ticket_screen": ("#1f3a52", 0.3), "stick": ("#9a7248", 0.7), "castle": ("#e3c98f", 0.9), "water": ("#7fc6de", 0.2),
        # 破片（材質ごとの色。形は shards() が作る）と掃除の道具
        "shard_glass": ("#7fc6de", 0.12), "shard_metal": ("#8d96a0", 0.3), "broom_straw": ("#c9a55c", 0.8),
        # 店員のエプロン、メモ帳、バスの中
        "apron_green": ("#3f8f5f", 0.75), "apron_green_pocket": ("#2f7349", 0.75), "notepad": ("#f2c94c", 0.7),
        "bus_wall": ("#e9eaea", 0.8), "bus_floor": ("#6d7680", 0.8), "bus_line": ("#e8c33c", 0.7), "bus_rail": ("#d9b23a", 0.35), "bus_sill": ("#9aa3ab", 0.5),
        # 台所と家の物（皿・フライパン・シャツ・ノートパソコン・時計・ベッド）
        "dish": ("#ffffff", 0.25), "dish_rim": ("#3f6fc8", 0.4),
        "pan": ("#2b2b30", 0.35), "pan_inside": ("#55585f", 0.5), "pan_handle": ("#5a3a24", 0.6),
        "shirt": ("#5b8fd9", 0.8), "button": ("#ffffff", 0.4),
        "laptop": ("#c9cdd3", 0.35), "clock_face": ("#ffffff", 0.4),
        "bed_frame": ("#a8683a", 0.55), "mattress": ("#f4f1ea", 0.8), "blanket": ("#7fb5d9", 0.85), "pillow": ("#ffffff", 0.85),
        # 乗り物の座席
        "seat_fabric": ("#3d6f9e", 0.85),
        # 室内の床（木の床・教室の床・タイル・じゅうたん）
        "floor_gap": ("#7a4e2c", 0.7), "floor_wood_a": ("#b9804e", 0.55), "floor_wood_b": ("#a8703f", 0.55),
        "floor_wood_c": ("#c48c58", 0.55),
        "class_gap": ("#b89262", 0.7), "class_wood_a": ("#e2c08e", 0.5), "class_wood_b": ("#d6b07c", 0.5),
        "class_wood_c": ("#ead0a2", 0.5),
        "grout": ("#a9a69f", 0.8), "tile_white": ("#f6f5f1", 0.25), "tile_gray": ("#cfd4d8", 0.25),
        "carpet": ("#7d93b8", 0.95), "carpet_border": ("#5d729b", 0.95), "carpet_line": ("#efe3c8", 0.95),
        # 屋外の床（駅のホーム・砂浜・石畳・土）
        "platform": ("#cfccc5", 0.85), "tactile": ("#f2c230", 0.6), "ballast": ("#8d857b", 0.95),
        "sleeper": ("#7a5a42", 0.8), "rail": ("#a3a9b1", 0.35),
        "sand": ("#e8d6b0", 0.95), "sand_dark": ("#dcc59a", 0.95), "sand_light": ("#efe1c4", 0.95),
        "shell": ("#f8d4c8", 0.5), "pebble": ("#b9b1a5", 0.8),
        "stone_joint": ("#8c877f", 0.9), "stone_a": ("#b8b3aa", 0.85), "stone_b": ("#a9a39a", 0.85), "stone_c": ("#c7c2b8", 0.85),
        "dirt": ("#c79c6c", 0.95), "dirt_dark": ("#b5875a", 0.95), "dirt_light": ("#d6b083", 0.95),
        # 背景の壁（窓・キッチンのタイル・黒板・商品棚）
        "wall_back": ("#ddd5c8", 0.9), "curtain": ("#f3d9a8", 0.9), "wall_kitchen": ("#f2dfb8", 0.9),
        "kitchen_tile": ("#ffffff", 0.3), "kitchen_tile2": ("#a9d8c4", 0.3), "cabinet": ("#b98352", 0.5),
        "blackboard": ("#2f5a46", 0.8), "board_frame": ("#a8743f", 0.55), "wainscot": ("#c9a272", 0.6),
        "chalk": ("#ffffff", 0.9), "chalk_pink": ("#ffb3c1", 0.9), "chalk_yellow": ("#ffe68a", 0.9),
        "store_wall": ("#f4f1ea", 0.9), "store_shelf": ("#e3e6ea", 0.4), "store_sign": ("#f08a4b", 0.6),
        "goods_a": ("#ef7a6a", 0.6), "goods_b": ("#f5c76a", 0.6), "goods_c": ("#7cc48a", 0.6),
        "goods_d": ("#78a8e0", 0.6), "goods_e": ("#f2a3c4", 0.6), "goods_f": ("#ffffff", 0.6),
        # 場面らしさを出す大物（台所の流しとコンロ・電車・駅名の看板・バス停）
        "steel": ("#c9cdd3", 0.3), "sink": ("#8d949c", 0.3), "stove": ("#2b2b30", 0.2), "burner": ("#6a6d74", 0.5),
        "train_body": ("#eef0f2", 0.4), "train_band": ("#4fae78", 0.5), "train_door": ("#d9dde2", 0.4),
        "train_roof": ("#a9afb7", 0.6),
        "sign_board": ("#fbfbf7", 0.5), "sign_band": ("#3f8fd0", 0.5), "sign_text": ("#3a3f4a", 0.5),
        "shelter_frame": ("#6f7c8a", 0.4), "shelter_roof": ("#5f8fb5", 0.5), "busstop_sign": ("#e3685a", 0.5),
    }))
    M["iron"] = material("iron", "#2b2b30", 0.35, metal=0.8)
    M["ball"] = material("ball", "#e8352b", 0.3, coat=0.6)
    M["car"] = material("car", "#d0342c", 0.25, coat=0.8)
    M["umbrella"] = material("umbrella", "#3f7fe0", 0.3, coat=0.5)
    M["umbrella_inner"] = material("umbrella_inner", "#2f63b8", 0.4)
    M["headlight"] = material("headlight", "#fff6dc", 0.2, emit=5.0)
    M["taillight"] = material("taillight", "#ff3a2e", 0.3, emit=3.0)
    M["vending_glow"] = material("vending_glow", "#fff6dc", 0.2, emit=1.2)
    M["screen"] = material("screen", "#9fd0ff", 0.2, emit=1.5)
    # 向きを確かめるための目印。色は同じものと変えず、名前だけ分ける（check_parts.py が名前で探す）
    M["bench_back"] = material("bench_back", "#a8683a", 0.55)
    M["chair_back"] = material("chair_back", "#c48a55", 0.5)
    M["sofa_back"] = material("sofa_back", "#5a86b8", 0.85)
    M["bike_basket"] = material("bike_basket", "#8e959e", 0.4)
    M["window_sill"] = material("window_sill", "#d8dde3", 0.4)
    M["counter_front"] = material("counter_front", "#2f8f5b", 0.5)
    M["shelf_back"] = material("shelf_back", "#8e5c35", 0.6)
    M["shirt_collar"] = material("shirt_collar", "#f4f4f0", 0.7)
    M["seat_back"] = material("seat_back", "#3d6f9e", 0.85)
    M["trackpad"] = material("trackpad", "#a9aeb6", 0.3)
    M["cart_handle"] = material("cart_handle", "#d9352b", 0.5)
    M["laptop_screen"] = material("laptop_screen", "#3f78c8", 0.2, emit=0.6)   # screen（スマートフォン）より暗くして、白く飛ばないようにする
    # 窓のガラスの向こうは明るい空（classroom.py の sky と同じ）
    M["window_glass"] = material("window_glass", "#9fd0ff", 0.2, emit=0.5)
    M["platform_edge"] = material("platform_edge", "#f6f5f1", 0.7)   # ホームの端の白線（向きの目印）
    M["wall_window_sill"] = material("wall_window_sill", "#d8dde3", 0.4)   # 窓つきの壁の窓台（向きの目印）
    M["kitchen_cabinet"] = material("kitchen_cabinet", "#c8935e", 0.5)   # キッチンの壁の吊り戸棚の扉（向きの目印）
    M["chalk_tray"] = material("chalk_tray", "#a8743f", 0.55)            # 黒板の粉受け（向きの目印）
    M["price_rail"] = material("price_rail", "#ffe27a", 0.5)             # 商品棚の値札の帯（向きの目印）
    M["kitchen_front"] = material("kitchen_front", "#d8b07c", 0.5)       # 流しとコンロの扉（向きの目印）
    M["shelter_back"] = material("shelter_back", "#cfe3f0", 0.2)         # バス停の後ろの板（向きの目印）
    M["cafe_groove"] = material("cafe_groove", "#6e4427", 0.6)           # カフェのカウンターの前板の溝（向きの目印）
    M["cafe_lamp"] = material("cafe_lamp", "#ffd98a", 0.3, emit=1.2)
    M["shelter_bench"] = material("shelter_bench", "#a8683a", 0.55)      # バス停のベンチの板（check_parts.py が座る確かめに使う）


CHILD_SCALE = 0.75   # 子どもの大きさ（大人に対する倍率）
SH_STAND = 1.3       # 立つ・歩くポーズの肩の高さ（common.py の _heights）
SEAT_Z = 0.46        # 座るポーズに合う座面の高さ。chair・sofa をこの高さにする（bench は 0.48）
# 地面の板の厚さ。y = 0 に置いた小物（スマートフォン・本）が埋まらないよう薄くする。
# road_patch は grass_patch に重ねて置くので、上面を芝の板とまだらより上にしてちらつかないようにする
GRASS_THICK = 0.002  # 芝の板（上面 2 mm）。濃淡のまだらはその上に 0.5 mm
ROAD_THICK = 0.003   # 道路の板（上面 3 mm）。白線はその上に 0.5 mm
MARK_THICK = 0.0005  # 芝のまだら・道路の白線の厚さ
FLOOR_THICK = 0.002  # 床の部品（floor_*・platform_station など）の板。芝の板と同じ 2 mm で、模様はその上に MARK_THICK ずつ重ねる


# ---------- 部品の一覧 ----------

PARTS: dict[str, dict] = {}


def part(pid, category, label, words, pose=None, front=None):
    """部品を作る関数を一覧に登録する。

    words は (語, 品詞) の組。front は向きを確かめる目印で、(マテリアル名, 1) なら正面（+Z）側に、
    (マテリアル名, -1) なら背中（-Z）側にあるはずのもの。左右対称で向きが無い部品は None。
    登録する関数は root を受け取って形を作り、anchors（Blender の座標。top は z、seat・hip は (x, y, z)）を返してよい。
    """
    def register(fn):
        PARTS[pid] = {"build": fn, "category": category, "label": label, "pose": pose, "front": front,
                      "words": [{"word": w, "pos": p} for w, p in words]}
        return fn
    return register


# ---------- 植物と地面 ----------

@part("tree", "plant", "木", [("tree", "noun")])
def build_tree(root):
    """公園の大きな木（park.py の build_tree、高さ 3.2 m）。"""
    height, crown = 3.2, 1.0
    p = Part("tree")
    trunk_h = height * 0.5
    p.cyl(0.2, 0.11, trunk_h, (0, 0, trunk_h / 2), M["bark"], segs=10)
    p.cyl(0.07, 0.04, 0.8, (0.22, 0, trunk_h * 0.85), M["bark"], rot=(0, 0.8, 0), segs=8)
    p.cyl(0.06, 0.035, 0.7, (-0.18, 0.05, trunk_h * 0.9), M["bark"], rot=(0.2, -0.7, 0), segs=8)
    mats = [M["leaf"], M["leaf2"], M["leaf3"]]
    cz = trunk_h + 0.75 * crown
    blobs = [(0, 0, cz, 0.95), (0.6, 0.2, cz - 0.25, 0.7), (-0.55, -0.15, cz - 0.2, 0.72),
             (0.1, -0.5, cz - 0.1, 0.65), (-0.1, 0.5, cz + 0.05, 0.68), (0.15, 0.05, cz + 0.6, 0.62)]
    for i, (x, y, z, r) in enumerate(blobs):
        p.blob(r * crown, (x * crown, y * crown, z), mats[i % 3], bumpy=0.18, subdiv=3, seed=i * 3.1 + 2.3)
    p.finish(root)


@part("flower", "plant", "花", [("flower", "noun")])
def build_flower(root):
    """数本の花の株（park.py の build_flowers を小さくまとめたもの）。複数形でも言えるように 9 本にする。"""
    rng = random.Random(2622)
    p = Part("flower")
    colors = [M["flower_pink"], M["flower_yellow"], M["flower_white"], M["flower_purple"]]
    for k in range(5):  # 根元の葉
        a = k / 5 * math.tau
        p.blob(0.07, (math.cos(a) * 0.08, math.sin(a) * 0.08, 0.035), M["leaf2"], scale=(1, 1, 0.5), bumpy=0.3, subdiv=1, seed=k * 1.3)
    for k in range(9):
        a, d = k / 9 * math.tau + rng.uniform(-0.3, 0.3), 0.04 + 0.1 * (k % 3) / 2
        x, y = math.cos(a) * d, math.sin(a) * d
        h = rng.uniform(0.2, 0.32)
        p.cyl(0.012, 0.01, h, (x, y, h / 2), M["stem"], segs=6)
        p.blob(0.06, (x, y, h), colors[k % 4], scale=(1, 1, 0.7), bumpy=0.35, subdiv=1, seed=rng.random() * 9)
        p.sphere(0.022, (x, y, h + 0.035), M["flower_yellow"], segs=8)
    p.finish(root)


@part("grass_patch", "ground", "芝生（8 m 四方の地面）", [("grass", "noun")])
def build_grass_patch(root):
    """公園の芝の地面（park.py の build_island の上面と build_grass の草むら）。8 m × 8 m の薄い板。

    人や物は y = 0 に置くので、板は 2 mm と薄くして小物が埋まらないようにする（草むらは上に出る）。
    """
    rng = random.Random(2622)
    size, thick = 8.0, GRASS_THICK
    p = Part("grass_patch")
    p.slab(size, thick, thick, 0.3, M["grass"], segments=6, center=(0, 0))
    # 色の濃い芝のまだら（平たい円）
    for _ in range(40):
        x, y = rng.uniform(-3.6, 3.6), rng.uniform(-3.6, 3.6)
        r = rng.uniform(0.25, 0.6)
        p.cyl(r, r, MARK_THICK, (x, y, thick + MARK_THICK / 2), rng.choice([M["grass_dark"], M["grass_light"]]), segs=14, smooth=False)
    # 草むら
    q = Part("grass_tufts")
    for _ in range(140):
        x, y = rng.uniform(-3.8, 3.8), rng.uniform(-3.8, 3.8)
        mat = rng.choice([M["grass_dark"], M["grass_dark"], M["grass_light"]])
        for _ in range(rng.randint(3, 5)):
            h = rng.uniform(0.06, 0.12)
            lean = (rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 0)
            # 傾けた円すいの底の最も低い点が板の上面より 1 mm 下に来る高さに置く（板の下には出さない）
            cos_t = math.cos(lean[0]) * math.cos(lean[1])
            z = thick - 0.001 + h / 2 * cos_t + 0.028 * math.sqrt(1 - cos_t ** 2)
            q.cyl(0.028, 0.0, h, (x + rng.uniform(-0.05, 0.05), y + rng.uniform(-0.05, 0.05), z), mat,
                  rot=lean, segs=4, smooth=False)
    p.finish(root)
    q.finish(root)


@part("road_patch", "ground", "道路（横断歩道つき）", [("road", "noun"), ("street", "noun"), ("crosswalk", "noun")])
def build_road_patch(root):
    """駅前の道路（station.py の build_road）。片側 1 車線ずつの 2 車線で、長さ 8 m・幅 5.5 m。

    幅は日本の 2 車線の生活道路（1 車線 2.75 m）に合わせる。長い向きは X。真ん中に横断歩道がある。
    板は 3 mm（白線の上面 3.5 mm）。grass_patch に重ねたとき、芝の板（2 mm）とまだら（2.5 mm）より上に来る。
    """
    length, width, thick = 8.0, 5.5, ROAD_THICK
    p = Part("road_patch")
    p.slab((length, width), thick, thick, 0.05, M["asphalt"], segments=2)
    top = thick + MARK_THICK / 2   # 白線の中心の高さ（白線の底は板の上面）
    # 横断歩道（白い帯。車の進む向き（X）に長く、道路の幅の向きに並ぶ。人は帯をまたいで渡る）
    for k in range(6):
        p.box((3.0, 0.45, MARK_THICK), (0, (k - 2.5) * 0.85, top), M["stripe"])
    # 端の白線と、横断歩道の外の中央線（破線）
    for sy in (-1, 1):
        p.box((length - 0.1, 0.12, MARK_THICK), (0, sy * (width / 2 - 0.25), top), M["stripe"])
    for sx in (-1, 1):
        p.box((0.7, 0.12, MARK_THICK), (sx * 3.5, 0, top), M["stripe"])
    p.finish(root)


# ---------- 家具 ----------

@part("bench", "furniture", "ベンチ", [("bench", "noun")], front=("bench_back", -1))
def build_bench(root):
    """公園のベンチ（park.py の build_bench）。座面の高さは 0.48 m。背もたれは奥（-Z）。"""
    p = Part("bench")
    slat_y, slat_d, slat_t, slat_z = [-0.17 + i * 0.105 for i in range(4)], 0.085, 0.045, 0.46
    for y in slat_y:
        p.box((1.6, slat_d, slat_t), (0, y, slat_z), M["wood"], bevel=0.012)
    for i in range(3):
        p.box((1.6, 0.045, 0.085), (0, 0.27, 0.62 + i * 0.12), M["bench_back"], rot=(-0.22, 0, 0), bevel=0.012)
    for x in (-0.68, 0.68):
        p.box((0.05, 0.05, 0.45), (x, -0.17, 0.225), M["iron"], bevel=0.01)
        p.box((0.05, 0.05, 0.95), (x, 0.24, 0.47), M["iron"], rot=(-0.22, 0, 0), bevel=0.01)
        p.box((0.06, 0.5, 0.045), (x, 0.02, 0.66), M["iron"], bevel=0.015)
        p.box((0.05, 0.45, 0.04), (x, 0.03, 0.43), M["iron"], bevel=0.01)
    p.finish(root)
    # 座る点は座面の板の上面の、左右と前後の真ん中
    return {"seat": (0, (slat_y[0] + slat_y[-1]) / 2, slat_z + slat_t / 2)}


def table_shape(p, w, d, h=0.72):
    """四角い木のテーブル（高さ 0.72 m は椅子の座面 0.46 m に合う）。"""
    p.box((w, d, 0.04), (0, 0, h - 0.02), M["table"], bevel=0.012)
    p.box((w - 0.12, d - 0.12, 0.08), (0, 0, h - 0.08), M["table_leg"], bevel=0.01)   # 天板の下の枠
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.05, 0.05, h - 0.04), (sx * (w / 2 - 0.08), sy * (d / 2 - 0.08), (h - 0.04) / 2), M["table_leg"], bevel=0.008)


def table_seats(w, d, n):
    """テーブルの席（床の上の椅子の位置）。名前は seat_<front|back|end>_<番号>で、front は正面（カメラ）側、end は短い辺。"""
    seats = {}
    for side, y in (("front", -(d / 2 + 0.22)), ("back", d / 2 + 0.22)):
        for k in range(n):
            seats[f"seat_{side}_{k + 1}"] = (-w / 2 + w / n * (k + 0.5), y, 0.0)
    for k, x in enumerate((-(w / 2 + 0.22), w / 2 + 0.22)):   # 短い辺の席
        seats[f"seat_end_{k + 1}"] = (x, 0.0, 0.0)
    return seats


@part("table", "furniture", "テーブル", [("table", "noun")])
def build_table(root):
    """四角い木のテーブル。天板は 1.2 m × 0.75 m。"""
    p = Part("table")
    table_shape(p, 1.2, 0.75)
    p.finish(root)
    return {"top": 0.72, "seats": table_seats(1.2, 0.75, 2)}   # 天板の上面と席


# 人数に合わせた大きさのテーブル
for _pid, _label, _w, _d, _n in (("table_small", "2 人用の小さなテーブル", 0.8, 0.75, 1),
                                 ("table_long", "3〜6 人用の長いテーブル", 2.1, 0.9, 3),
                                 ("table_party", "8 人以上の大きなテーブル", 3.6, 1.0, 5)):
    def _build(root, pid=_pid, w=_w, d=_d, n=_n):
        p = Part(pid)
        table_shape(p, w, d)
        p.finish(root)
        return {"top": 0.72, "seats": table_seats(w, d, n)}
    part(_pid, "furniture", _label, [("table", "noun")])(_build)


@part("chair", "furniture", "椅子", [("chair", "noun")], front=("chair_back", -1))
def build_chair(root):
    """木の椅子（cafe.py の build_chair）。座面（クッションの上）は 0.46 m。背もたれは奥（-Z）。"""
    p = Part("chair")
    seat = SEAT_Z - 0.045   # クッションの厚みの分だけ下げる
    p.box((0.42, 0.42, 0.04), (0, 0, seat), M["chair"], bevel=0.012)
    p.box((0.38, 0.38, 0.03), (0, 0, seat + 0.03), M["cushion"], bevel=0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.02, 0.018, seat, (sx * 0.17, sy * 0.17, seat / 2), M["chair"], segs=8)
        p.cyl(0.02, 0.02, 0.5, (sx * 0.17, 0.19, seat + 0.27), M["chair"], segs=8)
    p.box((0.38, 0.03, 0.14), (0, 0.19, seat + 0.43), M["chair_back"], bevel=0.01)
    p.box((0.38, 0.03, 0.05), (0, 0.19, seat + 0.23), M["chair_back"], bevel=0.01)
    p.finish(root)
    return {"seat": (0, 0, seat + 0.03 + 0.03 / 2)}   # クッションの上面の中心


@part("sofa", "furniture", "ソファ", [("sofa", "noun"), ("couch", "noun")], front=("sofa_back", -1))
def build_sofa(root):
    """2 人がけのソファ。幅 1.8 m、座面 0.46 m、背もたれは奥（-Z）で高さ 0.85 m。"""
    w, d = 1.8, 0.88
    p = Part("sofa")
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.03, 0.025, 0.1, (sx * (w / 2 - 0.1), sy * (d / 2 - 0.1), 0.05), M["sofa_leg"], segs=8)
    p.box((w, d, 0.24), (0, 0, 0.22), M["sofa"], bevel=0.04)                       # 土台
    cushion_y, cushion_t = -0.1, 0.14
    for sx in (-1, 1):
        p.box((0.68, 0.62, cushion_t), (sx * 0.35, cushion_y, SEAT_Z - cushion_t / 2), M["sofa_cushion"], bevel=0.05)   # 座面のクッション
        p.box((0.2, d, 0.3), (sx * (w / 2 - 0.1), 0, 0.47), M["sofa"], bevel=0.06)          # ひじかけ
        p.box((0.68, 0.18, 0.36), (sx * 0.36, 0.2, SEAT_Z + 0.2), M["sofa_cushion"], rot=(-0.12, 0, 0), bevel=0.06)  # 背のクッション
    p.box((w - 0.04, 0.2, 0.52), (0, d / 2 - 0.1, 0.59), M["sofa_back"], bevel=0.06)          # 背もたれ
    p.finish(root)
    return {"seat": (0, cushion_y, SEAT_Z)}   # 2 つの座面のクッションの真ん中の上面


# ---------- 乗り物と機械 ----------

@part("bicycle", "vehicle", "自転車", [("bicycle", "noun"), ("bike", "noun")], front=("bike_basket", 1))
def build_bicycle(root):
    """前かごのある自転車（station.py の build_bicycle）。進む向き（前輪）が正面（+Z）。"""
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
    p.box((0.3, 0.22, 0.18), (0, -0.62, 0.85), M["bike_basket"], bevel=0.02)   # 前かご
    p.finish(root)


@part("car", "vehicle", "車", [("car", "noun")], front=("headlight", 1))
def build_car(root):
    """赤い小さな車（rainy_street.py の build_car）。シーンの車は小さく作ってあるので、実物の大きさに直す。

    長さ 3.9 m・幅 1.7 m・高さ 1.5 m（小型車）。形の比率はシーンの車のまま、X・Y・Z をそれぞれ伸ばし、
    タイヤだけは丸のまま半径 0.3 m にする。ライトのある前が正面（+Z）。
    """
    S = Vector((1.75, 1.95, 1.37))   # シーンの車からの倍率（幅・長さ・高さ）
    p = Part("car")

    def box(size, loc, mat, bevel):
        p.box(Vector(size) * S, Vector(loc) * S, mat, bevel=bevel * 1.4)

    box((0.95, 2.0, 0.48), (0, 0, 0.45), M["car"], 0.14)
    box((0.86, 1.15, 0.46), (0, 0.18, 0.86), M["car"], 0.1)
    box((0.88, 1.2, 0.28), (0, 0.16, 0.88), M["car_glass"], 0.06)
    for sx in (-1, 1):
        for sy in (-0.64, 0.66):
            x, y = sx * 0.44 * S.x, sy * S.y
            p.cyl(0.3, 0.3, 0.24, (x, y, 0.3), M["tire"], rot=(0, math.pi / 2, 0), segs=20)
            p.cyl(0.17, 0.17, 0.25, (x, y, 0.3), M["metal"], rot=(0, math.pi / 2, 0), segs=14, smooth=False)
        box((0.2, 0.05, 0.1), (sx * 0.3, -1.0, 0.52), M["headlight"], 0.03)
        box((0.16, 0.05, 0.1), (sx * 0.32, 1.0, 0.55), M["taillight"], 0.03)
        box((0.1, 0.08, 0.07), (sx * 0.5, -0.38, 0.78), M["car"], 0.02)   # ミラー
    box((0.32, 0.03, 0.1), (0, -1.01, 0.32), M["plate"], 0.01)
    box((0.32, 0.03, 0.1), (0, 1.01, 0.34), M["plate"], 0.01)
    box((0.7, 0.04, 0.06), (0, -1.0, 0.36), M["dark"], 0.02)
    a, b = Vector((-0.3, -0.42, 0.78)) * S, Vector((0.1, -0.44, 0.84)) * S
    p.limb(a, b, 0.014, 0.014, M["dark"], segs=4)  # ワイパー
    p.finish(root)


@part("vending_machine", "thing", "自動販売機", [("vending machine", "noun")], front=("vending_glow", 1))
def build_vending_machine(root):
    """飲み物の自動販売機（station.py の build_vending）。幅 0.9 m・高さ 1.8 m。商品の窓が正面（+Z）。"""
    p = Part("vending_machine")
    p.box((0.9, 0.7, 1.8), (0, 0, 0.9), M["vending"], bevel=0.03)
    p.box((0.76, 0.04, 0.9), (0, -0.35, 1.2), M["vending_glow"])
    for row, z in enumerate((1.5, 1.22, 0.94)):
        for k in range(5):
            p.cyl(0.04, 0.04, 0.14, (-0.28 + k * 0.14, -0.37, z), M[["can_a", "can_b", "can_c"][(row + k) % 3]], segs=10)
    p.box((0.6, 0.06, 0.14), (0, -0.36, 0.4), M["dark"], bevel=0.02)
    p.finish(root)


@part("trash_bin", "thing", "ごみ箱", [("trash can", "noun"), ("trash bin", "noun")])
def build_trash_bin(root):
    """丸いごみ箱（classroom.py の build_bin）。上から中が見えるように、口の内側を濃い色にする。"""
    p = Part("trash_bin")
    p.cyl(0.2, 0.17, 0.45, (0, 0, 0.225), M["bin"], segs=20)
    p.cyl(0.21, 0.21, 0.03, (0, 0, 0.45), M["bin"], segs=20)
    p.cyl(0.175, 0.175, 0.01, (0, 0, 0.462), M["bin_inside"], segs=20, smooth=False)
    p.finish(root)


# ---------- 小物 ----------

@part("ball_red", "thing", "赤いボール", [("ball", "noun")])
def build_ball_red(root):
    """赤いボール（park.py の build_ball）。直径 0.24 m。"""
    p = Part("ball_red")
    p.sphere(0.12, (0, 0, 0.12), M["ball"], segs=24)
    p.cyl(0.121, 0.121, 0.025, (0, 0, 0.12), M["white"], rot=(0.5, 0.3, 0), segs=24)
    p.finish(root)


def umbrella(p, hand, top, radius=0.55, drop=0.24):
    """開いた傘（rainy_street.py の build_umbrella）。hand は持ち手、top は先の位置。"""
    hand, top = Vector(hand), Vector(top)
    axis = (top - hand).normalized()
    p.limb(hand - axis * 0.1, top + axis * 0.08, 0.012, 0.012, M["dark"], segs=6)
    p.limb(hand - axis * 0.1, hand - axis * 0.1 + Vector((0, -0.05, -0.04)), 0.016, 0.016, M["dark"], segs=6)
    # 8 枚の布（外は青、裏は濃い青）。先から骨に沿って下がる
    ribs = 8
    rot = axis.to_track_quat("Z", "Y")
    rim = [top + rot @ Vector((math.cos(k / ribs * math.tau) * radius, math.sin(k / ribs * math.tau) * radius, -drop)) for k in range(ribs)]
    for k in range(ribs):
        a, b = rim[k], rim[(k + 1) % ribs]
        mid = (a + b) / 2 + rot @ Vector((0, 0, 0.05))
        p.poly((top, a, mid), M["umbrella"])
        p.poly((top, mid, b), M["umbrella"])
        under = rot @ Vector((0, 0, -0.012))   # 裏地は少し下に、下向きに張る
        p.poly((top + under, mid + under, a + under), M["umbrella_inner"])
        p.poly((top + under, b + under, mid + under), M["umbrella_inner"])
        p.sphere(0.016, tuple(a), M["dark"], segs=6)


@part("umbrella", "thing", "傘（開いた）", [("umbrella", "noun")])
def build_umbrella(root):
    """開いた傘をまっすぐ立てたもの。長さ 0.9 m、布の直径 1.1 m。持ち手が下（y = 0）。"""
    p = Part("umbrella")
    umbrella(p, hand=(0, 0, 0.14), top=(0, 0, 0.88))
    p.finish(root)


@part("smartphone", "thing", "スマートフォン", [("smartphone", "noun"), ("phone", "noun")])
def build_smartphone(root):
    """画面を上にして置いたスマートフォン（cafe.py の phone）。7.5 cm × 15.5 cm。画面は光らせて目立たせる。"""
    p = Part("smartphone")
    p.box((0.075, 0.155, 0.008), (0, 0, 0.004), M["dark"], bevel=0.003, segments=2)
    p.box((0.066, 0.138, 0.002), (0, 0, 0.0085), M["screen"])
    p.finish(root)


def box_shape(p, size, loc):
    """段ボール箱。上のふたの合わせ目にテープを貼る。loc は箱の底の中心。"""
    w, d, h = size
    x, y, z = loc
    p.box((w, d, h), (x, y, z + h / 2), M["cardboard"], bevel=0.006, segments=1)
    p.box((0.07, d + 0.004, 0.004), (x, y, z + h + 0.001), M["tape"])
    for sy in (-1, 1):
        p.box((0.07, 0.004, h * 0.3), (x, y + sy * (d / 2 + 0.001), z + h * 0.85), M["tape"])


@part("box", "thing", "段ボール箱", [("box", "noun")])
def build_box(root):
    """段ボール箱。幅 0.45 m・高さ 0.35 m・奥行き 0.35 m。"""
    p = Part("box")
    h = 0.35
    box_shape(p, (0.45, 0.35, h), (0, 0, 0))
    p.finish(root)
    return {"top": h}   # ふたの上面（テープの厚みは含めない）


def apple_shape(p, loc, r=0.04):
    """リンゴ。loc は実の中心。"""
    x, y, z = loc
    p.sphere(r, (x, y, z), M["apple"], scale=(1, 1, 0.92), segs=20)
    p.limb((x, y, z + r * 0.75), (x + 0.004, y, z + r * 1.3), 0.004, 0.003, M["apple_stem"], segs=6)
    p.sphere(r * 0.35, (x + r * 0.3, y, z + r * 1.05), M["leaf2"], scale=(1, 0.45, 0.25), rot=(0, -0.5, 0), segs=10)


@part("apple_red", "food", "赤いリンゴ", [("apple", "noun")])
def build_apple_red(root):
    """赤いリンゴ。直径 8 cm。"""
    p = Part("apple_red")
    apple_shape(p, (0, 0, 0.04 * 0.92))
    p.finish(root)


@part("bag", "thing", "かばん（トートバッグ）", [("bag", "noun")])
def build_bag(root):
    """持ち手が 2 本のトートバッグ（rainy_street.py の handbag を大きくしたもの）。幅 0.38 m。"""
    p = Part("bag")
    p.box((0.38, 0.13, 0.3), (0, 0, 0.15), M["bag"], bevel=0.03)
    p.box((0.38 - 0.02, 0.135, 0.04), (0, 0, 0.26), M["bag_strap"], bevel=0.01)     # 口の縁
    for sy in (-1, 1):
        y = sy * 0.04
        pts = [Vector((-0.09, y, 0.29)), Vector((-0.07, y, 0.4)), Vector((0.07, y, 0.4)), Vector((0.09, y, 0.29))]
        for a, b in zip(pts, pts[1:]):
            p.limb(a, b, 0.009, 0.009, M["bag_strap"], segs=6)
    p.finish(root)


def book_open(p, loc, tilt=0.9, cover="book_red"):
    """開いた本。loc は背の位置。背から左右に開き、ページを読む人（+Y）に向ける。

    tilt は X 軸まわりの傾き。正にすると上の端が前（-Y）へ倒れ、ページが上の顔のほうを向く。
    """
    x, y, z = Vector(loc)
    for sx in (-1, 1):
        rot = Euler((tilt, -sx * 0.25, 0))   # 読む人に向けて傾け、左右に少し開く
        c = Vector((x + sx * 0.08, y, z))
        p.box((0.16, 0.008, 0.23), c, M[cover], rot=rot)
        p.box((0.15, 0.024, 0.22), c + rot.to_matrix() @ Vector((0, 0.016, 0)), M["page"], rot=rot)


@part("book", "thing", "本", [("book", "noun")])
def build_book(root):
    """閉じて平らに置いた本。15 cm × 21 cm、厚さ 3 cm。表紙は青、背は手前（+Z）から見て左。"""
    p = Part("book")
    w, d, t = 0.15, 0.21, 0.03
    p.box((w, d, 0.004), (0, 0, 0.002), M["book_cover"])
    p.box((w, d, 0.004), (0, 0, t - 0.002), M["book_cover"])
    p.box((0.008, d, t), (-w / 2 + 0.004, 0, t / 2), M["book_cover"])   # 背
    p.box((w - 0.012, d - 0.008, t - 0.008), (0.002, 0, t / 2), M["page"])
    p.box((0.03, d + 0.001, 0.0045), (-0.03, 0, t - 0.002), M["book_red"])  # 表紙の帯
    p.finish(root)


@part("bottle", "thing", "ペットボトル", [("bottle", "noun")])
def build_bottle(root):
    """水のペットボトル（500 mL）。直径 7 cm・高さ 0.21 m。"""
    p = Part("bottle")
    r = 0.035
    p.cyl(r, r, 0.15, (0, 0, 0.075), M["bottle"], segs=20)
    p.cyl(r, 0.014, 0.04, (0, 0, 0.17), M["bottle"], segs=20)
    p.cyl(0.0155, 0.0155, 0.02, (0, 0, 0.2), M["bottle_cap"], segs=14)
    p.cyl(r + 0.001, r + 0.001, 0.06, (0, 0, 0.085), M["bottle_label"], segs=20)
    p.finish(root)


@part("cup", "thing", "コーヒーカップ", [("cup", "noun"), ("coffee", "noun")])
def build_cup(root):
    """受け皿つきのコーヒーカップ（cafe.py の cup）。持ち手は +X。"""
    p = Part("cup")
    p.cyl(0.07, 0.06, 0.012, (0, 0, 0.006), M["cup"], segs=18, smooth=False)
    z = 0.012
    p.cyl(0.042, 0.034, 0.075, (0, 0, z + 0.0375), M["cup"], segs=16)
    p.cyl(0.037, 0.037, 0.005, (0, 0, z + 0.072), M["coffee"], segs=16, smooth=False)
    p.limb((0.04, 0, z + 0.055), (0.065, 0, z + 0.03), 0.01, 0.01, M["cup"], segs=6)
    p.finish(root)


# ---------- 建物の部分・店・家の物 ----------

def lathe(p, profile, mats, segs=32, scale=(1.0, 1.0), angle0=0.0, smooth=True):
    """断面 [(r, z), ...] を Z 軸まわりに回した形（皿・フライパン・かご）。

    断面は外の底の中心から外へ、縁を回って内側を下り、内の底の中心まで順にたどる（r が 0 の点は 1 点にまとめる）。
    mats は 1 つのマテリアルか、断面の区間ごとのマテリアルの並び。scale は X・Y の倍率（segs=4 で四角くできる）。
    """
    if not isinstance(mats, (list, tuple)):
        mats = [mats] * (len(profile) - 1)
    sx, sy = scale
    for i in range(len(profile) - 1):
        tb = bmesh.new()
        rings = []
        for r, z in profile[i:i + 2]:
            if r == 0:
                rings.append([tb.verts.new((0, 0, z))] * segs)
            else:
                rings.append([tb.verts.new((r * math.cos(angle0 + k / segs * math.tau) * sx,
                                            r * math.sin(angle0 + k / segs * math.tau) * sy, z)) for k in range(segs)])
        a, b = rings
        for k in range(segs):
            k2 = (k + 1) % segs
            quad = [a[k], a[k2], b[k2], b[k]]   # この回り順で、表が形の外を向く
            verts = [v for j, v in enumerate(quad) if v not in quad[:j]]
            if len(verts) >= 3:
                tb.faces.new(verts)
        p._merge(tb, mats[i], smooth)


@part("door", "building", "扉（ドア）", [("door", "noun")])
def build_door(root):
    """枠つきの開き戸。扉は幅 0.8 m・高さ 2.0 m。原点は枠の底面の中心（ちょうつがいの側ではない）。

    取っ手は +X 側で、表（+Z）と裏の両方に付ける。表と裏は同じ形なので向きは確かめない。
    """
    w, h, t = 0.8, 2.0, 0.04
    frame_w, frame_d = 0.07, 0.12
    p = Part("door")
    p.box((w, t, h), (0, 0, h / 2), M["door"], bevel=0.006)
    for sy in (-1, 1):   # 扉の表と裏の、上下 2 枚の飾りの板
        for cz, ph in ((1.45, 0.75), (0.55, 0.7)):
            p.box((w - 0.24, 0.01, ph), (0, sy * (t / 2 + 0.004), cz), M["door_panel"], bevel=0.004)
    for sx in (-1, 1):
        p.box((frame_w, frame_d, h + frame_w), (sx * (w / 2 + frame_w / 2), 0, (h + frame_w) / 2), M["door_frame"], bevel=0.008)
    p.box((w + frame_w * 2, frame_d, frame_w), (0, 0, h + frame_w / 2), M["door_frame"], bevel=0.008)
    for sy in (-1, 1):   # レバーの取っ手
        y = sy * (t / 2 + 0.012)
        p.cyl(0.028, 0.028, 0.012, (w / 2 - 0.08, y, 0.95), M["metal"], rot=(math.pi / 2, 0, 0), segs=14, smooth=False)
        p.limb((w / 2 - 0.08, y + sy * 0.03, 0.95), (w / 2 - 0.2, y + sy * 0.03, 0.95), 0.012, 0.012, M["metal"], segs=8)
        p.limb((w / 2 - 0.08, y, 0.95), (w / 2 - 0.08, y + sy * 0.035, 0.95), 0.012, 0.012, M["metal"], segs=8)
    p.finish(root)


@part("wall", "building", "壁（長さ 4 m）", [("wall", "noun")])
def build_wall(root):
    """部屋の壁の板。長さ 4 m（X）・高さ 2.4 m・厚さ 0.1 m。下の 8 cm は幅木（色違い、厚さは同じ）。表と裏は同じ形。"""
    length, h, t, base = 4.0, 2.4, 0.1, 0.08
    p = Part("wall")
    p.box((length, t, base), (0, 0, base / 2), M["baseboard"])
    p.box((length, t, h - base), (0, 0, base + (h - base) / 2), M["wall"])
    p.finish(root)


@part("window", "building", "窓", [("window", "noun")], front=("window_sill", 1))
def build_window(root):
    """引き違いの窓。幅 1.2 m・高さ 1.0 m。壁（厚さ 0.1 m）に重ねて、高さを上げて置く。

    原点は枠の底面の中心。枠は厚さ 0.14 m で壁の両面に 2 cm ずつ出る。ガラスは壁に隠れないよう、
    壁の表と裏の外に 1 枚ずつ置く。窓台は表（+Z）の側だけにある。
    """
    w, h, d, fw = 1.2, 1.0, 0.14, 0.06
    p = Part("window")
    for sx in (-1, 1):
        p.box((fw, d, h), (sx * (w / 2 - fw / 2), 0, h / 2), M["window_frame"], bevel=0.006)
    for z in (fw / 2, h - fw / 2):
        p.box((w - fw * 2, d, fw), (0, 0, z), M["window_frame"], bevel=0.006)
    for sy in (-1, 1):
        y = sy * (d / 2 - 0.012)
        p.box((w - fw * 2, 0.004, h - fw * 2), (0, y, h / 2), M["window_glass"])
        p.box((0.04, 0.012, h - fw * 2), (0.02 * sy, y + sy * 0.004, h / 2), M["window_frame"])   # 2 枚の戸の合わせ目
    p.box((w + 0.08, 0.1, 0.04), (0, -(d / 2 + 0.05), 0.02), M["window_sill"], bevel=0.006)   # 窓台（表だけ）
    p.finish(root)


@part("checkout_counter", "furniture", "レジのカウンター", [("checkout counter", "noun"), ("cash register", "noun"), ("counter", "noun")],
      front=("counter_front", 1))
def build_checkout_counter(root):
    """店のレジのカウンター。幅 1.5 m・天板の高さ 0.9 m。客の側が正面（+Z）で、緑の帯がある。

    レジは天板の +X 側にあり、店員の側（-Z）に画面を向ける。客の側には小さな表示がある。
    """
    w, d, h = 1.5, 0.65, 0.9
    p = Part("checkout_counter")
    p.box((w - 0.1, d - 0.06, 0.08), (0, 0, 0.04), M["dark"], bevel=0.01)                        # 台座
    p.box((w - 0.06, d - 0.04, h - 0.12), (0, 0, 0.08 + (h - 0.12) / 2), M["counter"], bevel=0.01)   # 胴
    p.box((w, d, 0.04), (0, 0, h - 0.02), M["counter_top"], bevel=0.008)                         # 天板
    p.box((w - 0.06, 0.012, 0.14), (0, -(d - 0.04) / 2 - 0.004, 0.62), M["counter_front"])       # 客の側の帯
    # レジ（cafe.py の build_register の形）
    rx = w / 2 - 0.3
    p.box((0.38, 0.32, 0.1), (rx, 0.05, h + 0.05), M["register"], bevel=0.02)
    p.box((0.3, 0.04, 0.2), (rx, 0.12, h + 0.2), M["register"], rot=(0.3, 0, 0), bevel=0.01)
    p.box((0.26, 0.01, 0.15), (rx, 0.146, h + 0.198), M["screen"], rot=(0.3, 0, 0))              # 店員に向けた画面
    p.box((0.12, 0.03, 0.07), (rx, -0.1, h + 0.135), M["register"], bevel=0.01)                   # 客に向けた表示
    p.box((0.1, 0.006, 0.05), (rx, -0.117, h + 0.135), M["screen"])
    p.box((0.08, 0.01, 0.12), (rx + 0.12, -0.08, h + 0.13), M["receipt"])
    p.finish(root)
    # 天板の上面（レジの無いところに物を置く）と、レジの客の側の場所
    return {"top": h, "spots": {"register": (rx, -d / 2, h + 0.05)}}


@part("shelf", "furniture", "棚（商品棚・本棚）", [("shelf", "noun"), ("bookshelf", "noun")], front=("shelf_back", -1))
def build_shelf(root):
    """前の開いた木の棚。幅 1.2 m・高さ 1.8 m・奥行き 0.4 m。板は 5 枚（いちばん上は天板）で、背板は奥（-Z）。"""
    w, h, d, t = 1.2, 1.8, 0.4, 0.03
    p = Part("shelf")
    for sx in (-1, 1):
        p.box((t, d, h), (sx * (w / 2 - t / 2), 0, h / 2), M["shelf"], bevel=0.004)
    p.box((w - 2 * t, 0.015, h - 0.01), (0, d / 2 - 0.0075, h / 2), M["shelf_back"])
    p.box((w - 2 * t, 0.02, 0.08), (0, -d / 2 + 0.03, 0.04), M["shelf"])   # 下の幕板
    boards = [0.08 + t / 2 + k * (h - 0.08 - t) / 4 for k in range(5)]
    for z in boards:
        p.box((w - 2 * t if z < boards[-1] else w, d - 0.02, t), (0, 0.005, z), M["shelf"], bevel=0.003)
    p.finish(root)
    return {"top": boards[-1] + t / 2}   # いちばん上の板（天板）の上面


@part("basket", "thing", "手提げの買い物かご（床に置かず手に持つ）", [("basket", "noun"), ("shopping basket", "noun")])
def build_basket(root):
    """スーパーの赤い買い物かご。上の口は 0.48 m × 0.33 m、高さ 0.24 m。持ち手 2 本を立てた形。左右・前後とも対称。"""
    p = Part("basket")
    basket_shape(p)
    p.finish(root)


def basket_shape(p):
    """買い物かごの形。底の真ん中が原点で、持ち手のいちばん上は 0.36 m。"""
    hw, hd, h = 0.24, 0.165, 0.24
    r = math.sqrt(2)   # 4 角の lathe で、半径 √2 の点が (±1, ±1) に来る
    lathe(p, [(0, 0), (r * 0.86, 0), (r, h), (r * 0.955, h), (r * 0.82, 0.012), (0, 0.012)],
          [M["basket"], M["basket"], M["basket_rim"], M["basket"], M["basket"]], segs=4, scale=(hw, hd), angle0=math.pi / 4, smooth=False)
    # 口の縁の太い帯と、横の穴の列（濃い色の細長い板を外側に貼る）
    for sy in (-1, 1):
        p.box((hw * 2 + 0.008, 0.012, 0.03), (0, sy * (hd + 0.002), h - 0.015), M["basket_rim"], rot=(sy * 0.05, 0, 0))
    for sx in (-1, 1):
        p.box((0.012, hd * 2 + 0.008, 0.03), (sx * (hw + 0.002), 0, h - 0.015), M["basket_rim"], rot=(0, -sx * 0.05, 0))
    slant = (hd - hd * 0.86) / h
    for row, z in enumerate((0.07, 0.13, 0.19)):
        for k in range(7):
            x = (k - 3) * 0.06
            for sy in (-1, 1):
                p.box((0.035, 0.006, 0.03), (x, sy * (hd * 0.86 + slant * z + 0.004), z), M["basket_rim"], rot=(-sy * math.atan(slant), 0, 0))
    # 持ち手（黒）。長い辺の縁から立てて、上で少し内へ寄せる
    for sy in (-1, 1):
        pts = [Vector((-0.12, sy * hd, h)), Vector((-0.1, sy * hd * 0.7, h + 0.12)), Vector((0.1, sy * hd * 0.7, h + 0.12)), Vector((0.12, sy * hd, h))]
        for a, b in zip(pts, pts[1:]):
            p.limb(a, b, 0.009, 0.009, M["dark"], segs=8)


@part("plate", "thing", "皿", [("plate", "noun"), ("dish", "noun")])
def build_plate(root):
    """白い丸い皿。直径 0.24 m、縁に青い線。真ん中のくぼみの面に物を置く。"""
    p = Part("plate")
    well = 0.01
    lathe(p, [(0, 0), (0.07, 0), (0.075, 0.006), (0.112, 0.02), (0.12, 0.023), (0.117, 0.025),
              (0.108, 0.0225), (0.1, 0.0195), (0.075, well), (0, well)],
          [M["dish"], M["dish"], M["dish"], M["dish"], M["dish"], M["dish_rim"], M["dish"], M["dish"], M["dish"]], segs=40)
    p.finish(root)
    return {"top": well}   # くぼみの底の面


@part("shirt", "thing", "シャツ（たたんだ）", [("shirt", "noun")], front=("shirt_collar", 1))
def build_shirt(root):
    """たたんで平らに置いた水色のシャツ。0.26 m × 0.32 m、厚さ 4 cm。白いえりが正面（+Z）の側。"""
    w, d, t = 0.26, 0.32, 0.035
    p = Part("shirt")
    p.box((w, d, t), (0, 0, t / 2), M["shirt"], bevel=0.012)
    p.box((w - 0.04, d - 0.06, 0.004), (0, 0.02, t + 0.001), M["shirt"], bevel=0.002)   # 身ごろを折った段
    y0, z = -d / 2 + 0.07, t + 0.008
    arc = [Vector((0.07 * math.cos(k / 10 * math.pi), y0 + 0.055 * math.sin(k / 10 * math.pi), z)) for k in range(11)]
    for a, b in zip(arc, arc[1:]):   # えりの後ろの帯（白。奥へ丸く回る）
        p.limb(a, b, 0.015, 0.015, M["shirt_collar"], segs=8)
    for sx in (-1, 1):   # えりの先（前へとがった 2 枚）
        root_pt = Vector((sx * 0.078, y0 + 0.01, z))
        p.poly([root_pt, Vector((sx * 0.01, y0 - 0.058, z)), Vector((sx * 0.06, y0 - 0.042, z))][::sx], M["shirt_collar"])
    for k in range(4):   # ボタン
        p.cyl(0.006, 0.006, 0.003, (0, y0 - 0.02 + k * 0.06, t + 0.004), M["button"], segs=10, smooth=False)
    p.finish(root)


@part("seat", "furniture", "座席（バス・電車、2 人がけ）", [("seat", "noun")], front=("seat_back", -1))
def build_seat(root):
    """バスや電車の 2 人がけの座席。幅 0.9 m、座面 0.46 m、背もたれは奥（-Z）で高さ 1.05 m。上に握り棒。"""
    w = 0.9
    p = Part("seat")
    cushion_t, cushion_y, cushion_d = 0.07, -0.02, 0.44
    for sx in (-1, 1):
        p.box((0.06, 0.4, 0.04), (sx * 0.34, 0, 0.02), M["metal"], bevel=0.01)                       # 足の板
        p.box((0.05, 0.05, 0.34), (sx * 0.34, 0.02, 0.19), M["metal"], bevel=0.01)                   # 足
        p.box((0.42, cushion_d, cushion_t), (sx * 0.215, cushion_y, SEAT_Z - cushion_t / 2), M["seat_fabric"], bevel=0.025)
        p.box((0.42, 0.08, 0.5), (sx * 0.215, 0.24, SEAT_Z + 0.3), M["seat_fabric"], rot=(-0.12, 0, 0), bevel=0.03)   # 背のクッション
    p.box((w, 0.48, 0.05), (0, 0, SEAT_Z - cushion_t - 0.025), M["metal"], bevel=0.01)                 # 座面の台
    p.box((w, 0.06, 0.6), (0, 0.3, SEAT_Z + 0.29), M["seat_back"], rot=(-0.12, 0, 0), bevel=0.02)      # 背もたれ
    top = Vector((0, 0.3 + math.sin(0.12) * 0.3, SEAT_Z + 0.29 + math.cos(0.12) * 0.3))
    for sx in (-1, 1):
        p.limb(top + Vector((sx * 0.4, 0, -0.02)), top + Vector((sx * 0.4, -0.02, 0.08)), 0.012, 0.012, M["metal"], segs=8)
    p.limb(top + Vector((-0.4, -0.02, 0.08)), top + Vector((0.4, -0.02, 0.08)), 0.014, 0.014, M["metal"], segs=10)   # 握り棒
    p.finish(root)
    return {"seat": (0, cushion_y, SEAT_Z)}   # 2 つの座面のクッションの真ん中の上面


@part("laptop", "thing", "ノートパソコン（開いた）", [("laptop", "noun"), ("computer", "noun")], front=("trackpad", 1))
def build_laptop(root):
    """開いたノートパソコン。幅 0.32 m・奥行き 0.22 m。画面は使う人（+Z）に向けて少し後ろへ倒す。"""
    w, d, t = 0.32, 0.22, 0.016
    p = Part("laptop")
    p.box((w, d, t), (0, 0, t / 2), M["laptop"], bevel=0.004)
    p.box((w - 0.04, 0.1, 0.002), (0, 0.02, t + 0.001), M["dark"])                  # キーボード
    p.box((0.1, 0.06, 0.002), (0, -0.07, t + 0.001), M["trackpad"])
    tilt = Euler((-0.26, 0, 0))   # 画面を後ろ（-Z）へ 15 度ほど倒す
    hinge = Vector((0, d / 2 - 0.005, t))
    up = tilt.to_matrix() @ Vector((0, 0, 1))
    front = tilt.to_matrix() @ Vector((0, -1, 0))
    p.box((w, 0.008, 0.21), hinge + up * 0.105, M["laptop"], rot=tilt, bevel=0.003)
    p.box((w - 0.03, 0.002, 0.18), hinge + up * 0.11 + front * 0.005, M["laptop_screen"], rot=tilt)
    p.finish(root)


@part("clock", "thing", "時計（壁掛け）", [("clock", "noun")])
def build_clock(root):
    """丸い壁掛け時計（classroom.py の build_clock を半分にしたもの）。直径 0.34 m・厚さ 5 cm。

    文字盤は正面（+Z）。原点は底面の中心なので、壁に掛けるときは高さを上げる。薄いので向きは確かめない。
    """
    r = 0.17
    p = Part("clock")
    z = r
    p.cyl(r, r, 0.05, (0, 0, z), M["dark"], rot=(math.pi / 2, 0, 0), segs=32, smooth=False)
    p.cyl(0.15, 0.15, 0.052, (0, -0.001, z), M["clock_face"], rot=(math.pi / 2, 0, 0), segs=32, smooth=False)
    y = -0.03
    p.box((0.015, 0.01, 0.1), (0, y, z + 0.04), M["dark"])                               # 長針
    p.box((0.015, 0.01, 0.07), (0.025, y, z - 0.015), M["dark"], rot=(0, -2.1, 0))     # 短針
    p.cyl(0.01, 0.01, 0.012, (0, y, z), M["dark"], rot=(math.pi / 2, 0, 0), segs=10, smooth=False)
    for k in range(12):
        a = k / 12 * math.tau
        p.box((0.01, 0.006, 0.022 if k % 3 == 0 else 0.014), (math.sin(a) * 0.125, y + 0.002, z + math.cos(a) * 0.125), M["dark"], rot=(0, -a, 0))
    p.finish(root)


@part("cart", "thing", "車輪つきのショッピングカート（押して使う）", [("cart", "noun"), ("shopping cart", "noun")], front=("cart_handle", -1))
def build_cart(root):
    """スーパーのショッピングカート。長さ 0.9 m・幅 0.55 m・高さ 1.0 m。押す人の側の取っ手（赤）が奥（-Z）。"""
    p = Part("cart")
    top_z, bot_z = 0.95, 0.55
    top = [Vector(v) for v in ((-0.27, -0.45, top_z), (0.27, -0.45, top_z), (0.27, 0.35, top_z), (-0.27, 0.35, top_z))]
    bot = [Vector(v) for v in ((-0.22, -0.3, bot_z), (0.22, -0.3, bot_z), (0.22, 0.3, bot_z), (-0.22, 0.3, bot_z))]

    def wire(a, b, r=0.005):
        p.limb(a, b, r, r, M["metal"], segs=6)

    for k in range(4):   # かごの枠
        wire(top[k], top[(k + 1) % 4], 0.009)
        wire(bot[k], bot[(k + 1) % 4], 0.008)
        wire(top[k], bot[k], 0.008)
    for f in (0.25, 0.5, 0.75):   # 横の針金（高さごとに一周）
        ring = [b.lerp(t, f) for t, b in zip(top, bot)]
        for k in range(4):
            wire(ring[k], ring[(k + 1) % 4])
    for k in range(4):   # 縦の針金
        n = 9 if k % 2 else 6
        for j in range(1, n):
            f = j / n
            wire(top[k].lerp(top[(k + 1) % 4], f), bot[k].lerp(bot[(k + 1) % 4], f))
    for j in range(1, 6):   # 底の針金
        f = j / 6
        wire(bot[0].lerp(bot[3], f), bot[1].lerp(bot[2], f))
    # 下の台と足、車輪
    base = [Vector(v) for v in ((-0.2, -0.38, 0.12), (0.2, -0.38, 0.12), (0.22, 0.33, 0.12), (-0.22, 0.33, 0.12))]
    for k in range(4):
        wire(base[k], base[(k + 1) % 4], 0.012)
    for j in range(1, 5):
        wire(base[0].lerp(base[1], j / 5), base[3].lerp(base[2], j / 5), 0.005)
    for k in (2, 3):   # 後ろの足は取っ手まで
        wire(base[k], top[k] + Vector((0, 0.05, 0.05)), 0.012)
    for k in (0, 1):
        wire(base[k], bot[k].lerp(bot[3 - k], 0.15), 0.012)
    for b in base:
        p.cyl(0.05, 0.05, 0.03, (b.x, b.y, 0.05), M["tire"], rot=(0, math.pi / 2, 0), segs=16, smooth=False)
        wire(Vector((b.x, b.y, 0.05)), b, 0.01)
    p.limb((-0.29, 0.42, 1.0), (0.29, 0.42, 1.0), 0.02, 0.02, M["cart_handle"], segs=12)   # 取っ手
    for sx in (-1, 1):
        wire(Vector((sx * 0.27, 0.4, 1.0)), Vector((sx * 0.27, 0.35, top_z)), 0.01)
    p.finish(root)


@part("pan", "thing", "フライパン", [("pan", "noun"), ("frying pan", "noun")])
def build_pan(root):
    """黒いフライパン。直径 0.26 m・深さ 4.5 cm。持ち手は +X（cup と同じ向き）。"""
    p = Part("pan")
    h = 0.045
    lathe(p, [(0, 0), (0.11, 0), (0.13, h), (0.125, h + 0.002), (0.106, 0.006), (0, 0.006)],
          [M["pan"], M["pan"], M["pan"], M["pan_inside"], M["pan_inside"]], segs=36)
    p.limb((0.115, 0, 0.032), (0.2, 0, 0.05), 0.012, 0.01, M["metal"], segs=10)
    p.limb((0.19, 0, 0.048), (0.34, 0, 0.068), 0.016, 0.014, M["pan_handle"], segs=12)
    p.finish(root)


@part("spilled_juice", "thing", "こぼれたジュース", [("juice", "noun"), ("spill", "verb")])
def build_spilled_juice(root):
    """倒れたコップと、広がったオレンジのジュース。机の上に置く。幅 0.5 m。"""
    p = Part("spilled_juice")
    p.sphere(0.2, (0.03, 0, 0.004), M["juice"], scale=(1.25, 0.9, 0.03))
    p.cyl(0.04, 0.034, 0.11, (-0.14, 0, 0.042), M["cup"], rot=(0, math.pi / 2, 0), segs=16)
    p.finish(root)


@part("rain", "thing", "雨", [("rain", "noun"), ("rain", "verb")])
def build_rain(root):
    """外の場面に重ねる雨。8 m 四方・高さ 3.5 m の空間に落ちる筋と、地面の水たまり。原点に置くだけでよい。"""
    rng = random.Random(11)
    p = Part("rain")
    for _ in range(170):
        x, y, z = rng.uniform(-3.9, 3.9), rng.uniform(-3.9, 3.9), rng.uniform(0.3, 3.3)
        p.cyl(0.006, 0.006, rng.uniform(0.28, 0.45), (x, y, z), M["rain"], rot=(0, 0.12, 0), segs=4, smooth=False)
    for _ in range(7):
        x, y, r = rng.uniform(-3.5, 3.5), rng.uniform(-3.5, 3.5), rng.uniform(0.15, 0.32)
        p.sphere(r, (x, y, 0.006), M["puddle"], scale=(1.3, 0.9, 0.012 / r), segs=20)
    p.finish(root)


@part("bookshelf", "furniture", "本の詰まった本棚", [("bookshelf", "noun"), ("book", "noun"), ("shelf", "noun")], front=("shelf_back", -1))
def build_bookshelf(root):
    """本の詰まった背の高い本棚。幅 1.4 m・高さ 2.3 m・奥行き 0.36 m。背板は奥（-Z）。

    いちばん上の段は高さ 1.86〜2.27 m で、子どもの手は届かず大人の手は届く。その段の真ん中の赤い本だけ前に出ている。
    """
    w, h, d, t = 1.4, 2.3, 0.36, 0.03
    p = Part("bookshelf")
    for sx in (-1, 1):
        p.box((t, d, h), (sx * (w / 2 - t / 2), 0, h / 2), M["shelf"], bevel=0.004)
    p.box((w - 2 * t, 0.015, h - 0.01), (0, d / 2 - 0.0075, h / 2), M["shelf_back"])
    p.box((w - 2 * t, 0.02, 0.08), (0, -d / 2 + 0.03, 0.04), M["shelf"])   # 下の幕板
    rows = 5
    step = (h - 0.08 - t) / rows
    boards = [0.08 + t / 2 + k * step for k in range(rows + 1)]
    for z in boards:
        p.box((w - 2 * t, d - 0.02, t), (0, 0.005, z), M["shelf"], bevel=0.003)
    rng = random.Random(7)
    colors = ["book_blue", "book_green", "book_yellow", "book_purple", "book_brown"]   # 落ち着いた色にして、取りたい赤い本を目立たせる
    depth = 0.24
    for row, z in enumerate(boards[:-1]):
        x = -w / 2 + t + 0.01
        while x < w / 2 - t - 0.08:
            thick, tall = rng.uniform(0.04, 0.075), rng.uniform(0.26, 0.36)
            top_center = row == rows - 1 and abs(x + thick / 2) < 0.09   # 飛び出した本の場所は空けておく
            if not top_center:
                p.box((thick, depth, tall), (x + thick / 2, -d / 2 + 0.04 + depth / 2, z + t / 2 + tall / 2), M[rng.choice(colors)])
            x += thick + 0.002
    book_front = -d / 2 - 0.08
    p.box((0.1, depth, 0.34), (0, book_front + depth / 2, boards[-2] + t / 2 + 0.17), M["book_red"])   # 取りたい本
    p.finish(root)
    return {"spots": {"top_book": (0, book_front, boards[-2] + t / 2 + 0.17)}}


@part("bed", "furniture", "ベッド（1 人用）", [("bed", "noun")])
def build_bed(root):
    """1 人用のベッド。長さ 2.0 m を左右（X）に置き、頭の側の板（高さ 0.9 m）は -X。長い辺が正面（+Z）。

    掛け布団の上面 0.49 m に物を置き、正面の側の縁に座る。前後は同じ形なので向きは確かめない。
    """
    length, width = 2.0, 1.0
    p = Part("bed")
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.06, 0.06, 0.12), (sx * (length / 2 - 0.08), sy * (width / 2 - 0.06), 0.06), M["bed_frame"])
    p.box((length - 0.1, width, 0.22), (0, 0, 0.23), M["bed_frame"], bevel=0.015)                # 台
    p.box((length - 0.12, width - 0.04, 0.12), (0, 0, 0.4), M["mattress"], bevel=0.03)            # マットレス（上面 0.46）
    p.box((0.05, width + 0.02, 0.9), (-length / 2 + 0.025, 0, 0.45), M["bed_frame"], bevel=0.012)  # 頭の側の板
    p.box((0.05, width + 0.02, 0.55), (length / 2 - 0.025, 0, 0.275), M["bed_frame"], bevel=0.012) # 足の側の板
    p.sphere(0.2, (-length / 2 + 0.3, 0, 0.5), M["pillow"], scale=(1.0, 1.8, 0.4))
    blanket_top = 0.49
    p.box((1.35, width + 0.03, 0.05), (length / 2 - 0.08 - 0.675, 0, blanket_top - 0.025), M["blanket"], bevel=0.02)
    p.box((1.35, 0.015, 0.2), (length / 2 - 0.08 - 0.675, -(width / 2 + 0.015), blanket_top - 0.1), M["blanket"], bevel=0.007)  # 前に垂れた布団
    p.finish(root)
    return {"top": blanket_top, "seat": (0.2, -(width / 2) + 0.2, blanket_top)}   # 布団の上面、正面の縁から 0.2 m の点


# ---------- M1〜M10 で足した物 ----------

@part("cake", "food", "丸いケーキ", [("cake", "noun")])
def build_cake(root):
    """台の皿にのった丸いケーキ。ろうそくは candles を上に置いて足す。"""
    p = Part("cake")
    p.cyl(0.2, 0.2, 0.012, (0, 0, 0.006), M["dish"], segs=24, smooth=False)
    p.cyl(0.16, 0.16, 0.1, (0, 0, 0.062), M["cake"], segs=24)
    for k in range(6):
        a = k / 6 * math.tau
        p.sphere(0.022, (0.12 * math.cos(a), 0.12 * math.sin(a), 0.122), M["apple"], segs=10)
    p.finish(root)
    return {"top": 0.112}


@part("candles", "thing", "火のついたろうそく（ケーキの上に置く）", [("candle", "noun")])
def build_candles(root):
    p = Part("candles")
    for k in range(5):
        a = k / 5 * math.tau
        x, y = 0.06 * math.cos(a), 0.06 * math.sin(a)
        p.cyl(0.008, 0.008, 0.08, (x, y, 0.04), M["candle"], segs=8)
        p.sphere(0.012, (x, y, 0.094), M["flame"], scale=(1, 1, 1.6), segs=8)
    p.finish(root)


@part("ticket_machine", "furniture", "切符の券売機", [("ticket machine", "noun"), ("machine", "noun")], front=("ticket_screen", 1))
def build_ticket_machine(root):
    """駅の券売機。正面の画面に手を伸ばして買う。"""
    p = Part("ticket_machine")
    p.box((0.9, 0.5, 1.7), (0, 0, 0.85), M["ticket_body"], bevel=0.03)
    p.box((0.56, 0.02, 0.4), (0, -0.26, 1.2), M["ticket_screen"], bevel=0.008)
    p.box((0.3, 0.02, 0.06), (0, -0.26, 0.86), M["dark"])
    p.finish(root)
    return {"spots": {"screen": (0, -0.26, 1.2)}}


@part("sand_castle", "thing", "砂の城", [("sand castle", "noun"), ("castle", "noun")])
def build_sand_castle(root):
    p = Part("sand_castle")
    p.cyl(0.42, 0.34, 0.2, (0, 0, 0.1), M["castle"], segs=16)
    p.cyl(0.24, 0.2, 0.2, (0, 0, 0.3), M["castle"], segs=14)
    for k in range(4):
        a = k / 4 * math.tau + 0.78
        p.cyl(0.08, 0.06, 0.16, (0.28 * math.cos(a), 0.28 * math.sin(a), 0.28), M["castle"], segs=10)
    p.finish(root)


@part("balloon", "thing", "風船", [("balloon", "noun")])
def build_balloon(root):
    p = Part("balloon")
    p.sphere(0.22, (0, 0, 0.75), M["balloon"], scale=(1, 1, 1.15))
    p.limb((0, 0, 0.5), (0.03, 0.02, 0.0), 0.004, 0.004, M["dark"], segs=6)
    p.finish(root)


@part("bicycle_down", "vehicle", "倒れた自転車", [("bicycle", "noun"), ("bike", "noun")])
def build_bicycle_down(root):
    """自転車を横に倒したもの。形は bicycle と同じ。"""
    PARTS["bicycle"]["build"](root)
    for child in root.children:
        child.rotation_euler = (0, math.pi / 2, 0)
        child.location = (0, 0, 0.32)


# ---------- 破片 ----------
#
# 物が割れたことは、割れた物を 1 つずつ作らず、材質ごとの破片を置いて表す。材質を足すときは下の表に 1 行足す。

def shards(p, mat, seed, count=18, radius=0.45):
    """床に散らばった破片。三角の薄い板を、真ん中ほど大きく多く散らす。"""
    rng = random.Random(seed)
    for k in range(count):
        d = radius * rng.random() ** 0.7
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0.05, 0.11) * (1.25 - d / radius * 0.75)
        tilt = (rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), rng.uniform(0, math.tau))
        p.cyl(r, r * 0.9, 0.012, (d * math.cos(a), d * math.sin(a), 0.02), M[mat], rot=tilt, segs=3, smooth=False)


for _pid, _label, _word, _mat, _seed in (("shards_glass", "ガラスの破片", "glass", "shard_glass", 11),
                                         ("shards_metal", "金属の破片", "metal", "shard_metal", 12)):
    def _build(root, mat=_mat, seed=_seed, pid=_pid):
        p = Part(pid)
        shards(p, mat, seed)
        p.finish(root)
    part(_pid, "thing", f"{_label}（床に散らばる）", [(_word, "noun"), ("pieces", "noun")])(_build)


# ---------- 動物 ----------

@part("animal_run_dog_a", "animal", "走る犬", [("dog", "noun"), ("run", "verb")], pose="run", front=("dog_dark", 1))
def build_dog(root):
    """走る犬（park.py の build_dog）。頭が正面（+Z）。"""
    p = Part("dog")
    p.sphere(0.2, (0, 0.02, 0.4), M["dog"], scale=(1, 1.75, 0.95))                 # 胴
    p.sphere(0.15, (0, -0.24, 0.38), M["dog_white"], scale=(1, 0.8, 1.05))        # 胸
    p.sphere(0.17, (0, -0.42, 0.62), M["dog"])                                    # 頭
    p.sphere(0.09, (0, -0.56, 0.57), M["dog_white"], scale=(1, 1.15, 0.8))        # 鼻先
    p.sphere(0.03, (0, -0.665, 0.6), M["dog_dark"], segs=10)                      # 鼻
    for sx in (-1, 1):
        p.sphere(0.024, (sx * 0.075, -0.55, 0.67), M["dog_dark"], segs=10)        # 目
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
    p.finish(root)


@part("animal_sit_dog_a", "animal", "座って見ている犬", [("dog", "noun"), ("sit", "verb"), ("watch", "verb")], pose="rest", front=("dog_dark", 1))
def build_dog_sit(root):
    """おすわりの犬。頭が正面（+Z）。"""
    p = Part("dog")
    p.sphere(0.19, (0, 0.14, 0.2), M["dog"], scale=(1, 1.15, 1))                  # 腰
    p.sphere(0.17, (0, -0.02, 0.4), M["dog"], scale=(1, 1, 1.35))                  # 胴
    p.sphere(0.13, (0, -0.13, 0.42), M["dog_white"], scale=(1, 0.7, 1.2))          # 胸
    p.sphere(0.17, (0, -0.1, 0.72), M["dog"])                                      # 頭
    p.sphere(0.09, (0, -0.24, 0.67), M["dog_white"], scale=(1, 1.15, 0.8))         # 鼻先
    p.sphere(0.03, (0, -0.345, 0.7), M["dog_dark"], segs=10)                       # 鼻
    for sx in (-1, 1):
        p.sphere(0.024, (sx * 0.075, -0.23, 0.77), M["dog_dark"], segs=10)         # 目
        p.cyl(0.065, 0.0, 0.13, (sx * 0.09, -0.08, 0.89), M["dog"], rot=(-0.15, sx * 0.3, 0), segs=4, smooth=False)  # 耳
        p.cyl(0.045, 0.04, 0.3, (sx * 0.08, -0.12, 0.15), M["dog"], segs=10)       # 前脚
        p.sphere(0.05, (sx * 0.08, -0.15, 0.04), M["dog_white"], segs=10)
        p.sphere(0.1, (sx * 0.14, 0.16, 0.1), M["dog"], scale=(0.7, 1.25, 1))      # 後ろ脚
        p.sphere(0.05, (sx * 0.13, 0.0, 0.04), M["dog_white"], segs=10)
    for k in range(5):                                                             # しっぽ
        p.sphere(0.05 - k * 0.005, (0, 0.33 + k * 0.05, 0.08 + k * 0.03), M["dog"] if k < 4 else M["dog_white"], segs=10)
    p.finish(root)


@part("animal_bird_a", "animal", "地面をつつく小鳥", [("bird", "noun"), ("eat", "verb")], pose="peck", front=("bird_beak", 1))
def build_bird(root):
    """小鳥。頭が正面（+Z）。"""
    p = Part("bird")
    p.sphere(0.1, (0, 0.02, 0.14), M["bird"], scale=(0.85, 1.25, 0.85))
    p.sphere(0.07, (0, -0.02, 0.1), M["bird_belly"], scale=(0.85, 1.1, 0.7))
    p.sphere(0.06, (0, -0.12, 0.12), M["bird"])
    p.cyl(0.018, 0.0, 0.05, (0, -0.19, 0.1), M["bird_beak"], rot=(math.pi / 2 + 0.4, 0, 0), segs=8)
    p.box((0.06, 0.16, 0.02), (0, 0.17, 0.17), M["bird"], rot=(0.3, 0, 0))
    for sx in (-1, 1):
        p.sphere(0.01, (sx * 0.04, -0.15, 0.135), M["dark"], segs=8)
        p.limb((sx * 0.03, 0.02, 0.08), (sx * 0.03, 0.02, 0.0), 0.006, 0.006, M["bird_beak"], segs=6)
    p.finish(root)


# ---------- 人物 ----------
#
# 人物は「ポーズの表（POSES）」と「見た目の表（LOOKS）」の組み合わせ（PEOPLE）から作る。
# id は person_<ポーズ>_<見た目>。どのポーズもどの見た目と組み合わせられ、PEOPLE に足せば部品が増える。

# 見た目の表。adult_a は男の人（今ある部品の id に合わせて man_a とは呼ばない）。服と髪の色は outfits()
LOOKS = {
    "adult_a": {"noun": "man", "label": "男の人", "scale": 1.0},
    "old_a": {"noun": "old man", "label": "おじいさん", "scale": 0.95},
    "woman_a": {"noun": "woman", "label": "女の人", "scale": 1.0},
    "waiter_a": {"noun": "waiter", "label": "店員", "scale": 1.0, "wear": lambda p, hip, sh: wear_waiter(p, hip, sh)},
    "mother_a": {"noun": "woman", "label": "お母さん", "scale": 1.0, "wear": lambda p, hip, sh: wear_mother(p, hip, sh)},
    "old_woman_a": {"noun": "old woman", "label": "おばあさん", "scale": 0.92},
    "clerk_a": {"noun": "clerk", "label": "店の店員", "scale": 1.0,
                "wear": lambda p, hip, sh: wear_mother(p, hip, sh, "apron_green", "apron_green_pocket")},
    "doctor_a": {"noun": "doctor", "label": "医者", "scale": 1.0, "wear": lambda p, hip, sh: shell(p, 0.27, 0.205, 0.42, hip + 0.02, math.pi, M["white"])},
    "teen_a": {"noun": "boy", "label": "背の高い男の子", "scale": 1.0},
    "boy_a": {"noun": "boy", "label": "男の子", "scale": CHILD_SCALE},
    "girl_a": {"noun": "girl", "label": "女の子", "scale": CHILD_SCALE},
}


def shell(p, r0, r1, z0, z1, half, mat, top=None, steps=28):
    """体に沿う布。正面（-Y）から左右に half ラジアンの筒の面を張る。top は角度から上の端の高さを返す（V 字の襟）。"""
    def ring(z_of, k):
        a = -half + 2 * half * k / steps
        z = z_of(a)
        r = r0 + (r1 - r0) * (z - z0) / (z1 - z0)
        return Vector((r * math.sin(a), -r * math.cos(a), z))
    upper = top or (lambda a: z1)
    for k in range(steps):
        p.poly((ring(lambda a: z0, k), ring(lambda a: z0, k + 1), ring(upper, k + 1), ring(upper, k)), mat)


def wear_waiter(p, hip_z, sh_z):
    """店員の制服。V 字に開いた黒いベスト、金のボタン、黒い蝶ネクタイ、すねまでの長い白のエプロン。"""
    shell(p, 0.178, 0.204, hip_z - 0.02, sh_z - 0.01, math.pi, M["vest_black"],
          top=lambda a: sh_z - 0.01 - 0.27 * max(0.0, 1 - abs(a) / 0.6))
    for k in range(3):
        p.sphere(0.014, (0, -0.186, sh_z - 0.33 - k * 0.07), M["button_gold"], segs=8)
    for sx in (-1, 1):
        p.sphere(0.04, (sx * 0.045, -0.15, sh_z + 0.015), M["vest_black"], scale=(1.2, 0.4, 0.8), segs=10)
    p.sphere(0.018, (0, -0.164, sh_z + 0.015), M["vest_black"], segs=8)
    shell(p, 0.27, 0.205, 0.28, hip_z + 0.02, 2.4, M["white"])
    p.cyl(0.196, 0.196, 0.045, (0, 0, hip_z + 0.02), M["white"], segs=20)


def wear_mother(p, hip_z, sh_z, apron="apron", pocket="apron_pocket"):
    """お母さんのエプロン。胸当てと腰から下の布、肩ひも、腰のひもと後ろのちょう結び。"""
    shell(p, 0.246, 0.186, 0.6, hip_z + 0.05, 2.4, M[apron])
    shell(p, 0.186, 0.204, hip_z + 0.05, sh_z - 0.1, 1.25, M[apron])
    p.cyl(0.19, 0.19, 0.035, (0, 0, hip_z + 0.06), M[apron], segs=20)
    for sx in (-1, 1):
        p.limb((sx * 0.13, -0.15, sh_z - 0.1), (sx * 0.1, -0.09, sh_z + 0.07), 0.014, 0.014, M[apron], segs=6)
        p.sphere(0.05, (sx * 0.06, 0.2, hip_z + 0.06), M[apron], scale=(1.2, 0.5, 0.7), segs=10)
    p.box((0.2, 0.012, 0.12), (0, -0.232, 0.72), M[pocket], rot=(0.24, 0, 0), bevel=0.004)


def props_read(p):
    book_open(p, (0, -0.36, SH_STAND - 0.15))


def props_eat(p):
    apple_shape(p, (0.03, -0.24, SH_STAND + 0.15), r=0.045)


CARRY_BOX, CARRY_HAND_Z = (0.42, 0.32, 0.3), -0.42   # 運ぶ箱の大きさと、肩からの手の高さ（箱の横の真ん中をつかむ）


def props_carry(p):
    w, d, h = CARRY_BOX
    box_shape(p, (w, d, h), (0, -0.4, SH_STAND + CARRY_HAND_Z - h / 2))


SH_SIT = _heights("sit")[1]   # 座るポーズの肩の高さ


def props_drink(p):
    """口に当てた青いマグカップ（顔の前で見分けられるよう、白い cup とは色を変える）。底を上げて傾け、口の側を顔（+Y）へ向ける。"""
    tilt = Euler((-1.0, 0, 0))
    axis = tilt.to_matrix() @ Vector((0, 0, 1))
    rim = Vector((0, -0.175, SH_STAND + 0.15))   # 口の少し前
    c = rim - axis * 0.045
    p.cyl(0.035, 0.032, 0.09, c, M["mug"], rot=tilt, segs=16)
    p.cyl(0.03, 0.03, 0.002, rim + axis * 0.0005, M["coffee"], rot=tilt, segs=16, smooth=False)
    p.limb(c + Vector((0.033, 0, 0)) + axis * 0.02, c + Vector((0.06, 0, 0)), 0.008, 0.008, M["mug"], segs=6)   # 持ち手（+X）


def props_write(p):
    """右手（+X 側）に持ったペン。先を机の高さ（0.72 m）に下ろす。"""
    p.limb((0.115, -0.43, 0.72), (0.085, -0.37, 0.84), 0.006, 0.006, M["pen"], segs=8)


SH_RUN = _heights("run")[1]   # 走るポーズの肩の高さ


def props_read_sit(p):
    book_open(p, (0, -0.36, SH_SIT - 0.15))


def props_umbrella(p):
    """前へ伸ばした左手（-X 側）の傘。向かいの人に掛かるよう先を前へ傾ける。"""
    umbrella(p, hand=(-0.12, -0.36, SH_STAND + 0.42), top=(-0.04, -0.62, SH_STAND + 1.4), radius=0.9, drop=0.2)


def props_run_bag(p):
    """右手（+X 側）に提げた大きなかばん。"""
    p.box((0.2, 0.5, 0.34), (0.3, 0.05, SH_RUN - 0.62), M["bag"], bevel=0.03)
    p.limb((0.26, 0.05, SH_RUN - 0.45), (0.26, 0.05, SH_RUN - 0.4), 0.012, 0.012, M["bag_strap"], segs=6)


def props_wipe(p):
    """右手の下の白いふきん。机の面（高さ 0.72 m）に接する。"""
    p.box((0.2, 0.16, 0.02), (0.1, -0.56, 0.73), M["cloth"], bevel=0.005)


def props_serve(p):
    """右手に載せたお盆と新しいコップ。"""
    p.cyl(0.17, 0.17, 0.015, (0.2, -0.42, SH_STAND - 0.17), M["tray"], segs=24)
    p.cyl(0.04, 0.034, 0.11, (0.2, -0.42, SH_STAND - 0.1), M["cup"], segs=16)


def props_run_phone(p):
    """高く上げた右手のスマホ。横（+X）から画面が見えるよう、面を体の横へ向ける。読めるように大きめに作る。"""
    x, y, z = 0.2, -0.5, SH_RUN + 0.34
    p.box((0.024, 0.13, 0.24), (x, y, z), M["dark"], bevel=0.008)
    p.box((0.004, 0.105, 0.2), (x + 0.014, y, z), M["screen"])


def props_basket(p):
    """右手に提げた、品物の入った赤い買い物かご。長い辺を体の前後に向ける。"""
    basket_shape(p)
    apple_shape(p, (-0.11, 0.03, 0.2), r=0.065)
    apple_shape(p, (0.0, -0.05, 0.2), r=0.065)
    p.cyl(0.04, 0.04, 0.26, (0.13, 0.02, 0.22), M["leaf"], rot=(0, 0.25, 0), segs=12)
    return {"loc": (0.38, -0.02, SH_STAND - 0.52 - 0.36), "rot_z": math.pi / 2}


def props_pay(p):
    """右手で差し出すお札と、左手の財布。"""
    p.box((0.2, 0.1, 0.006), (0.1, -0.68, SH_STAND - 0.27), M["bill"])
    p.box((0.13, 0.04, 0.1), (-0.14, -0.34, SH_STAND - 0.3), M["shoe_brown"], bevel=0.008)


def props_plates(p):
    """両手で持つ重ねた皿 3 枚（子どもの倍率で机の上の皿と同じ大きさになる）。"""
    for k in range(3):
        z = SH_STAND - 0.25 + k * 0.024
        p.cyl(0.11, 0.16, 0.02, (0, -0.5, z), M["dish"], segs=24)
    p.cyl(0.16, 0.16, 0.003, (0, -0.5, z + 0.011), M["dish_rim"], segs=24)
    p.cyl(0.14, 0.14, 0.003, (0, -0.5, z + 0.013), M["dish"], segs=24)


def props_write_board(p):
    """右手のチョーク。"""
    p.limb((0.16, -0.5, SH_STAND + 0.32), (0.16, -0.58, SH_STAND + 0.34), 0.012, 0.012, M["white"], segs=8)


def props_carry_veg(p):
    """野菜の入った箱。運ぶ箱（props_carry）の上に、りんごと葉物をのぞかせる。"""
    w, d, h = CARRY_BOX
    z = SH_STAND + CARRY_HAND_Z - h / 2
    box_shape(p, (w, d, h), (0, -0.4, z))
    top = z + h   # box_shape の loc は底面
    for x, y in ((-0.12, -0.46), (0.02, -0.34), (0.13, -0.47)):
        apple_shape(p, (x, y, top), r=0.06)
    for x, y in ((-0.1, -0.32), (0.12, -0.32)):
        p.sphere(0.075, (x, y, top + 0.04), M["leaf"], scale=(1, 1, 1.3), segs=10)


def props_take_order(p):
    """左手のメモ帳と右手のペン。"""
    p.box((0.13, 0.17, 0.012), (-0.08, -0.36, SH_STAND - 0.1), M["notepad"], rot=(0.5, 0, 0), bevel=0.003)
    p.limb((0.08, -0.36, SH_STAND - 0.08), (0.0, -0.38, SH_STAND - 0.06), 0.006, 0.006, M["pen"], segs=8)


def props_run_umbrella(p):
    """右手で前へ差し出す、閉じた傘。"""
    grip = Vector((0.2, -0.5, SH_RUN - 0.05))
    tip = grip + Vector((0.0, -0.32, 0.62))
    tail = grip - (tip - grip).normalized() * 0.12
    p.limb(tail, grip + (tip - grip) * 0.2, 0.012, 0.012, M["dark"], segs=6)
    p.limb(grip + (tip - grip) * 0.2, tip, 0.05, 0.012, M["umbrella"], segs=10)
    p.limb(tip, tip + (tip - grip).normalized() * 0.08, 0.008, 0.008, M["dark"], segs=6)


def props_sweep(p):
    """両手で持つほうき。穂先は床に付く。"""
    top, foot = Vector((-0.1, -0.2, SH_STAND + 0.05)), Vector((0.22, -0.72, 0.16))
    p.limb(top, foot, 0.014, 0.014, M["pan_handle"], segs=8)
    p.cyl(0.05, 0.13, 0.18, (foot.x, foot.y, 0.09), M["broom_straw"], segs=10)


def props_cut(p):
    """右手の包丁。"""
    p.box((0.03, 0.2, 0.006), (0.12, -0.62, SH_STAND - 0.48), M["knife"], rot=(0.5, 0, 0))


def props_bucket(p):
    """右手に提げた水の入ったバケツ。"""
    x, y, z = 0.3, -0.1, SH_STAND - 0.8
    p.cyl(0.09, 0.12, 0.2, (x, y, z), M["basket"], segs=16)
    p.cyl(0.11, 0.11, 0.004, (x, y, z + 0.09), M["water"], segs=16)
    p.limb((x - 0.1, y, z + 0.1), (x, y, z + 0.3), 0.006, 0.006, M["dark"], segs=6)
    p.limb((x + 0.1, y, z + 0.1), (x, y, z + 0.3), 0.006, 0.006, M["dark"], segs=6)


def props_try_jacket(p):
    """試着している上着。"""
    shell(p, 0.215, 0.228, 0.78, SH_STAND - 0.02, math.pi, M["jacket"])


def props_show_jacket(p):
    """両手で広げて見せる上着。"""
    z = SH_STAND - 0.3
    p.box((0.42, 0.03, 0.62), (0, -0.5, z), M["jacket2"], bevel=0.01)
    for sx in (-1, 1):
        p.limb((sx * 0.21, -0.5, z + 0.26), (sx * 0.34, -0.5, z - 0.16), 0.05, 0.045, M["jacket2"], segs=8)


def props_stick(p):
    """両手で上へ伸ばした長い棒。"""
    p.limb((-0.08, -0.2, SH_STAND - 0.3), (0.3, -0.75, 3.2), 0.015, 0.012, M["stick"], segs=8)


# ポーズの表。base は common.py の person() のポーズ（脚と体の高さ）。hands は手の位置 [(x, y, dz), ...]
# （dz は肩からの高さ。None ならポーズのまま）。props は持たせる物を作る関数（Part を受け取る）と、その Part の名前。
# words は人の名詞のあとに足す語。base が sit のポーズには、腰の点（hip）を付ける。
POSES = {
    "stand": {"base": "stand", "label": "立つ", "words": [("stand", "verb")]},
    "walk": {"base": "walk", "label": "歩く", "words": [("walk", "verb")]},
    "run": {"base": "run", "label": "走る", "words": [("run", "verb")]},
    "sit": {"base": "sit", "label": "座る", "words": [("sit", "verb")]},
    "phone": {"base": "phone", "label": "スマホを見る", "words": [("phone", "noun"), ("look", "verb")]},
    # 立って、開いた本を胸の前で両手に持って読む
    "read": {"base": "stand", "label": "本を読む", "words": [("read", "verb"), ("book", "noun")],
             "hands": [(-0.16, -0.3, -0.22), (0.16, -0.3, -0.22)], "props": ("book", props_read)},
    # 立って、右手（+X 側）のリンゴを口に運んで食べる
    "eat": {"base": "stand", "label": "リンゴを食べる", "words": [("eat", "verb"), ("apple", "noun")],
            "hands": [(-0.27, 0.0, -0.52), (0.07, -0.22, 0.1)], "props": ("apple", props_eat)},
    # 歩きながら、段ボール箱を両手で前に抱えて運ぶ
    "carry": {"base": "walk", "label": "箱を運ぶ", "words": [("carry", "verb"), ("box", "noun")],
              "hands": [(-CARRY_BOX[0] / 2 - 0.03, -0.38, CARRY_HAND_Z), (CARRY_BOX[0] / 2 + 0.03, -0.38, CARRY_HAND_Z)],
              "props": ("box", props_carry)},
    # 立って、胸の前で両手を寄せて物を持つ（持つ物は付けない。配置で物を手の前に置く）
    "hold": {"base": "stand", "label": "両手で持つ", "words": [("hold", "verb")],
             "hands": [(-0.1, -0.3, -0.27), (0.1, -0.3, -0.27)]},
    # 立って、両手を前の下へ伸ばして物を置く（体は曲げられないので、手の位置だけで表す。hold より低く遠く、左右に開く）
    "put": {"base": "stand", "label": "物を置く", "words": [("put", "verb")],
            "hands": [(-0.17, -0.42, -0.44), (0.17, -0.42, -0.44)]},
    # 立って、右手（+X 側）のマグカップを口に当てて飲む
    "drink": {"base": "stand", "label": "飲む", "words": [("drink", "verb"), ("cup", "noun")],
              "hands": [(-0.27, 0.0, -0.52), (0.07, -0.22, 0.09)], "props": ("cup", props_drink)},
    # 座って、机（高さ 0.72 m）に向かってペンで書く。机は含めない
    "write": {"base": "sit", "label": "座って書く", "words": [("write", "verb"), ("pen", "noun")],
              "hands": [(-0.14, -0.4, 0.74 - SH_SIT), (0.1, -0.4, 0.76 - SH_SIT)], "props": ("pen", props_write)},
    # 立って、右手をひさしにして遠く（上）を見る。person() は頭の向きを変えられないので、手で表す
    "look": {"base": "stand", "label": "手をかざして見る", "words": [("look", "verb")],
             "hands": [(-0.27, 0.0, -0.52), (0.05, -0.2, 0.3)]},
    # 座って、右手（+X 側）を高く上げる（授業で発言を求める）。手の位置は common.py の raise_hand のまま
    "raise_hand": {"base": "raise_hand", "label": "座って手を上げる", "words": [("raise", "verb"), ("hand", "noun")]},
    # 立って、右手（+X 側）で正面（相手）を指さす。向きは配置の yaw で相手へ回す
    "point": {"base": "stand", "label": "正面を指さす", "words": [("point", "verb")],
              "hands": [(-0.27, 0.0, -0.52), (0.14, -0.72, 0.04)]},
    "read_sit": {"base": "sit", "label": "座って本を読む", "words": [("read", "verb"), ("book", "noun")],
                 "hands": [(-0.16, -0.3, -0.22), (0.16, -0.3, -0.22)], "props": ("book", props_read_sit)},
    # 立って、両手を腰の高さの前へ出す（台の上のフライパンは配置で置く）
    "cook": {"base": "stand", "label": "料理する", "words": [("cook", "verb")],
             "hands": [(-0.2, -0.38, -0.36), (0.2, -0.46, -0.3)]},
    # 踏み出して、右手を前の上へ振り抜く（ボールは配置で宙に置く）
    "throw": {"base": "walk", "label": "投げる", "words": [("throw", "verb")],
              "hands": [(-0.26, 0.2, -0.42), (0.2, -0.5, 0.42)]},
    # 立って、左手の傘を向かいの人へ差しかける
    "umbrella": {"base": "stand", "label": "傘を差しかける", "words": [("umbrella", "noun"), ("share", "verb")],
                 "hands": [(-0.12, -0.36, 0.42), (0.27, 0.0, -0.52)], "props": ("umbrella", props_umbrella),
                 "canopy": (-0.04, -0.62, SH_STAND + 1.2)},
    "run_bag": {"base": "run", "label": "かばんを持って走る", "words": [("run", "verb"), ("bag", "noun")],
                "hands": [(-0.22, -0.3, -0.3), (0.28, 0.05, -0.42)], "props": ("bag", props_run_bag)},
    "wipe": {"base": "stand", "label": "机を拭く", "words": [("wipe", "verb")],
             "hands": [(-0.22, -0.3, -0.53), (0.1, -0.56, -0.53)], "props": ("cloth", props_wipe)},
    "serve": {"base": "walk", "label": "お盆で運ぶ", "words": [("bring", "verb"), ("cup", "noun")],
              "hands": [(-0.26, -0.17, -0.5), (0.2, -0.42, -0.2)], "props": ("tray", props_serve)},
    # 立って、右手を真上へ伸ばす（高い所の物を取る）
    "reach": {"base": "stand", "label": "手を伸ばす", "words": [("reach", "verb")],
              "hands": [(-0.27, 0.0, -0.52), (0.1, -0.22, 0.78)]},
    # 立って、右手を斜め上の前へ差し出す（手伝おうとする）
    "offer": {"base": "stand", "label": "手を差し出す", "words": [("help", "verb")],
              "hands": [(-0.27, 0.0, -0.52), (0.14, -0.5, 0.3)]},
    "run_phone": {"base": "run", "label": "スマホを持って走る", "words": [("run", "verb"), ("phone", "noun")],
                  "hands": [(-0.22, 0.2, -0.36), (0.2, -0.5, 0.24)], "props": ("phone", props_run_phone)},
    "basket": {"base": "stand", "label": "かごを持つ", "words": [("basket", "noun"), ("wait", "verb")],
               "hands": [(-0.27, 0.0, -0.52), (0.36, -0.02, -0.52)], "props": ("basket", props_basket)},
    # 立って、左手の財布から右手でお札を前へ差し出す
    "pay": {"base": "stand", "label": "お金を払う", "words": [("pay", "verb"), ("money", "noun")],
            "hands": [(-0.16, -0.3, -0.3), (0.1, -0.6, -0.27)], "props": ("money", props_pay)},
    # 立って、重ねた皿を両手で前へ持つ（机の縁の上に来る）
    "set_plates": {"base": "stand", "label": "皿を並べる", "words": [("put", "verb"), ("plate", "noun")],
                   "hands": [(-0.17, -0.5, -0.23), (0.17, -0.5, -0.23)], "props": ("plates", props_plates)},
    # 立って、右手を高い所の本へ伸ばす（手の高さは大人で 2.0 m）
    "take_book": {"base": "stand", "label": "高い所の本を取る", "words": [("reach", "verb"), ("book", "noun")],
                  "hands": [(-0.27, 0.0, -0.52), (0.12, -0.4, 0.7)]},
    # 立って、相手のほうを向き、左手で横の高い所を指して頼む
    "ask": {"base": "stand", "label": "指さして頼む", "words": [("ask", "verb"), ("point", "verb")],
            "hands": [(-0.66, -0.15, 0.5), (0.16, -0.28, -0.25)]},
    # 立って、右手のチョークで黒板に書く。黒板のほうを向くので、見る人には背中が見える
    "blackboard": {"base": "stand", "label": "黒板に書く", "words": [("write", "verb"), ("blackboard", "noun")],
                    "hands": [(-0.27, 0.0, -0.52), (0.16, -0.5, 0.32)], "props": ("chalk", props_write_board)},
    # 立って、両手を胸の高さの前へ出して球を受ける
    "catch": {"base": "stand", "label": "捕る", "words": [("catch", "verb")],
              "hands": [(-0.22, -0.46, 0.12), (0.22, -0.46, 0.12)]},
    "carry_veg": {"base": "walk", "label": "野菜の箱を運ぶ", "words": [("carry", "verb"), ("box", "noun"), ("vegetable", "noun")],
                  "hands": [(-CARRY_BOX[0] / 2 - 0.03, -0.38, CARRY_HAND_Z), (CARRY_BOX[0] / 2 + 0.03, -0.38, CARRY_HAND_Z)],
                  "props": ("box of vegetables", props_carry_veg)},
    # 立って、左手のメモ帳に右手のペンで書く
    "take_order": {"base": "stand", "label": "注文を取る", "words": [("take", "verb"), ("order", "noun")],
                   "hands": [(-0.1, -0.34, -0.12), (0.08, -0.36, -0.08)], "props": ("notepad", props_take_order)},
    "run_umbrella": {"base": "run", "label": "閉じた傘を持って走る", "words": [("run", "verb"), ("umbrella", "noun")],
                     "hands": [(-0.22, 0.2, -0.36), (0.2, -0.5, -0.05)], "props": ("umbrella", props_run_umbrella)},
    # 座って、机に重ねた腕の上に伏せて眠る。顔は下を向く
    "sleep": {"base": "sit", "label": "机に伏せて眠る", "words": [("sleep", "verb")],
              "head": {"at": (0, -0.34, 0.9), "pitch": 1.3},
              "hands": [(-0.13, -0.42, 0.76 - SH_SIT), (0.13, -0.42, 0.76 - SH_SIT)]},
    # 座って、手はももの上のまま、横の人のほうへ顔を向ける。_r は hand_r の側、_l は hand_l の側
    "sit_look_r": {"base": "sit", "label": "座って横を見る", "words": [("sit", "verb"), ("look", "verb"), ("listen", "verb")],
                   "head": {"yaw": 0.9, "pitch": 0.3}, "hands": [(-0.17, -0.3, -0.42), (0.17, -0.3, -0.42)], "mirror": "sit_look_l"},
    "sit_look_l": {"base": "sit", "label": "座って横を見る", "words": [("sit", "verb"), ("look", "verb"), ("listen", "verb")],
                   "head": {"yaw": -0.9, "pitch": 0.3}, "hands": [(-0.17, -0.3, -0.42), (0.17, -0.3, -0.42)], "mirror": "sit_look_r"},
    # 立って、片手を胸の前で開いて話しかける（ask の指さしより小さな動き）
    "question": {"base": "stand", "label": "話しかける", "words": [("ask", "verb"), ("talk", "verb")],
                 "hands": [(-0.27, 0.0, -0.52), (0.2, -0.34, -0.2)]},
    # 立って、片手を前へ差し出して見せる
    "show_hand": {"base": "stand", "label": "手を差し出して見せる", "words": [("show", "verb"), ("hand", "noun")],
                  "head": {"pitch": 0.35}, "hands": [(-0.27, 0.0, -0.52), (0.04, -0.44, -0.24)]},
    # 立って、子どもの手の高さへ両手を下ろし、のぞき込む
    "check_hand": {"base": "stand", "label": "手を確かめる", "words": [("check", "verb"), ("hand", "noun")],
                   "head": {"pitch": 0.5}, "hands": [(-0.07, -0.5, -0.5), (0.09, -0.5, -0.5)]},
    # 立って、右手を座った人の肩の高さへ伸ばして起こす
    "wake": {"base": "stand", "label": "肩に手を置く", "words": [("wake", "verb"), ("touch", "verb")],
             "hands": [(-0.27, 0.0, -0.52), (0.1, -0.5, -0.32)]},
    # M1〜M10 で足したポーズ
    "feed": {"base": "stand", "label": "鳥にえさをやる", "words": [("feed", "verb")], "head": {"pitch": 0.35},
             "hands": [(-0.27, 0.0, -0.52), (0.12, -0.5, -0.55)]},
    "lift_desk": {"base": "stand", "label": "机を両手で持って運ぶ", "words": [("carry", "verb"), ("move", "verb")],
                  "hands": [(-0.24, -0.4, -0.34), (0.24, -0.4, -0.34)]},
    "cut": {"base": "stand", "label": "ケーキを切る", "words": [("cut", "verb")], "head": {"pitch": 0.3},
            "hands": [(-0.2, -0.42, -0.5), (0.12, -0.5, -0.46)], "props": ("knife", props_cut)},
    "press": {"base": "stand", "label": "機械のボタンを押す", "words": [("buy", "verb"), ("press", "verb")],
              "hands": [(-0.27, 0.0, -0.52), (0.12, -0.55, -0.12)]},
    "kneel_build": {"base": "kneel", "label": "ひざをついて砂で作る", "words": [("build", "verb"), ("make", "verb")], "head": {"pitch": 0.35},
                    "hands": [(-0.2, -0.42, -0.72), (0.2, -0.42, -0.72)]},
    "bucket": {"base": "walk", "label": "水のバケツを運ぶ", "words": [("bring", "verb"), ("water", "noun"), ("bucket", "noun")],
               "hands": [(-0.27, 0.0, -0.52), (0.3, -0.1, -0.5)], "props": ("bucket", props_bucket)},
    "try_jacket": {"base": "stand", "label": "上着を試着する", "words": [("try", "verb"), ("jacket", "noun")],
                   "hands": [(-0.24, -0.2, -0.12), (0.24, -0.2, -0.12)], "props": ("jacket", props_try_jacket)},
    "show_jacket": {"base": "stand", "label": "上着を広げて見せる", "words": [("show", "verb"), ("jacket", "noun")],
                    "hands": [(-0.2, -0.46, -0.05), (0.2, -0.46, -0.05)], "props": ("jacket", props_show_jacket)},
    "poke": {"base": "stand", "label": "長い棒で高い所をつつく", "words": [("reach", "verb"), ("stick", "noun")],
             "hands": [(-0.05, -0.27, -0.12), (0.1, -0.4, 0.28)], "props": ("stick", props_stick)},
    "blow": {"base": "sit", "label": "座ってろうそくを吹き消す", "words": [("blow", "verb")], "head": {"pitch": 0.25},
             "hands": [(-0.2, -0.42, 0.74 - SH_SIT), (0.2, -0.42, 0.74 - SH_SIT)]},
    "clap": {"base": "sit", "label": "座って拍手する", "words": [("clap", "verb")],
             "hands": [(-0.03, -0.34, -0.2), (0.05, -0.36, -0.16)]},
    "fallen": {"base": "kneel", "label": "転んで地面に座り込む", "words": [("fall", "verb")], "head": {"pitch": 0.2},
                   "hands": [(-0.28, 0.12, -0.85), (0.18, -0.42, -0.22)]},
    "help_up": {"base": "stand", "label": "手を差しのべて助け起こす", "words": [("help", "verb")], "head": {"pitch": 0.4},
                "hands": [(-0.27, 0.0, -0.52), (0.1, -0.55, -0.5)]},
    "sweep": {"base": "stand", "label": "ほうきで掃く", "words": [("sweep", "verb"), ("clean", "verb"), ("broom", "noun")],
              "hands": [(-0.06, -0.28, -0.1), (0.08, -0.46, -0.5)], "props": ("broom", props_sweep)},
}

# 作る組み合わせ（ポーズ, 見た目）。この順で一覧に並ぶ
PEOPLE = [
    ("stand", "adult_a"), ("walk", "adult_a"), ("run", "adult_a"), ("sit", "adult_a"), ("phone", "adult_a"),
    ("walk", "woman_a"), ("sit", "woman_a"), ("run", "boy_a"), ("stand", "girl_a"),
    ("read", "adult_a"), ("eat", "adult_a"), ("carry", "adult_a"),
    # 新しいポーズ
    ("hold", "woman_a"), ("hold", "girl_a"), ("put", "adult_a"), ("put", "woman_a"), ("put", "boy_a"),
    ("drink", "woman_a"), ("drink", "adult_a"), ("write", "boy_a"), ("write", "girl_a"), ("look", "girl_a"),
    # 今あるポーズを別の見た目に広げたもの
    ("carry", "boy_a"), ("carry", "woman_a"), ("carry", "girl_a"), ("sit", "girl_a"), ("sit", "boy_a"),
    # 関係した数文の場面の PoC（poc/scene-story）で足したもの
    ("raise_hand", "boy_a"), ("point", "woman_a"),
    ("read_sit", "adult_a"), ("cook", "mother_a"), ("throw", "boy_a"), ("umbrella", "girl_a"), ("stand", "old_a"),
    ("run_bag", "adult_a"), ("wipe", "woman_a"), ("serve", "adult_a"), ("reach", "girl_a"), ("offer", "boy_a"),
    ("run_phone", "girl_a"), ("basket", "adult_a"),
    ("stand", "woman_a"), ("stand", "boy_a"), ("pay", "woman_a"), ("set_plates", "boy_a"), ("serve", "waiter_a"), ("take_book", "teen_a"), ("ask", "girl_a"),
    # 新しい確認用の 10 文（N1〜N10）で足したもの。多くは今あるポーズと見た目の組み合わせ
    ("basket", "woman_a"), ("question", "woman_a"), ("stand", "old_woman_a"), ("blackboard", "woman_a"), ("catch", "boy_a"),
    ("carry_veg", "clerk_a"), ("take_order", "waiter_a"), ("run_umbrella", "woman_a"), ("sleep", "teen_a"), ("wake", "woman_a"),
    ("sweep", "adult_a"),
    # N1〜N10 の判定を受けて足したもの
    ("sit_look_r", "boy_a"), ("sit_look_l", "boy_a"), ("show_hand", "boy_a"), ("check_hand", "mother_a"),
    # 次の確認用の 10 文（M1〜M10）で足したもの
    ("feed", "old_a"), ("lift_desk", "boy_a"), ("lift_desk", "girl_a"), ("cut", "mother_a"), ("press", "woman_a"),
    ("kneel_build", "boy_a"), ("bucket", "girl_a"), ("check_hand", "doctor_a"), ("show_hand", "girl_a"),
    ("try_jacket", "adult_a"), ("show_jacket", "clerk_a"), ("poke", "adult_a"), ("look", "boy_a"),
    ("blow", "girl_a"), ("clap", "adult_a"), ("clap", "woman_a"), ("clap", "boy_a"), ("fallen", "woman_a"), ("help_up", "adult_a"),
]


def outfits() -> dict:
    """見た目ごとの服と髪のマテリアル（make_materials() のあとで呼ぶ）。"""
    face = {"skin": M["skin"], "eye": M["eye"], "cheek": M["cheek"], "mouth": M["mouth"]}
    return {
        "adult_a": {**face, "hair": M["hair_black"], "top": M["shirt_blue"], "bottom": M["pants_gray"], "shoe": M["shoe_brown"]},
        "old_a": {**face, "hair": M["hair_gray"], "top": M["knit_brown"], "bottom": M["pants_gray"], "shoe": M["shoe_brown"]},
        "woman_a": {**face, "hair": M["hair_brown"], "top": M["knit_rose"], "bottom": M["skirt_navy"], "shoe": M["shoe_white"],
                    "skirt": True, "hair_style": "long"},
        "waiter_a": {**face, "hair": M["hair_black"], "top": M["white"], "sleeve": M["white"], "bottom": M["vest_black"], "shoe": M["dark"]},
        "mother_a": {**face, "hair": M["hair_brown"], "top": M["knit_rose"], "bottom": M["skirt_navy"], "shoe": M["shoe_white"],
                     "skirt": True, "hair_style": "long"},
        "old_woman_a": {**face, "hair": M["hair_gray"], "top": M["knit_brown"], "bottom": M["skirt_navy"], "shoe": M["shoe_brown"],
                        "skirt": True, "hair_style": "bun"},
        "clerk_a": {**face, "hair": M["hair_black"], "top": M["white"], "bottom": M["pants_gray"], "shoe": M["shoe_brown"]},
        "doctor_a": {**face, "hair": M["hair_black"], "top": M["white"], "sleeve": M["white"], "bottom": M["pants_gray"], "shoe": M["shoe_brown"]},
        "teen_a": {**face, "hair": M["hair_black"], "top": M["shirt_green"], "bottom": M["pants_beige"], "shoe": M["shoe_white"]},
        "boy_a": {**face, "hair": M["hair_black"], "top": M["shirt_yellow"], "bottom": M["shorts_blue"], "shoe": M["shoe_red"]},
        "girl_a": {**face, "hair": M["hair_brown"], "top": M["dress_pink"], "bottom": M["dress_pink"], "shoe": M["shoe_red"],
                   "skirt": True, "hair_style": "bun"},
    }


def person_builder(pose: str, look: str):
    spec, scale = POSES[pose], LOOKS[look]["scale"]

    def build(root):
        person(root, "person", (0, 0), 0.0, outfits()[look], pose=spec["base"], scale=scale, hands=spec.get("hands"), head=spec.get("head"))
        if "props" in spec:   # 持たせる物も人と同じ倍率にする（手の位置は人の倍率をかける前の座標）
            name, fn = spec["props"]
            p = Part(name)
            place = fn(p) or {}   # 持つ物を回して置くときは loc・rot_z を返す（loc は人の倍率をかける前の座標）
            p.finish(root, loc=Vector(place.get("loc", (0, 0, 0))) * scale, rot_z=place.get("rot_z", 0.0), scale=scale)
        if "wear" in LOOKS[look]:
            p = Part("wear")
            LOOKS[look]["wear"](p, *_heights(spec["base"]))
            p.finish(root, scale=scale)
        # 手・足元・頭の点。配置の計算と検査が使う。手は人の倍率をかけた位置
        sh = _heights(spec["base"])[1]
        given = spec.get("hands")
        points = [Vector((x, y, sh + dz)) for x, y, dz in given] if given else hand_points(spec["base"])
        anchors = {"hand_l": tuple(points[0] * scale), "hand_r": tuple(points[1] * scale),
                   "feet": (0, 0, 0), "head": tuple(Vector(spec.get("head", {}).get("at", (0, 0, sh + 0.22))) * scale)}
        if "canopy" in spec:   # 持った傘の布の真ん中
            anchors["canopy"] = tuple(Vector(spec["canopy"]) * scale)
        if spec["base"] in ("sit", "raise_hand"):   # 腰の点（common.py の person() の腰の球の中心）
            anchors["hip"] = (0, 0, _heights("sit")[0] * scale)
        return anchors
    build.__doc__ = f"{LOOKS[look]['label']}（{spec['label']}）"
    return build


for _pose, _look in PEOPLE:
    part(f"person_{_pose}_{_look}", "person", f"{LOOKS[_look]['label']}（{POSES[_pose]['label']}）",
         [(LOOKS[_look]["noun"], "noun"), *POSES[_pose]["words"]], pose=_pose, front=("eye", 1))(person_builder(_pose, _look))


# ---------- 床（8 m 四方の地面の部品） ----------
#
# どれも grass_patch と同じく 8 m × 8 m の薄い板（上面 2 mm）。模様は板の上に 0.5 mm ずつ重ねるので、
# 上面はいちばん高いところで 3 mm ほど。上に置く物は y = 0 のままでよい。

FLOOR = 8.0   # 床の一辺（m）


def floor_plate(p, mat, size=(FLOOR, FLOOR), center=(0, 0), radius=0.05):
    """床の板。上面は FLOOR_THICK。"""
    p.slab(size, FLOOR_THICK, FLOOR_THICK, radius, mat, segments=2 if radius < 0.1 else 6, center=center)


def mark(p, size, loc, mat, layer=1):
    """床の板の上の模様（厚さ MARK_THICK の板）。layer は重ねる段（2 なら 1 段目の模様の上）。"""
    p.box((size[0], size[1], MARK_THICK), (loc[0], loc[1], FLOOR_THICK + MARK_THICK * (layer - 0.5)), mat)


def spots(p, rng, count, r_range, mats, margin=0.1):
    """床の板の上に、平たい円のまだらを重ならないように散らす。

    同じ高さの面が重なると、描くときにちらつく（模様が渦のように乱れる）ので、重なる位置は選び直す。
    """
    placed = []
    for _ in range(count * 20):
        if len(placed) == count:
            break
        r = rng.uniform(*r_range)
        lim = FLOOR / 2 - margin - r
        x, y = rng.uniform(-lim, lim), rng.uniform(-lim, lim)
        if all(math.hypot(x - px, y - py) > r + pr + 0.02 for px, py, pr in placed):
            placed.append((x, y, r))
            p.cyl(r, r, MARK_THICK, (x, y, FLOOR_THICK + MARK_THICK / 2), rng.choice(mats), segs=14, smooth=False)


def planks(p, rng, mats, width, length, along_x, gap=0.012, half=FLOOR / 2):
    """フローリングの板を、継ぎ目をずらして並べる。板のすき間から下の板（目地の色）が見える。

    along_x なら板の長い向きは X（左右）、そうでなければ Y（Blender の前後）。
    """
    rows = round(2 * half / width)
    for r in range(rows):
        b = -half + width * (r + 0.5)
        a = -half - rng.uniform(0, length)
        while a < half:
            a0, a1 = max(a, -half), min(a + length, half)
            if a1 - a0 > 0.1:
                la, lb = a1 - a0 - gap, width - gap
                ca = (a0 + a1) / 2
                size, loc = ((la, lb), (ca, b)) if along_x else ((lb, la), (b, ca))
                mark(p, size, loc, rng.choice(mats))
            a += length


@part("floor_wood", "ground", "木の床（8 m 四方）", [("floor", "noun"), ("wooden floor", "noun")])
def build_floor_wood(root):
    """部屋の木の床（フローリング）。幅 0.4 m・長さ 1.6 m の濃い茶色の板を左右（X）に長く並べる。"""
    rng = random.Random(2622)
    p = Part("floor_wood")
    floor_plate(p, M["floor_gap"])
    planks(p, rng, [M["floor_wood_a"], M["floor_wood_b"], M["floor_wood_c"]], 0.4, 1.6, along_x=True)
    p.finish(root)


@part("floor_classroom", "ground", "教室の床（8 m 四方）", [("floor", "noun"), ("classroom floor", "noun")])
def build_floor_classroom(root):
    """学校の教室の床。木の床（floor_wood）より明るい色の細い板（幅 0.2 m）を、前後（Z）に長く並べる。"""
    rng = random.Random(2623)
    p = Part("floor_classroom")
    floor_plate(p, M["class_gap"])
    planks(p, rng, [M["class_wood_a"], M["class_wood_b"], M["class_wood_c"]], 0.2, 1.8, along_x=False, gap=0.008)
    p.finish(root)


@part("floor_tile", "ground", "白いタイルの床（8 m 四方）", [("floor", "noun"), ("tile", "noun"), ("tile floor", "noun")])
def build_floor_tile(root):
    """台所や店の白いタイルの床。0.5 m 角のタイルを、灰色の目地（下の板）を 3 cm あけ、白と薄い灰色を市松に並べる。"""
    p = Part("floor_tile")
    floor_plate(p, M["grout"])
    n, cell, gap = 16, FLOOR / 16, 0.03
    for i in range(n):
        for j in range(n):
            mat = M["tile_white"] if (i + j) % 2 == 0 else M["tile_gray"]
            mark(p, (cell - gap, cell - gap), (-FLOOR / 2 + cell * (i + 0.5), -FLOOR / 2 + cell * (j + 0.5)), mat)
    p.finish(root)


@part("floor_carpet", "ground", "じゅうたん（8 m 四方）", [("carpet", "noun"), ("rug", "noun"), ("floor", "noun")])
def build_floor_carpet(root):
    """部屋いっぱいのじゅうたん。青い地に、縁の近くを濃い青の帯とクリーム色の細い線で囲む。"""
    p = Part("floor_carpet")
    floor_plate(p, M["carpet"])
    for inset, band, mat in ((0.25, 0.4, M["carpet_border"]), (0.8, 0.06, M["carpet_line"])):
        span = FLOOR - 2 * inset          # 帯の外側の一辺
        c = FLOOR / 2 - inset - band / 2  # 帯の中心までの距離
        for s in (-1, 1):
            mark(p, (span, band), (0, s * c), mat)
            mark(p, (band, span - 2 * band), (s * c, 0), mat)
    p.finish(root)


@part("floor_bus", "ground", "バスの床（8 m 四方）", [("floor", "noun"), ("bus", "noun")])
def build_floor_bus(root):
    """バスの中の床。灰色の地に、すべり止めの点と、手前の黄色い線。"""
    p = Part("floor_bus")
    floor_plate(p, M["bus_floor"])
    mark(p, (FLOOR, 0.12), (0, -2.2), M["bus_line"])
    p.finish(root)


@part("wall_bus", "building", "バスの中の壁（窓の列と手すり）", [("bus", "noun"), ("window", "noun"), ("wall", "noun")], front=("bus_rail", 1))
def build_wall_bus(root):
    """バスの中の奥の壁。横に長い窓が 4 つと、窓の上の手すり、縦の棒。"""
    p = Part("wall_bus")
    wall_board(p, M["bus_wall"], M["dark"])
    w, h, z0, y = 1.7, 0.85, 1.0, WALL_FRONT
    for cx in (-3.0, -1.0, 1.0, 3.0):
        p.box((w, 0.01, h), (cx, y - 0.005, z0 + h / 2), M["window_glass"])
        p.box((w + 0.1, 0.1, 0.05), (cx, y - 0.05, z0 - 0.025), M["bus_sill"], bevel=0.008)
        for sx in (-1, 1):
            p.box((0.05, 0.04, h), (cx + sx * (w / 2 + 0.025), y - 0.02, z0 + h / 2), M["bus_sill"])
        p.box((w + 0.1, 0.04, 0.05), (cx, y - 0.02, z0 + h + 0.025), M["bus_sill"])
    p.limb((-3.9, y - 0.14, 2.1), (3.9, y - 0.14, 2.1), 0.02, 0.02, M["bus_rail"], segs=8)
    for x in (-2.0, 0.0, 2.0):
        p.limb((x, y - 0.14, 0.0), (x, y - 0.14, 2.1), 0.02, 0.02, M["bus_rail"], segs=8)
    p.finish(root)


# 駅のホーム: ホームの端は奥（-Z）。奥の 2.8 m は線路で、線路の中心は z = -2.6（Blender の y = 2.6）
PLATFORM_TRACK = 2.8                          # 線路の部分の奥行き（m）
PLATFORM_TRACK_Z = FLOOR / 2 - PLATFORM_TRACK / 2   # 線路の中心（プロトコルの z = -2.6）
RAIL_GAUGE = 1.067                            # 線路の幅（日本の在来線）


@part("platform_station", "ground", "駅のホーム（奥に線路、8 m 四方）",
      [("platform", "noun"), ("station", "noun"), ("train station", "noun")], front=("platform_edge", -1))
def build_platform_station(root):
    """駅のホームと線路。手前の 5.2 m がホームで、奥（-Z）の端に白線、その 0.8 m 手前に黄色い点字ブロックの帯がある。

    奥の 2.8 m は線路（砕石・枕木・2 本のレール）で、線路の中心は z = -2.6。train をここに置く。
    ホームも線路も同じ高さの薄い板（ホームの段差は作らない）。
    """
    p = Part("platform_station")
    plat_d = FLOOR - PLATFORM_TRACK
    edge_y = FLOOR / 2 - PLATFORM_TRACK   # Blender の y。ホームの端（奥）
    floor_plate(p, M["platform"], size=(FLOOR, plat_d), center=(0, edge_y - plat_d / 2))
    floor_plate(p, M["ballast"], size=(FLOOR, PLATFORM_TRACK), center=(0, PLATFORM_TRACK_Z))
    mark(p, (FLOOR, 0.12), (0, edge_y - 0.1), M["platform_edge"])   # 端の白線
    mark(p, (FLOOR, 0.3), (0, edge_y - 0.95), M["tactile"])           # 点字ブロックの帯
    for k in range(40):   # 点字ブロックの点（少し明るい黄色の代わりに、帯の上に小さな四角を重ねる）
        mark(p, (0.12, 0.12), (-FLOOR / 2 + 0.1 + k * 0.2, edge_y - 0.95), M["flower_yellow"], layer=2)
    for k in range(13):   # 枕木
        mark(p, (0.2, 2.0), (-FLOOR / 2 + 0.3 + k * 0.62, PLATFORM_TRACK_Z), M["sleeper"])
    for s in (-1, 1):     # レール（枕木の上）
        mark(p, (FLOOR, 0.07), (0, PLATFORM_TRACK_Z + s * RAIL_GAUGE / 2), M["rail"], layer=2)
    p.finish(root)


@part("sand_beach", "ground", "砂浜（8 m 四方）", [("beach", "noun"), ("sand", "noun")])
def build_sand_beach(root):
    """海辺の砂浜。砂の色の板に濃淡のまだらと、小さな貝がらと小石を散らす。"""
    rng = random.Random(2624)
    p = Part("sand_beach")
    floor_plate(p, M["sand"], radius=0.3)
    spots(p, rng, 40, (0.25, 0.7), [M["sand_dark"], M["sand_light"]])
    for k in range(18):   # 貝がら（平たい玉）と小石
        x, y = rng.uniform(-3.6, 3.6), rng.uniform(-3.6, 3.6)
        r = rng.uniform(0.03, 0.05)
        p.sphere(r, (x, y, r * 0.35), M["shell"] if k % 2 else M["pebble"], scale=(1, 0.8, 0.35), segs=8)   # 底は y = 0
    p.finish(root)


@part("sidewalk_stone", "ground", "石畳の歩道（8 m 四方）", [("sidewalk", "noun"), ("pavement", "noun"), ("stone path", "noun")])
def build_sidewalk_stone(root):
    """石畳の歩道。幅 0.4 m・長さ 0.6 m の灰色の石を、1 列ごとに半分ずらして並べる。目地は濃い灰色。"""
    rng = random.Random(2625)
    p = Part("sidewalk_stone")
    floor_plate(p, M["stone_joint"])
    width, length, gap, half = 0.4, 0.6, 0.025, FLOOR / 2
    for r in range(round(FLOOR / width)):
        y = -half + width * (r + 0.5)
        x = -half - (length / 2 if r % 2 else 0)
        while x < half:
            x0, x1 = max(x, -half), min(x + length, half)
            if x1 - x0 > 0.1:
                mark(p, (x1 - x0 - gap, width - gap), ((x0 + x1) / 2, y), rng.choice([M["stone_a"], M["stone_b"], M["stone_c"]]))
            x += length
    p.finish(root)


@part("ground_dirt", "ground", "土のグラウンド（8 m 四方）", [("ground", "noun"), ("dirt", "noun"), ("field", "noun")])
def build_ground_dirt(root):
    """学校の校庭のような土のグラウンド。濃淡のまだらと小石に、石灰の白線を 1 本（手前寄りを左右に）引く。"""
    rng = random.Random(2626)
    p = Part("ground_dirt")
    floor_plate(p, M["dirt"], radius=0.3)
    spots(p, rng, 45, (0.25, 0.65), [M["dirt_dark"], M["dirt_light"]])
    mark(p, (FLOOR - 0.6, 0.1), (0, -1.5), M["stripe"], layer=2)
    for _ in range(16):
        r = rng.uniform(0.025, 0.045)
        p.sphere(r, (rng.uniform(-3.7, 3.7), rng.uniform(-3.7, 3.7), r * 0.45), M["pebble"], scale=(1, 0.85, 0.45), segs=8)
    p.finish(root)


# ---------- 背景の壁 ----------
#
# 場面の奥に 1 枚置く壁。幅 8 m（床と同じ）・高さ 2.6 m・板の厚さ 0.12 m。表（+Z）に窓や黒板などが付く。
# 原点は外接箱の底面の中心なので、表に出っ張る物（棚など）がある壁ほど奥行き（size の z）が大きい。
# 奥の端に付けるときは z = -4 + 奥行き / 2 に置く。裏は無地。

WALL_W, WALL_H, WALL_T = 8.0, 2.6, 0.12
WALL_FRONT = -WALL_T / 2   # 壁の表の面（Blender の y。正面は -Y）


def wall_board(p, mat, base_mat=None):
    """壁の板。表は mat、裏は無地。base_mat があれば表の下に幅木（高さ 8 cm）を付ける。"""
    p.box((WALL_W, WALL_T - 0.01, WALL_H), (0, 0.005, WALL_H / 2), M["wall_back"])
    p.box((WALL_W, 0.01, WALL_H), (0, WALL_FRONT + 0.005, WALL_H / 2), mat)
    if base_mat:
        p.box((WALL_W, 0.015, 0.08), (0, WALL_FRONT - 0.0075, 0.04), base_mat)


@part("wall_window", "building", "窓つきの壁（幅 8 m）", [("wall", "noun"), ("window", "noun")], front=("wall_window_sill", 1))
def build_wall_window(root):
    """部屋やカフェの奥の壁。幅 1.6 m・高さ 1.2 m の窓が 3 つ（ガラスの向こうは明るい空）と、両脇のカーテン。"""
    p = Part("wall_window")
    wall_board(p, M["wall"], M["baseboard"])
    w, h, z0, fw = 1.6, 1.2, 0.9, 0.06
    for cx in (-2.6, 0.0, 2.6):
        y = WALL_FRONT
        p.box((w - 2 * fw, 0.01, h - 2 * fw), (cx, y - 0.005, z0 + h / 2), M["window_glass"])
        for sx in (-1, 1):
            p.box((fw, 0.05, h), (cx + sx * (w / 2 - fw / 2), y - 0.025, z0 + h / 2), M["window_frame"], bevel=0.006)
        for z in (z0 + fw / 2, z0 + h - fw / 2):
            p.box((w - 2 * fw, 0.05, fw), (cx, y - 0.025, z), M["window_frame"], bevel=0.006)
        p.box((0.04, 0.03, h - 2 * fw), (cx, y - 0.015, z0 + h / 2), M["window_frame"])   # 2 枚の戸の合わせ目
        p.box((w + 0.12, 0.16, 0.04), (cx, y - 0.08, z0 - 0.02), M["wall_window_sill"], bevel=0.006)   # 窓台
        for sx in (-1, 1):   # カーテン（ひだを 3 本の丸い棒で表す）
            for k in range(3):
                p.cyl(0.05, 0.06, h + 0.3, (cx + sx * (w / 2 + 0.07 + k * 0.08), y - 0.07, z0 + h / 2 + 0.05), M["curtain"], segs=8)
        p.limb((cx - w / 2 - 0.4, y - 0.07, z0 + h + 0.22), (cx + w / 2 + 0.4, y - 0.07, z0 + h + 0.22), 0.015, 0.015, M["metal"], segs=8)
    p.finish(root)


@part("wall_kitchen_tile", "building", "キッチンの壁（幅 8 m）",
      [("wall", "noun"), ("kitchen", "noun"), ("tile", "noun")], front=("kitchen_cabinet", 1))
def build_wall_kitchen_tile(root):
    """台所の奥の壁。高さ 0.85〜1.85 m に 0.2 m 角の白と緑のタイルを貼り、真ん中の 3.2 m の上に木の吊り戸棚がある。壁はクリーム色。

    kitchen_counter（高さ 0.9 m）を手前に置くと、タイルが流しの上に見える。
    """
    p = Part("wall_kitchen_tile")
    wall_board(p, M["wall_kitchen"], M["baseboard"])
    cell, gap, z0, rows = 0.2, 0.012, 0.85, 5
    for i in range(round(WALL_W / cell)):
        for j in range(rows):
            mat = M["kitchen_tile2"] if (i + j) % 3 == 0 else M["kitchen_tile"]
            p.box((cell - gap, 0.006, cell - gap), (-WALL_W / 2 + cell * (i + 0.5), WALL_FRONT - 0.003, z0 + cell * (j + 0.5)), mat)
    # 吊り戸棚（扉 4 枚と取っ手）
    cw, ch, cd, cz = 3.2, 0.6, 0.35, 1.95
    p.box((cw, cd - 0.02, ch), (0, WALL_FRONT - (cd - 0.02) / 2, cz + ch / 2), M["cabinet"], bevel=0.01)
    for k in range(4):
        x = -cw / 2 + cw / 8 * (2 * k + 1)
        p.box((cw / 4 - 0.02, 0.02, ch - 0.04), (x, WALL_FRONT - cd + 0.01, cz + ch / 2), M["kitchen_cabinet"], bevel=0.006)
        p.box((0.015, 0.02, 0.12), (x + (0.3 if k % 2 == 0 else -0.3), WALL_FRONT - cd - 0.005, cz + 0.12), M["metal"], bevel=0.004)
    p.finish(root)


@part("wall_blackboard", "building", "黒板つきの壁（教室、幅 8 m）",
      [("blackboard", "noun"), ("chalkboard", "noun"), ("wall", "noun")], front=("chalk_tray", 1))
def build_wall_blackboard(root):
    """教室の前の壁。真ん中に幅 4 m・高さ 1.2 m の緑の黒板（木の枠と粉受け、チョーク）、下に木の腰板。"""
    p = Part("wall_blackboard")
    wall_board(p, M["wall"])
    p.box((WALL_W, 0.015, 0.9), (0, WALL_FRONT - 0.0075, 0.45), M["wainscot"])   # 腰板
    p.box((WALL_W, 0.03, 0.04), (0, WALL_FRONT - 0.015, 0.9), M["board_frame"])
    bw, bh, bz = 4.0, 1.2, 0.85
    p.box((bw + 0.12, 0.04, bh + 0.12), (0, WALL_FRONT - 0.02, bz + bh / 2), M["board_frame"], bevel=0.01)
    p.box((bw, 0.01, bh), (0, WALL_FRONT - 0.045, bz + bh / 2), M["blackboard"])
    p.box((bw + 0.12, 0.12, 0.04), (0, WALL_FRONT - 0.06, bz - 0.02), M["chalk_tray"], bevel=0.008)   # 粉受け
    for k, mat in enumerate((M["chalk"], M["chalk"], M["chalk_pink"], M["chalk_yellow"])):
        p.limb((1.2 + k * 0.12, WALL_FRONT - 0.08, bz + 0.012), (1.28 + k * 0.12, WALL_FRONT - 0.09, bz + 0.012), 0.008, 0.008, mat, segs=6)
    p.finish(root)
    return {"spots": {"board": (-0.9, WALL_FRONT - 0.05, 1.5)}}   # 人が書く所。真ん中を空ける


@part("wall_cafe", "building", "カフェの奥の壁（カウンターつき）",
      [("cafe", "noun"), ("counter", "noun"), ("menu", "noun"), ("wall", "noun")], front=("cafe_groove", 1))
def build_wall_cafe(root):
    """カフェの奥の壁。幅 5 m のカウンターに、コーヒーマシンとケーキの棚。壁に黒板のメニューとカップの棚、上につり下げたランプ。"""
    p = Part("wall_cafe")
    wall_board(p, M["cafe_wall"], M["cafe_wood"])
    cx, w, d, h = -0.4, 5.0, 0.7, 1.0
    cy = WALL_FRONT - d / 2
    p.box((w, d, h), (cx, cy, h / 2), M["cafe_wood"], bevel=0.02)
    p.box((w + 0.08, d + 0.08, 0.06), (cx, cy, h + 0.03), M["marble"], bevel=0.015)
    for k in range(int(w / 0.3)):   # 前板の縦の溝
        p.box((0.03, 0.02, 0.85), (cx - w / 2 + 0.15 + k * 0.3, cy - d / 2 - 0.005, 0.5), M["cafe_groove"])
    top = h + 0.06
    # コーヒーマシン
    mx = 0.9
    p.box((0.75, 0.45, 0.5), (mx, cy, top + 0.25), M["steel"], bevel=0.03)
    p.box((0.77, 0.47, 0.06), (mx, cy, top + 0.53), M["dark"], bevel=0.02)
    p.box((0.65, 0.02, 0.18), (mx, cy - 0.23, top + 0.39), M["dark"], bevel=0.01)
    for sx in (-1, 1):
        p.cyl(0.04, 0.035, 0.08, (mx + sx * 0.17, cy - 0.18, top + 0.22), M["dark"], segs=12)
        p.cyl(0.04, 0.05, 0.08, (mx + sx * 0.17, cy - 0.2, top + 0.04), M["cup"], segs=14)
    for k in range(5):
        p.cyl(0.04, 0.05, 0.07, (mx - 0.26 + k * 0.13, cy, top + 0.595), M["cup"], segs=14)
    # ケーキの棚（ガラスは描かず、枠と台の上にケーキを並べる）
    kx = -1.5
    for sx in (-1, 1):
        p.box((0.03, 0.4, 0.5), (kx + sx * 0.6, cy, top + 0.25), M["cafe_groove"])
    for z in (0.02, 0.27, 0.49):
        p.box((1.22, 0.42, 0.025), (kx, cy, top + z), M["cafe_groove"] if z > 0.4 else M["marble"])
    colors = ["cake", "cake_pink", "cake_choco", "cake", "cake_choco", "cake_pink", "cake", "cake_pink"]
    for k, c in enumerate(colors):
        x, z = kx - 0.39 + (k % 4) * 0.26, top + (0.035 if k < 4 else 0.285)
        p.cyl(0.1, 0.1, 0.012, (x, cy, z + 0.006), M["dish"], segs=20, smooth=False)
        p.cyl(0.08, 0.08, 0.1, (x, cy, z + 0.062), M[c], segs=20)
        p.sphere(0.022, (x, cy, z + 0.125), M["apple"], segs=10)
    # 黒板のメニュー（文字の代わりの線）
    bx, bz, bw, bh = -1.5, 1.95, 1.5, 0.95
    p.box((bw + 0.1, 0.03, bh + 0.1), (bx, WALL_FRONT - 0.015, bz), M["cafe_groove"], bevel=0.01)
    p.box((bw, 0.01, bh), (bx, WALL_FRONT - 0.035, bz), M["blackboard"])
    p.box((0.7, 0.008, 0.06), (bx, WALL_FRONT - 0.042, bz + 0.34), M["chalk_yellow"])
    for row in range(5):
        z = bz + 0.18 - row * 0.13
        p.box((0.75, 0.008, 0.025), (bx - 0.22, WALL_FRONT - 0.042, z), M["chalk"])
        p.box((0.18, 0.008, 0.025), (bx + 0.5, WALL_FRONT - 0.042, z), M["chalk_pink"])
    # カップの棚
    for z in (1.75, 2.1):
        p.box((1.5, 0.22, 0.04), (1.1, WALL_FRONT - 0.11, z), M["cafe_groove"])
        for k in range(8):
            p.cyl(0.04, 0.05, 0.1, (0.5 + k * 0.17, WALL_FRONT - 0.11, z + 0.07), M["cup"] if k % 3 else M["mug"], segs=14)
    # つり下げたランプ
    for x in (-2.2, -0.4, 1.4, 3.0):
        p.limb((x, WALL_FRONT, 2.52), (x, cy, 2.52), 0.015, 0.015, M["dark"], segs=6)
        p.limb((x, cy, 2.52), (x, cy, 2.22), 0.008, 0.008, M["dark"], segs=6)
        p.cyl(0.24, 0.05, 0.22, (x, cy, 2.13), M["dark"], segs=20)
        p.sphere(0.09, (x, cy, 2.02), M["cafe_lamp"], segs=14)
    p.finish(root)


@part("plant_pot", "plant", "鉢植えの木", [("plant", "noun")])
def build_plant_pot(root):
    """店の隅に置く鉢植え。高さ 1.5 m。"""
    p = Part("plant_pot")
    p.cyl(0.18, 0.24, 0.42, (0, 0, 0.21), M["pot"], segs=18)
    p.cyl(0.22, 0.22, 0.03, (0, 0, 0.41), M["bark"], segs=18)
    p.cyl(0.03, 0.03, 0.6, (0, 0, 0.7), M["bark"], segs=8)
    for i, (x, y, z, r) in enumerate([(0, 0, 1.15, 0.36), (0.22, 0.08, 0.95, 0.28), (-0.2, -0.1, 1.0, 0.28), (0.02, 0.1, 1.3, 0.24)]):
        p.blob(r, (x, y, z), M["leaf"] if i % 2 else M["leaf2"], bumpy=0.3, subdiv=3, seed=i * 2.7)
    p.finish(root)


@part("wall_store_shelves", "building", "商品棚が並ぶ壁（店、幅 8 m）",
      [("shelf", "noun"), ("store", "noun"), ("shop", "noun"), ("wall", "noun")], front=("price_rail", 1))
def build_wall_store_shelves(root):
    """店の奥の壁。高さ 1.8 m・奥行き 0.4 m の商品棚が 4 台並び、色とりどりの商品の箱が載っている。上に橙の帯。"""
    rng = random.Random(2627)
    p = Part("wall_store_shelves")
    wall_board(p, M["store_wall"])
    p.box((WALL_W, 0.02, 0.3), (0, WALL_FRONT - 0.01, 2.2), M["store_sign"])   # 上の帯
    goods = [M[f"goods_{c}"] for c in "abcdef"]
    uw, sh, sd, t = 1.9, 1.8, 0.4, 0.03
    front = WALL_FRONT - sd
    for u in range(4):
        cx = -WALL_W / 2 + 0.1 + uw * (u + 0.5)
        for sx in (-1, 1):
            p.box((t, sd, sh), (cx + sx * (uw / 2 - t / 2), WALL_FRONT - sd / 2, sh / 2), M["store_shelf"])
        p.box((uw - 2 * t, 0.1, 0.12), (cx, front + 0.05, 0.06), M["store_shelf"])   # 下の幕板
        boards = [0.12 + k * 0.42 for k in range(4)] + [sh - t / 2]
        for z in boards:
            p.box((uw - 2 * t, sd, t), (cx, WALL_FRONT - sd / 2, z), M["store_shelf"])
            if z < sh - t:
                p.box((uw - 2 * t, 0.012, 0.04), (cx, front - 0.006, z), M["price_rail"])   # 値札の帯
        for z in boards[:-1]:   # 商品の箱を左から詰める
            x = cx - uw / 2 + t + 0.03
            mat_k = rng.randrange(6)
            while True:
                bw, bh = rng.uniform(0.12, 0.22), rng.uniform(0.14, min(0.3, 0.42 - t - 0.05))
                if x + bw > cx + uw / 2 - t - 0.03:
                    break
                if rng.random() < 0.35:
                    mat_k = rng.randrange(6)   # 同じ色の箱が何個か続く
                p.box((bw - 0.01, 0.26, bh), (x + bw / 2, front + 0.16, z + t / 2 + bh / 2), goods[mat_k])   # 角は丸めない（軽くする）
                x += bw
    p.finish(root)


# ---------- 場面らしさを出す大物 ----------

@part("kitchen_counter", "furniture", "台所の流しとコンロ",
      [("kitchen", "noun"), ("sink", "noun"), ("stove", "noun"), ("counter", "noun")], front=("kitchen_front", 1))
def build_kitchen_counter(root):
    """台所の流し台とコンロ。幅 2.4 m・奥行き 0.65 m・天板の高さ 0.9 m。扉のある側が正面（+Z）。

    流しは -X 側（中心 x = -0.6）、2 口のコンロは +X 側（中心 x = 0.65）。物は真ん中（x = -0.15〜0.3）か
    +X の端に置く。蛇口は流しの奥にある。
    """
    w, d, h = 2.4, 0.65, 0.9
    p = Part("kitchen_counter")
    p.box((w - 0.04, d - 0.1, 0.1), (0, 0.04, 0.05), M["dark"])                                   # 台輪
    body_d = d - 0.03
    p.box((w, body_d, h - 0.14), (0, 0.015, 0.1 + (h - 0.14) / 2), M["counter"])                # 胴
    p.box((w + 0.02, d + 0.02, 0.04), (0, 0, h - 0.02), M["steel"], bevel=0.006)                 # 天板
    front = 0.015 - body_d / 2
    for k in range(4):   # 下の扉 4 枚と、上の引き出し 4 つ
        x = -w / 2 + w / 8 * (2 * k + 1)
        p.box((w / 4 - 0.03, 0.02, 0.54), (x, front - 0.01, 0.4), M["kitchen_front"], bevel=0.008)
        p.box((w / 4 - 0.03, 0.02, 0.12), (x, front - 0.01, 0.76), M["kitchen_front"], bevel=0.008)
        p.box((0.12, 0.02, 0.015), (x, front - 0.03, 0.62), M["metal"], bevel=0.004)
    # 流し（くぼみの代わりに、天板の上に縁と濃い底を重ねる）と蛇口
    sx = -0.6
    p.box((0.8, 0.46, 0.006), (sx, -0.02, h + 0.003), M["steel"])
    p.box((0.7, 0.36, 0.004), (sx, -0.02, h + 0.008), M["sink"])
    p.cyl(0.025, 0.025, 0.3, (sx, 0.24, h + 0.15), M["metal"], segs=10)
    p.limb((sx, 0.24, h + 0.3), (sx, 0.08, h + 0.3), 0.02, 0.02, M["metal"], segs=10)
    p.limb((sx, 0.08, h + 0.3), (sx, 0.08, h + 0.24), 0.018, 0.018, M["metal"], segs=10)
    p.box((0.04, 0.08, 0.03), (sx + 0.06, 0.24, h + 0.3), M["metal"], bevel=0.006)               # レバー
    # 2 口のコンロ（黒い天板・五徳の輪）と、前のつまみ
    cx = 0.65
    p.box((0.62, 0.5, 0.012), (cx, -0.01, h + 0.006), M["stove"], bevel=0.004)
    for bx in (-0.15, 0.15):
        p.cyl(0.1, 0.1, 0.012, (cx + bx, -0.03, h + 0.018), M["burner"], segs=16, smooth=False)
        p.cyl(0.05, 0.05, 0.016, (cx + bx, -0.03, h + 0.02), M["stove"], segs=12, smooth=False)
        p.cyl(0.025, 0.025, 0.03, (cx + bx, front - 0.035, 0.76), M["dark"], rot=(math.pi / 2, 0, 0), segs=10, smooth=False)
    p.finish(root)
    # 天板の上面（流しとコンロの無いところに物を置く）と、物を載せるコンロ・流しの場所
    return {"top": h, "spots": {"stove": (cx - 0.15, -0.03, h + 0.025), "sink": (sx, -0.02, h)}}


TRAIN_LEN, TRAIN_W = 8.0, 2.6   # 電車の長さ（X）と幅。実物（約 20 m）を縮め、8 m 四方に収める


@part("train", "vehicle", "電車（1 両）", [("train", "noun")])
def build_train(root):
    """駅に停まる電車 1 両。長い向きを左右（X）に置く。長さ 8 m・幅 2.6 m・高さ 3.2 m（実物の約 20 m を縮めた）。

    両側に扉が 2 つずつあり、前後（±X）は同じ形の運転台。表と裏も同じ形なので向きは確かめない。
    車輪の間隔は線路の幅（1.067 m）に合わせてあり、platform_station の線路（z = -2.6）に置ける。
    """
    L, W = TRAIN_LEN - 0.04, TRAIN_W   # 車体の長さ。前後の窓とライトが 2 cm ずつ出て、全体で 8 m になる
    p = Part("train")
    z0, z1 = 0.45, 2.85    # 車体の下と上
    p.box((L, W, z1 - z0), (0, 0, (z0 + z1) / 2), M["train_body"], bevel=0.15, segments=3)
    p.box((L - 0.5, W - 0.5, 0.14), (0, 0, z1 + 0.05), M["train_roof"], bevel=0.05)              # 屋根
    p.box((1.6, 1.2, 0.2), (0, 0, z1 + 0.22), M["train_roof"], bevel=0.04)                       # 冷房の箱
    p.box((L + 0.01, W + 0.01, 0.24), (0, 0, 1.05), M["train_band"])                              # 帯
    p.box((L + 0.01, W + 0.01, 0.07), (0, 0, 2.62), M["train_band"])
    doors, door_w = (-2.2, 2.2), 1.3
    for sy in (-1, 1):
        y = sy * (W / 2 + 0.008)
        for dx in doors:   # 両開きの扉（窓つき）
            p.box((door_w, 0.012, 1.95), (dx, y, 0.5 + 0.975), M["train_door"])
            p.box((0.02, 0.016, 1.95), (dx, y, 0.5 + 0.975), M["dark"])
            for lx in (-1, 1):
                p.box((0.38, 0.016, 0.75), (dx + lx * door_w / 4, y, 1.85), M["car_glass"])
        spans = [(-L / 2 + 0.35, doors[0] - door_w / 2 - 0.15), (doors[0] + door_w / 2 + 0.15, -0.08),
                 (0.08, doors[1] - door_w / 2 - 0.15), (doors[1] + door_w / 2 + 0.15, L / 2 - 0.35)]
        for a, b in spans:   # 窓
            p.box((b - a, 0.016, 0.85), ((a + b) / 2, y, 1.85), M["car_glass"])
    for sx in (-1, 1):   # 前後の運転台（窓・ライト・行き先の表示）
        x = sx * (L / 2 + 0.008)
        p.box((0.016, W - 0.5, 0.9), (x, 0, 1.9), M["car_glass"])
        p.box((0.016, 1.0, 0.2), (x, 0, 2.55), M["dark"])
        for ly in (-1, 1):
            p.box((0.02, 0.24, 0.12), (x, ly * (W / 2 - 0.4), 1.05), M["headlight"])
    # 床下（機器の箱・台車・車輪）
    p.box((L - 1.6, W - 0.5, 0.3), (0, 0, 0.42), M["frame"])
    for bx in (-2.7, 2.7):
        p.box((2.0, RAIL_GAUGE + 0.3, 0.25), (bx, 0, 0.42), M["dark"], bevel=0.03)
        for wx in (-0.6, 0.6):
            for sy in (-1, 1):
                p.cyl(0.25, 0.25, 0.08, (bx + wx, sy * RAIL_GAUGE / 2, 0.25), M["tire"], rot=(math.pi / 2, 0, 0), segs=16, smooth=False)
    p.finish(root)


@part("station_sign", "thing", "駅名の看板", [("sign", "noun"), ("station sign", "noun")])
def build_station_sign(root):
    """ホームに立つ駅名の看板。幅 1.7 m の白い板（高さ 1.65〜2.2 m）を 2 本の柱で支える。

    文字の代わりに、駅名の濃い灰色の帯と、隣の駅を示す青い帯がある。表と裏は同じ形なので向きは確かめない。
    """
    w, z0, z1, t = 1.7, 1.65, 2.2, 0.06
    p = Part("station_sign")
    for sx in (-1, 1):
        p.cyl(0.04, 0.04, z1 - 0.05, (sx * 0.65, 0, (z1 - 0.05) / 2), M["frame"], segs=10)
    p.box((w, t, z1 - z0), (0, 0, (z0 + z1) / 2), M["sign_board"], bevel=0.012)
    for sy in (-1, 1):
        y = sy * (t / 2 + 0.003)
        p.box((0.8, 0.006, 0.15), (0, y, z0 + 0.36), M["sign_text"])     # 駅名（文字の代わり）
        p.box((w - 0.08, 0.006, 0.12), (0, y, z0 + 0.14), M["sign_band"])  # 隣の駅の帯
        for sx in (-1, 1):
            p.box((0.28, 0.008, 0.05), (sx * 0.55, y, z0 + 0.14), M["sign_board"])
    p.finish(root)


@part("bus_shelter", "building", "屋根つきのバス停", [("bus stop", "noun"), ("bus shelter", "noun")], front=("shelter_back", -1))
def build_bus_shelter(root):
    """屋根つきのバス停。幅 2.6 m・奥行き 1.3 m・高さ 2.5 m。後ろ（-Z）と -X 側に板があり、中の後ろにベンチがある。

    +X 側の外にバス停の丸い標識が立つ。ベンチの座面は 0.46 m で、後ろの板にくっつけてある（背もたれは無い）。
    """
    w, d, h = 2.6, 1.3, 2.5
    p = Part("bus_shelter")
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.07, 0.07, h - 0.08), (sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), (h - 0.08) / 2), M["shelter_frame"], bevel=0.01)
    p.box((w + 0.2, d + 0.2, 0.08), (0, 0, h - 0.04), M["shelter_roof"], bevel=0.02)                     # 屋根
    p.box((w - 0.1, 0.03, 1.9), (0, d / 2 - 0.05, 0.2 + 0.95), M["shelter_back"])                        # 後ろの板
    p.box((0.03, d - 0.2, 1.9), (-(w / 2 - 0.05), 0.0, 0.2 + 0.95), M["shelter_back"])                  # 横の板
    p.box((w - 0.1, 0.05, 0.05), (0, d / 2 - 0.05, 2.1), M["shelter_frame"])
    # ベンチ（後ろの板の前）
    bench_w, bench_d, slat_t = 1.8, 0.4, 0.04
    seat_y = d / 2 - 0.08 - bench_d / 2
    for k in range(3):
        p.box((bench_w, bench_d / 3 - 0.02, slat_t), (0, seat_y - bench_d / 3 + k * bench_d / 3, SEAT_Z - slat_t / 2),
              M["shelter_bench"], bevel=0.008)
    for sx in (-1, 1):
        p.box((0.05, bench_d - 0.05, SEAT_Z - slat_t), (sx * (bench_w / 2 - 0.15), seat_y, (SEAT_Z - slat_t) / 2), M["shelter_frame"])
    # バス停の標識（丸い板と時刻表）
    px = w / 2 + 0.35
    p.cyl(0.035, 0.035, 2.2, (px, -d / 2 + 0.2, 1.1), M["shelter_frame"], segs=10)
    p.box((0.18, 0.18, 0.06), (px, -d / 2 + 0.2, 0.03), M["dark"])
    p.cyl(0.24, 0.24, 0.03, (px, -d / 2 + 0.2, 2.0), M["busstop_sign"], rot=(math.pi / 2, 0, 0), segs=20, smooth=False)
    p.cyl(0.16, 0.16, 0.036, (px, -d / 2 + 0.2, 2.0), M["sign_board"], rot=(math.pi / 2, 0, 0), segs=20, smooth=False)
    p.box((0.32, 0.04, 0.42), (px, -d / 2 + 0.2, 1.35), M["sign_board"], bevel=0.008)
    p.finish(root)
    return {"seat": (0, seat_y, SEAT_Z)}   # ベンチの座面の真ん中


# ---------- 書き出し ----------

def bake_and_center(root) -> tuple[list[float], Vector]:
    """部品の形をメッシュに焼き込み、外接箱の底面の中心が原点に来るように動かす。

    返り値は、プロトコルの座標での大きさ [幅（X）, 高さ（Y）, 奥行き（Z）] と、動かした量（Blender の座標）。
    Blender では幅が X、高さが Z、奥行きが Y。
    """
    bpy.context.view_layer.update()   # matrix_world を、finish() で付けた位置・回転・倍率に合わせる
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in objs:
        o.data.transform(o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        o.parent = root
    lo = Vector((min(v.co[i] for o in objs for v in o.data.vertices) for i in range(3)))
    hi = Vector((max(v.co[i] for o in objs for v in o.data.vertices) for i in range(3)))
    shift = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for o in objs:
        o.data.transform(Matrix.Translation(-shift))
        o.data.update()
    size = hi - lo
    return [round(size.x, 3), round(size.z, 3), round(size.y, 3)], shift


def to_protocol(anchors: dict | None, shift: Vector) -> dict | None:
    """Blender の座標の anchors を、原点を動かした分を引いてプロトコルの座標（Y が上、正面は +Z）に直す。

    Blender の (x, y, z) はプロトコルの (x, z, -y)。
    """
    if not anchors:
        return None

    def num(v: float) -> float:
        return round(v, 3) + 0.0   # -0.0 を 0.0 にする

    out = {}
    def point(v) -> list[float]:
        x, y, z = Vector(v) - shift
        return [num(x), num(z), num(-y)]

    for key, value in anchors.items():
        if key == "top":
            out[key] = num(value - shift.z)
        elif key in ("spots", "seats"):   # 名前付きの場所（コンロ・レジ、テーブルの席など）
            out[key] = {name: point(v) for name, v in value.items()}
        else:
            out[key] = point(value)
    return out


# ポーズが場面に求める部品。AI が場面を組むときの手がかりにする
POSE_USES = {"feed": ["animal_bird_a"], "lift_desk": ["table"], "cut": ["table", "cake"], "press": ["ticket_machine"],
             "kneel_build": ["sand_castle"], "poke": ["tree"], "blow": ["table", "chair", "cake", "candles"], "clap": ["chair"], "blackboard": ["wall_blackboard"], "sleep": ["table", "chair"], "take_order": ["table"], "cook": ["kitchen_counter", "pan"], "set_plates": ["table", "plate"], "put": ["table"], "wipe": ["table"],
             "pay": ["checkout_counter"], "take_book": ["bookshelf"], "write": ["table", "chair"],
             "raise_hand": ["chair"], "sit": ["chair"], "read_sit": ["chair"]}


# 離れて相手とやり取りするポーズの間合い。両方がこのポーズなら、配置はこの距離で向かい合わせる
POSE_RANGE = {"throw": "far", "catch": "far"}


def metadata(pid: str, spec: dict, size: list[float], anchors: dict | None = None) -> dict:
    meta = {"id": pid, "version": VERSION, "file": f"parts/{pid}/{VERSION}.usdz", "category": spec["category"],
            "words": spec["words"]}
    if spec["pose"]:
        meta["pose"] = spec["pose"]
    meta["size"] = size
    meta["label"] = spec["label"]
    pose = POSES.get(spec["pose"]) if spec["pose"] else None
    if pose and "props" in pose:   # 部品に含まれる持ち物。別の部品を足さなくてよい
        meta["holds"] = pose["props"][0]
    if spec["pose"] in POSE_USES:
        meta["uses"] = POSE_USES[spec["pose"]]
    if spec["pose"] in POSE_RANGE:
        meta["range"] = POSE_RANGE[spec["pose"]]
    if pose and "mirror" in pose:   # 顔を向ける側と、反対側を向く部品。配置が相手のいる側を選ぶ
        meta["gaze"] = "r" if spec["pose"].endswith("_r") else "l"
        meta["mirror"] = pid.replace(spec["pose"], pose["mirror"])
    if anchors:
        meta["anchors"] = anchors
    return meta


def write_json(path: Path, data) -> None:
    """Biome の整形と同じ形で書く（数の配列は 1 行にまとめる）。commit 時の整形で差分が出ないようにするため。"""
    text = json.dumps(data, ensure_ascii=False, indent=2)
    text = re.sub(r"\[\s+([-0-9.e]+(?:,\s+[-0-9.e]+)*)\s+\]", lambda m: "[" + ", ".join(m.group(1).replace(",", " ").split()) + "]", text)
    path.write_text(text + "\n", encoding="utf-8")


def build_part(pid: str, out: Path, meta_only: bool = False) -> dict:
    """部品を 1 つ作って書き出す。meta_only なら USDZ は書かず、JSON だけ作り直す。"""
    spec = PARTS[pid]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    Part._tmp_mesh = None   # 作り直しで消えた作業用のメッシュを参照しないようにする
    make_materials()
    root = bpy.data.objects.new(pid, None)
    bpy.context.scene.collection.objects.link(root)
    anchors = spec["build"](root)
    size, shift = bake_and_center(root)
    meta = metadata(pid, spec, size, to_protocol(anchors, shift))
    (out / pid).mkdir(parents=True, exist_ok=True)
    write_json(out / pid / f"{VERSION}.json", meta)
    if meta_only:
        print(f"wrote {out / pid / f'{VERSION}.json'} size={size} anchors={meta.get('anchors')}")
        return meta
    usdz = out / pid / f"{VERSION}.usdz"
    export_usdz(usdz)
    print(f"wrote {usdz} size={size} anchors={meta.get('anchors')} {usdz.stat().st_size / 1e6:.2f} MB")
    return meta


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="parts.py")
    ap.add_argument("--out", type=Path, default=REPO / "assets" / "parts")
    ap.add_argument("--only", action="append", choices=list(PARTS), help="この部品だけ作る（くり返して指定できる）")
    ap.add_argument("--meta-only", action="store_true", help="USDZ は書かず、メタデータの JSON と index.json だけ作り直す")
    args = ap.parse_args(argv)
    out: Path = args.out.resolve()

    for pid in args.only or PARTS:
        build_part(pid, out, meta_only=args.meta_only)
    # 一覧は、いま書き出してある各部品の JSON から作り直す（--only のときも全部品が入る）
    index = [json.loads((out / pid / f"{VERSION}.json").read_text(encoding="utf-8"))
             for pid in PARTS if (out / pid / f"{VERSION}.json").exists()]
    write_json(out / "index.json", index)
    print(f"wrote {out / 'index.json'} ({len(index)} parts)")


main()
