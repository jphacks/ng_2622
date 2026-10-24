"""AI エージェントが決めた物の一覧（JSON）を、決まった部品から 3D にする。

物の種類・色は object_spec.py の表を使う。ここでは Blender の部品で組み立てる。
"""
from __future__ import annotations

import random

from common import Part, material, person
from object_spec import BOOK_COLORS, COLORS, HAIR, HAIR_STYLES, SHOES, SKIN, _color


def _mat(color: str, rough: float = 0.6):
    hex_color = COLORS.get(color, COLORS["grey"])
    return material(f"kit_{color}_{rough}", hex_color, rough)


def _outfit(raw: dict) -> dict:
    """人物の服装。知らない名前は既定の色にする。"""
    skin = SKIN.get(raw.get("skin"), SKIN["light"])
    hair = HAIR.get(raw.get("hair"), HAIR["black"])
    style = raw.get("hair_style") if raw.get("hair_style") in HAIR_STYLES else "short"
    shoe = SHOES.get(raw.get("shoe"), SHOES["brown"])
    return {
        "skin": material(f"kit_skin_{raw.get('skin', 'light')}", skin, 0.55),
        "hair": material(f"kit_hair_{raw.get('hair', 'black')}", hair, 0.6),
        "top": _mat(_color(raw.get("top"), "blue"), 0.8),
        "bottom": _mat(_color(raw.get("bottom"), "navy"), 0.7),
        "shoe": material(f"kit_shoe_{raw.get('shoe', 'brown')}", shoe, 0.5),
        "eye": material("kit_eye", "#2a211c", 0.3),
        "skirt": bool(raw.get("skirt", False)),
        "hair_style": style,
    }


# ---------- 部品 ----------

def _table(root, o) -> None:
    w, d = o["w"], o["d"]
    p = Part(f"table_{o['x']:.2f}_{o['y']:.2f}")
    p.box((w, d, 0.04), (0, 0, 0.74), _mat(o["color"] if o["color"] != "grey" else "wood"), bevel=0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.03, 0.03, 0.72, (sx * (w / 2 - 0.1), sy * (d / 2 - 0.1), 0.36), _mat("black", 0.5), segs=10)
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _chair(root, o) -> None:
    p = Part(f"chair_{o['x']:.2f}_{o['y']:.2f}")
    wood = _mat(o["color"] if o["color"] != "grey" else "wood")
    p.box((0.46, 0.44, 0.05), (0, 0, 0.44), wood, bevel=0.012)
    p.box((0.46, 0.05, 0.44), (0, 0.22, 0.7), wood, bevel=0.012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.cyl(0.018, 0.018, 0.42, (sx * 0.2, sy * 0.18, 0.21), _mat("black", 0.5), segs=8)
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _bookshelf(root, o) -> None:
    w, d, h = o["w"], 0.36, max(1.6, o["h"] * 2)
    rng = random.Random(int(o["x"] * 100 + o["y"] * 7))
    wood = _mat("wood", 0.6)
    p = Part(f"bookshelf_{o['x']:.2f}_{o['y']:.2f}")
    levels = 5
    for i in range(levels):
        p.box((w, d, 0.04), (0, 0, 0.04 + i * (h - 0.04) / (levels - 1)), wood)
    for sx in (-1, 1):
        p.box((0.04, d, h), (sx * (w / 2 - 0.02), 0, h / 2), wood)
    for i in range(levels - 1):
        z0 = 0.08 + i * (h - 0.04) / (levels - 1)
        x = -w / 2 + 0.06
        while x < w / 2 - 0.12:
            t = rng.uniform(0.025, 0.045)
            bh = rng.uniform(0.22, 0.32)
            p.box((t, d - 0.1, bh), (x + t / 2, -0.02, z0 + bh / 2), _mat(rng.choice(BOOK_COLORS), 0.6), bevel=0.004)
            x += t + 0.008
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _blackboard(root, o) -> None:
    """黒板（脚つき）。黒い板に木の枠。正面は -Y。"""
    w, h = o["w"], o["h"] + 1.0
    p = Part(f"blackboard_{o['x']:.2f}_{o['y']:.2f}")
    p.box((w + 0.08, 0.05, h + 0.08), (0, 0, 1.0 + h / 2), _mat("wood", 0.6), bevel=0.02)
    p.box((w, 0.06, h), (0, -0.01, 1.0 + h / 2), _mat("black", 0.8), bevel=0.01)
    for sx in (-1, 1):
        p.box((0.05, 0.4, 1.0), (sx * (w / 2 - 0.2), 0, 0.5), _mat("black", 0.5))
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _lamp(root, o) -> None:
    p = Part(f"lamp_{o['x']:.2f}_{o['y']:.2f}")
    p.cyl(0.18, 0.18, 0.03, (0, 0, 0.015), _mat("black", 0.4), segs=18)
    p.cyl(0.012, 0.012, 1.4, (0, 0, 0.7), _mat("black", 0.4), segs=6)
    p.cyl(0.14, 0.2, 0.28, (0, 0, 1.5), _mat("cream", 0.8), segs=20)
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _plant(root, o) -> None:
    p = Part(f"plant_{o['x']:.2f}_{o['y']:.2f}")
    p.cyl(0.22, 0.17, 0.38, (0, 0, 0.19), _mat("orange", 0.7), segs=16)
    p.blob(0.3, (0, 0, 0.72), _mat("green", 0.7), bumpy=0.2, subdiv=3, seed=o["x"] + o["y"])
    p.blob(0.2, (0.15, 0.05, 0.9), _mat("green", 0.7), bumpy=0.2, subdiv=3, seed=o["y"])
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _bench(root, o) -> None:
    p = Part(f"bench_{o['x']:.2f}_{o['y']:.2f}")
    wood = _mat("wood", 0.6)
    p.box((1.5, 0.45, 0.06), (0, 0, 0.45), wood, bevel=0.01)
    p.box((1.5, 0.08, 0.4), (0, -0.2, 0.7), wood, bevel=0.01)
    for sx in (-1, 1):
        p.box((0.06, 0.4, 0.45), (sx * 0.65, 0, 0.22), _mat("black", 0.5))
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _bin(root, o) -> None:
    p = Part(f"bin_{o['x']:.2f}_{o['y']:.2f}")
    p.cyl(0.2, 0.17, 0.45, (0, 0, 0.225), _mat(o["color"], 0.5), segs=20)
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _box(root, o) -> None:
    p = Part(f"box_{o['x']:.2f}_{o['y']:.2f}")
    p.box((o["w"], o["d"], o["h"] * 0.5), (0, 0, o["h"] * 0.25), _mat(o["color"]), bevel=0.02)
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _ball(root, o) -> None:
    p = Part(f"ball_{o['x']:.2f}_{o['y']:.2f}")
    r = min(o["w"], o["d"], 0.5) * 0.5
    p.sphere(r, (0, 0, r), _mat(o["color"], 0.4), segs=20)
    p.finish(root, loc=(o["x"], o["y"], 0))


def _umbrella(root, o) -> None:
    p = Part(f"umbrella_{o['x']:.2f}_{o['y']:.2f}")
    p.cyl(0.03, 0.03, 2.2, (0, 0, 1.1), _mat("white", 0.5), segs=8)
    p.cyl(1.2, 0.05, 0.4, (0, 0, 2.1), _mat(o["color"], 0.6), segs=16)
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _book_stack(root, o) -> None:
    rng = random.Random(int(o["x"] * 31 + o["y"] * 17))
    p = Part(f"books_{o['x']:.2f}_{o['y']:.2f}")
    z = 0.0
    for _ in range(3):
        t = rng.uniform(0.025, 0.04)
        p.box((0.24, 0.18, t), (0, 0, z + t / 2), _mat(rng.choice(BOOK_COLORS), 0.6), rot=(0, 0, rng.uniform(-0.2, 0.2)))
        z += t
    p.finish(root, loc=(o["x"], o["y"], 0), rot_z=o["rot"])


def _person(root, o) -> None:
    person(root, f"person_{o['x']:.2f}_{o['y']:.2f}", (o["x"], o["y"]), o["rot"], _outfit(o["outfit"]), pose=o["pose"])


BUILDERS = {
    "table": _table, "chair": _chair, "bookshelf": _bookshelf, "lamp": _lamp, "plant": _plant,
    "bench": _bench, "bin": _bin, "box": _box, "ball": _ball, "umbrella": _umbrella,
    "book_stack": _book_stack, "person": _person, "blackboard": _blackboard,
}


def build_objects(root, objects: list[dict]) -> None:
    """検査済みの物の一覧を順に置く。ひとつの物が失敗しても、ほかの物は置く。"""
    for o in objects:
        try:
            BUILDERS[o["type"]](root, o)
        except Exception as exc:  # noqa: BLE001 - 1 つの失敗で全体を止めない
            print(f"[object_kit] skipped {o.get('type')} ({exc})")
