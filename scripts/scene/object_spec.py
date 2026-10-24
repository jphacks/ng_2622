"""AI エージェントが決めた物の一覧の表と検査。Blender に依存しないので、サーバーからも使える。

使える物の種類・色・ポーズと、エージェントの出力を検査する validate_objects を置く。
Blender での組み立ては object_kit.py。
"""
from __future__ import annotations

import math
import re

# 使える物の種類と、必要な項目（x, y は床の中心からの位置（m）、rot は向き（ラジアン））
TYPES = ("table", "chair", "bookshelf", "blackboard", "lamp", "plant", "bench", "bin", "box", "ball", "umbrella", "book_stack", "person")
POSES = ("sit", "stand", "walk", "point", "raise_hand", "phone")
HAIR_STYLES = ("short", "bun", "long")
MAX_OBJECTS = 24
MAX_PEOPLE = 12
XY_LIMIT = 3.0

COLORS = {
    "red": "#d9534f", "blue": "#5b8fd6", "green": "#5cae6a", "yellow": "#f2c94c", "white": "#f7f7f2",
    "black": "#2a2a30", "brown": "#8a5a35", "wood": "#b07a48", "grey": "#9a9aa3", "purple": "#9a7ad9",
    "pink": "#f29bb5", "orange": "#f29a4a", "beige": "#d9c7a4", "navy": "#2f3b63", "teal": "#2f9e9a", "cream": "#fff3d9",
}
SKIN = {"light": "#f6caa6", "medium": "#d9a07a", "tan": "#c68a5e", "dark": "#8d5a3b"}
HAIR = {"black": "#2a1f1a", "brown": "#5a3a22", "gold": "#c9a25b", "grey": "#9a9aa0", "red": "#8a3a22"}
SHOES = {"brown": "#6b4428", "white": "#f2f2f2", "black": "#25252a"}
BOOK_COLORS = ("red", "blue", "green", "yellow", "purple", "teal", "cream", "brown", "navy")


def _num(value, default: float, lo: float, hi: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(v):
        return default
    return max(lo, min(hi, v))


def _color(name, default: str = "grey") -> str:
    return name if name in COLORS else default


def validate_objects(raw) -> tuple[list[dict], list[str]]:
    """エージェントの物の一覧を検査する。直せるものは直し、直せないものはエラーにする。

    返り値は（使える物の一覧, エラーの文）。使える物が 0 件のときは再度依頼する判断に使う。
    """
    errors: list[str] = []
    if not isinstance(raw, list):
        return [], ["objects must be a list"]
    clean: list[dict] = []
    people = 0
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            errors.append(f"objects[{i}] is not an object")
            continue
        kind = item.get("type")
        if kind not in TYPES:
            errors.append(f"objects[{i}] has unknown type {kind!r}; use one of {', '.join(TYPES)}")
            continue
        if not isinstance(item.get("x"), (int, float)) or not isinstance(item.get("y"), (int, float)):
            errors.append(f"objects[{i}] needs numeric x and y")
            continue
        if kind == "person":
            if item.get("pose", "stand") not in POSES:
                errors.append(f"objects[{i}] has unknown pose {item.get('pose')!r}; use one of {', '.join(POSES)}")
                continue
            people += 1
            if people > MAX_PEOPLE:
                continue
        obj = {
            "type": kind,
            "x": _num(item["x"], 0.0, -XY_LIMIT, XY_LIMIT),
            "y": _num(item["y"], 0.0, -XY_LIMIT, XY_LIMIT),
            "rot": _num(item.get("rot", 0.0), 0.0, -math.pi, math.pi),
            "color": _color(item.get("color"), "grey"),
            "w": _num(item.get("w"), 2.4 if kind == "blackboard" else 1.0, 0.2, 2.6),
            "d": _num(item.get("d"), 0.6, 0.2, 2.0),
            "h": _num(item.get("h"), 1.2 if kind == "blackboard" else 1.0, 0.2, 2.6),
        }
        if kind == "person":
            obj["pose"] = item.get("pose", "stand")
            obj["outfit"] = item.get("outfit") if isinstance(item.get("outfit"), dict) else {}
        clean.append(obj)
        if len(clean) >= MAX_OBJECTS:
            break
    return clean, errors


def arrange_people(objects: list[dict]) -> None:
    """座っている人を近くのテーブルの方へ向け、椅子が無ければ同じ場所に椅子を足す。

    AI は向きを間違えやすいので、テーブルとの位置関係からここで直す。
    """
    tables = [o for o in objects if o["type"] == "table"]
    if not tables:
        return
    chairs = [o for o in objects if o["type"] == "chair"]
    for o in objects:
        if o["type"] != "person" or o.get("pose") != "sit":
            continue
        table = min(tables, key=lambda t: math.hypot(t["x"] - o["x"], t["y"] - o["y"]))
        if math.hypot(table["x"] - o["x"], table["y"] - o["y"]) > 1.6:
            continue
        o["rot"] = math.atan2(table["x"] - o["x"], -(table["y"] - o["y"]))
        if not any(math.hypot(c["x"] - o["x"], c["y"] - o["y"]) < 0.3 for c in chairs):
            chair = {"type": "chair", "x": o["x"], "y": o["y"], "rot": o["rot"], "color": "wood",
                     "w": 1.0, "d": 0.6, "h": 1.0}
            chairs.append(chair)
            objects.append(chair)


# 閲覧テーブルの置き場所（床の上の決まった場所）と、テーブルを囲む 4 つの席（テーブル中心からの相対位置）
TABLE_SPOTS = [(-1.5, 0.4), (1.0, 0.4), (-0.25, -2.4), (-1.5, -2.4), (1.0, -2.4)]
SEAT_OFFSETS = [(-0.4, -0.75), (0.4, -0.75), (-0.4, 0.75), (0.4, 0.75)]
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
DEFAULT_OUTFITS = [
    {"skin": "light", "hair": "brown", "hair_style": "long", "top": "blue", "bottom": "navy", "shoe": "white"},
    {"skin": "medium", "hair": "black", "hair_style": "bun", "top": "yellow", "bottom": "beige", "shoe": "brown"},
    {"skin": "tan", "hair": "black", "hair_style": "long", "top": "green", "bottom": "black", "shoe": "black", "skirt": True},
    {"skin": "dark", "hair": "grey", "hair_style": "short", "top": "white", "bottom": "black", "shoe": "white"},
]


def _count(low: str, pattern: str) -> int | None:
    """「3 tables」「four people」のような数の言い方を探す。見つからなければ None。"""
    m = re.search(rf"\b(\d+|{'|'.join(NUMBER_WORDS)})\s+(?:\w+\s+){{0,2}}{pattern}\b", low)
    if not m:
        return None
    word = m.group(1)
    return int(word) if word.isdigit() else NUMBER_WORDS[word]


def arrange_groups(objects: list[dict], prompt: str) -> list[dict]:
    """「テーブルが N 個、1 テーブルに M 人」という説明なら、テーブルと席を決まった場所に置き直す。

    AI は人数やテーブルの数を外しやすいので、数と場所はここで決める。
    家具（本棚・カウンターなど）と服装は AI の案をそのまま使う。
    """
    low = prompt.lower()
    if "table" not in low:
        return objects
    # 「no people」のように人を否定しているときは、席に人を置かない
    people_negated = _mentions(low, PERSON_WORDS) and not _mentions(_negate(low, PERSON_WORDS), PERSON_WORDS)
    if people_negated:
        return objects
    tables_n = min(len(TABLE_SPOTS), _count(low, r"tables?") or 1)
    per_table = min(len(SEAT_OFFSETS), _count(low, r"(?:people|persons|students|readers|friends|kids|children)") or 4)

    seated = [o for o in objects if o["type"] == "person" and o.get("pose") == "sit"]
    out = [o for o in objects if o["type"] not in ("table", "chair") and o not in seated]
    k = 0
    for ti in range(tables_n):
        tx, ty = TABLE_SPOTS[ti]
        out.append({"type": "table", "x": tx, "y": ty, "rot": 0.0, "color": "wood", "w": 1.5, "d": 0.8, "h": 1.0})
        for sx, sy in SEAT_OFFSETS[:per_table]:
            outfit = seated[k]["outfit"] if k < len(seated) and seated[k].get("outfit") else DEFAULT_OUTFITS[k % len(DEFAULT_OUTFITS)]
            out.append({"type": "person", "x": tx + sx, "y": ty + sy, "rot": 0.0, "color": "grey",
                        "w": 1.0, "d": 0.6, "h": 1.0, "pose": "sit", "outfit": dict(outfit)})
            k += 1
    arrange_people(out)
    return out


BIOMES = ("park", "beach", "indoor", "city", "snow", "autumn", "desert")

PERSON_WORDS = ("person", "people", "man", "men", "woman", "women", "girl", "boy", "child", "children", "kid", "kids",
                "student", "students", "cashier", "customer", "customers", "librarian", "reader", "readers", "worker",
                "staff", "guest", "guests", "shopper", "shoppers", "teacher", "friend", "friends", "family")
# 物の種類ごとに、説明文に出てきたら使ってよい言葉
KEYWORDS = {
    "table": ("table", "desk", "counter", "tables"),
    "chair": ("chair", "seat", "stool", "sit", "sitting"),
    "bookshelf": ("bookshelf", "bookcase", "shelf", "shelves", "shelving", "book"),
    "blackboard": ("blackboard", "chalkboard", "whiteboard"),
    "lamp": ("lamp", "light", "lantern"),
    "plant": ("plant", "flower", "tree", "bush", "pot"),
    "bench": ("bench",),
    "bin": ("bin", "trash", "garbage"),
    "box": ("box", "crate", "carton", "basket", "bag", "boxes"),
    "ball": ("ball", "balloon"),
    "umbrella": ("umbrella", "parasol", "beach"),
    "book_stack": ("book", "books", "stack", "pile"),
    "person": PERSON_WORDS,
}


def agent_schema() -> dict:
    """Ollama に渡す出力の形（JSON スキーマ）。種類・ポーズ・色は表にあるものだけを許す。"""
    outfit = {
        "type": "object",
        "properties": {
            "skin": {"type": "string", "enum": list(SKIN)},
            "hair": {"type": "string", "enum": list(HAIR)},
            "hair_style": {"type": "string", "enum": list(HAIR_STYLES)},
            "skirt": {"type": "boolean"},
            "top": {"type": "string", "enum": list(COLORS)},
            "bottom": {"type": "string", "enum": list(COLORS)},
            "shoe": {"type": "string", "enum": list(SHOES)},
        },
    }
    item = {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": list(TYPES)},
            "x": {"type": "number"},
            "y": {"type": "number"},
            "rot": {"type": "number"},
            "color": {"type": "string", "enum": list(COLORS)},
            "w": {"type": "number"},
            "d": {"type": "number"},
            "h": {"type": "number"},
            "pose": {"type": "string", "enum": list(POSES)},
            "outfit": outfit,
        },
        "required": ["type", "x", "y"],
    }
    return {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "biome": {"type": "string", "enum": list(BIOMES)},
            "elements": {"type": "array", "items": {"type": "string"}},
            "objects": {"type": "array", "items": item, "maxItems": MAX_OBJECTS},
        },
        "required": ["name", "biome", "objects"],
    }


def _negate(low: str, words: tuple[str, ...]) -> str:
    """「no people」「without a bookshelf」のような否定の言い方を消す。"""
    for w in words:
        low = re.sub(rf"\b(?:no|without|zero|nobody|none of)\s+(?:(?:any|other|more)\s+)?(?:\w+\s+)?{re.escape(w)}s?\b", " ", low)
    return low


def _mentions(low: str, words: tuple[str, ...]) -> bool:
    return any(re.search(rf"\b{re.escape(w)}s?\b", low) for w in words)


def filter_by_prompt(objects: list[dict], prompt: str) -> list[dict]:
    """説明文に書かれていない種類の物を外す。椅子は説明に座る人か椅子があるときだけ残す。

    日本語だけの説明は英単語で判定できないので、そのまま通す。
    """
    low = prompt.lower()
    if not re.search(r"[a-z]", low):
        return objects
    # 否定された語（「no people」など）は、その種類を使う理由にしない
    wanted = {kind for kind, words in KEYWORDS.items() if _mentions(_negate(low, words), words)}
    seated = any(o["type"] == "person" and o.get("pose") == "sit" for o in objects)
    if seated:
        wanted.add("chair")
    return [o for o in objects if o["type"] in wanted]
