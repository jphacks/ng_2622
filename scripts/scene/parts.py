"""シーンを組み立てる部品（プロトコル v1）を作り、部品ごとの USDZ とメタデータの JSON を書き出す。

仕様は docs/design/scene-protocol.md の「部品」と「最初に作る部品（34 個）」。
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

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REPO, Part, _heights, export_usdz, material, materials, person  # noqa: E402

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
        "hair_black": ("#2a1f1a", 0.6), "hair_brown": ("#5a3a22", 0.6),
        "shirt_blue": ("#5a8fd6", 0.7), "pants_gray": ("#4a4f5a", 0.7), "shoe_brown": ("#6b4428", 0.5),
        "knit_rose": ("#e07a8a", 0.8), "skirt_navy": ("#2f3b63", 0.8), "shoe_white": ("#f2f2f2", 0.5),
        "shirt_yellow": ("#ffcf3a", 0.7), "shorts_blue": ("#3d6fb6", 0.7), "shoe_red": ("#e3483c", 0.5),
        "dress_pink": ("#f29bb5", 0.75),
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


# 人物の見た目。adult_a は男の人
def outfits() -> dict:
    face = {"skin": M["skin"], "eye": M["eye"], "cheek": M["cheek"], "mouth": M["mouth"]}
    return {
        "adult_a": {**face, "hair": M["hair_black"], "top": M["shirt_blue"], "bottom": M["pants_gray"], "shoe": M["shoe_brown"]},
        "woman_a": {**face, "hair": M["hair_brown"], "top": M["knit_rose"], "bottom": M["skirt_navy"], "shoe": M["shoe_white"],
                    "skirt": True, "hair_style": "long"},
        "boy_a": {**face, "hair": M["hair_black"], "top": M["shirt_yellow"], "bottom": M["shorts_blue"], "shoe": M["shoe_red"]},
        "girl_a": {**face, "hair": M["hair_brown"], "top": M["dress_pink"], "bottom": M["dress_pink"], "shoe": M["shoe_red"],
                   "skirt": True, "hair_style": "bun"},
    }


CHILD_SCALE = 0.75   # 子どもの大きさ（大人に対する倍率）
SH_STAND = 1.3       # 立つ・歩くポーズの肩の高さ（common.py の _heights）
SEAT_Z = 0.46        # 座るポーズに合う座面の高さ。chair・sofa をこの高さにする（bench は 0.48）


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

    人や物は y = 0 に置くので、板は 2 cm と薄くして足が埋まらないようにする。
    """
    rng = random.Random(2622)
    size, thick = 8.0, 0.02
    p = Part("grass_patch")
    p.slab(size, thick, thick, 0.3, M["grass"], segments=6, center=(0, 0))
    # 色の濃い芝のまだら（平たい円）
    for _ in range(40):
        x, y = rng.uniform(-3.6, 3.6), rng.uniform(-3.6, 3.6)
        r = rng.uniform(0.25, 0.6)
        p.cyl(r, r, 0.004, (x, y, thick + 0.002), rng.choice([M["grass_dark"], M["grass_light"]]), segs=14, smooth=False)
    # 草むら
    q = Part("grass_tufts")
    for _ in range(140):
        x, y = rng.uniform(-3.8, 3.8), rng.uniform(-3.8, 3.8)
        mat = rng.choice([M["grass_dark"], M["grass_dark"], M["grass_light"]])
        for _ in range(rng.randint(3, 5)):
            h = rng.uniform(0.06, 0.12)
            lean = (rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 0)
            q.cyl(0.028, 0.0, h, (x + rng.uniform(-0.05, 0.05), y + rng.uniform(-0.05, 0.05), thick + h / 2 - 0.01), mat,
                  rot=lean, segs=4, smooth=False)
    p.finish(root)
    q.finish(root)


@part("road_patch", "ground", "道路（横断歩道つき）", [("road", "noun"), ("street", "noun"), ("crosswalk", "noun")])
def build_road_patch(root):
    """駅前の道路（station.py の build_road）。片側 1 車線ずつの 2 車線で、長さ 8 m・幅 5.5 m。

    幅は日本の 2 車線の生活道路（1 車線 2.75 m）に合わせる。長い向きは X。真ん中に横断歩道がある。
    """
    length, width, thick = 8.0, 5.5, 0.02
    p = Part("road_patch")
    p.slab((length, width), thick, thick, 0.05, M["asphalt"], segments=2)
    top = thick + 0.003
    # 横断歩道（白い帯。道路を横切る向きに長い）
    for k in range(7):
        p.box((0.45, width - 1.0, 0.006), ((k - 3) * 0.9, 0, top), M["stripe"])
    # 端の白線と、横断歩道の外の中央線（破線）
    for sy in (-1, 1):
        p.box((length - 0.1, 0.12, 0.006), (0, sy * (width / 2 - 0.25), top), M["stripe"])
    for sx in (-1, 1):
        p.box((0.7, 0.12, 0.006), (sx * 3.5, 0, top), M["stripe"])
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


@part("table", "furniture", "テーブル", [("table", "noun")])
def build_table(root):
    """四角い木のテーブル。天板は 1.2 m × 0.75 m、高さ 0.72 m（椅子の座面 0.46 m に合う）。"""
    w, d, h = 1.2, 0.75, 0.72
    p = Part("table")
    p.box((w, d, 0.04), (0, 0, h - 0.02), M["table"], bevel=0.012)
    p.box((w - 0.12, d - 0.12, 0.08), (0, 0, h - 0.08), M["table_leg"], bevel=0.01)   # 天板の下の枠
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.05, 0.05, h - 0.04), (sx * (w / 2 - 0.08), sy * (d / 2 - 0.08), (h - 0.04) / 2), M["table_leg"], bevel=0.008)
    p.finish(root)
    return {"top": h}   # 天板の上面


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


def book_open(p, loc, tilt=-0.6, cover="book_red"):
    """開いた本。loc は背の位置。背から左右に開き、ページを読む人（+Y）に向ける。

    tilt は X 軸まわりの傾き。負にすると上の端が前（-Y）へ倒れ、ページが上の顔のほうを向く。
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


# ---------- 人物 ----------

NOUN = {"adult_a": "man", "woman_a": "woman", "boy_a": "boy", "girl_a": "girl"}
LABEL = {"adult_a": "男の人", "woman_a": "女の人", "boy_a": "男の子", "girl_a": "女の子"}
VERB_LABEL = {"stand": "立つ", "walk": "歩く", "run": "走る", "sit": "座る", "phone": "スマホを見る",
              "read": "本を読む", "eat": "リンゴを食べる", "carry": "箱を運ぶ"}


def person_part(pose, look, extra_words=(), front=("eye", 1)):
    """人物の部品を登録する。pose は部品の名前のポーズ（read・eat・carry も含む）。"""
    words = [(NOUN[look], "noun"), (pose, "verb")] if pose != "phone" else [(NOUN[look], "noun"), ("phone", "noun"), ("look", "verb")]
    return part(f"person_{pose}_{look}", "person", f"{LABEL[look]}（{VERB_LABEL[pose]}）",
                [*words, *extra_words], pose=pose, front=front)


def simple_person(pose, look):
    """common.py の person() のポーズをそのまま使う人物。"""
    def build(root):
        scale = CHILD_SCALE if look in ("boy_a", "girl_a") else 1.0
        person(root, "person", (0, 0), 0.0, outfits()[look], pose=pose, scale=scale)
        if pose == "sit":   # 腰の点（common.py の person() の腰の球の中心）
            return {"hip": (0, 0, _heights(pose)[0] * scale)}
        return None
    person_part(pose, look)(build)


for _pose in ("stand", "walk", "run", "sit", "phone"):
    simple_person(_pose, "adult_a")
simple_person("walk", "woman_a")
simple_person("sit", "woman_a")
simple_person("run", "boy_a")
simple_person("stand", "girl_a")


@person_part("read", "adult_a", [("book", "noun")])
def build_person_read(root):
    """立って、開いた本を胸の前で両手に持って読む人。本は同じ部品に含める。"""
    person(root, "person", (0, 0), 0.0, outfits()["adult_a"], pose="stand",
           hands=[(-0.16, -0.3, -0.22), (0.16, -0.3, -0.22)])
    p = Part("book")
    book_open(p, (0, -0.36, SH_STAND - 0.15))
    p.finish(root)


@person_part("eat", "adult_a", [("apple", "noun")])
def build_person_eat(root):
    """立って、右手（+X 側）のリンゴを口に運んで食べる人。リンゴは同じ部品に含める。"""
    person(root, "person", (0, 0), 0.0, outfits()["adult_a"], pose="stand",
           hands=[(-0.27, 0.0, -0.52), (0.07, -0.22, 0.1)])
    p = Part("apple")
    apple_shape(p, (0.03, -0.24, SH_STAND + 0.15), r=0.045)
    p.finish(root)


@person_part("carry", "adult_a", [("box", "noun")])
def build_person_carry(root):
    """歩きながら、段ボール箱を両手で前に抱えて運ぶ人。箱は同じ部品に含める。"""
    w, d, h = 0.42, 0.32, 0.3
    hand_z = -0.42   # 肩からの手の高さ（箱の横の真ん中をつかむ）
    person(root, "person", (0, 0), 0.0, outfits()["adult_a"], pose="walk",
           hands=[(-w / 2 - 0.03, -0.38, hand_z), (w / 2 + 0.03, -0.38, hand_z)])
    p = Part("box")
    box_shape(p, (w, d, h), (0, -0.4, SH_STAND + hand_z - h / 2))
    p.finish(root)


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
    for key in ("top", "seat", "hip"):
        if key not in anchors:
            continue
        if key == "top":
            out[key] = num(anchors[key] - shift.z)
        else:
            x, y, z = Vector(anchors[key]) - shift
            out[key] = [num(x), num(z), num(-y)]
    return out


def metadata(pid: str, spec: dict, size: list[float], anchors: dict | None = None) -> dict:
    meta = {"id": pid, "version": VERSION, "file": f"parts/{pid}/{VERSION}.usdz", "category": spec["category"],
            "words": spec["words"]}
    if spec["pose"]:
        meta["pose"] = spec["pose"]
    meta["size"] = size
    meta["label"] = spec["label"]
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
