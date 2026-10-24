#!/usr/bin/env python3
"""ホストが話した 1 文（プロンプト）から Blender で 3D シーン（.usdz）と採点用 JSON を動的生成するエージェント＆サーバー。

使い方:
  1) 単発で 1 文から生成する（CLI）:
     python3 scripts/scene/ai_generator.py --prompt "A sandy beach with palm trees, a red surfboard, and a crab"

  2) iOS アプリから呼べる HTTP サーバーとして起動する（既定: http://localhost:8790）:
     python3 scripts/scene/ai_generator.py --serve --port 8790

AI バックエンドの優先順位:
  1. 環境変数または .env / backend/.dev.vars の ANTHROPIC_API_KEY で Claude API を使用
  2. ローカルの Ollama (http://127.0.0.1:11434、既定モデル qwen2.5-coder:7b。無料) を使用
  3. ローカルの Claude Code CLI (`~/.local/bin/claude -p`) を使用
  4. キー無し・オフラインでも即座（約 2 秒）に動く高ディテール自然言語シーン合成エンジン
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from object_spec import (  # noqa: E402
    BIOMES, COLORS, agent_schema, arrange_groups, filter_by_prompt, validate_objects,
)

REPO = Path(__file__).resolve().parents[2]
SCENE_SCRIPTS_DIR = REPO / "scripts" / "scene"
OUT_DIR = REPO / "assets" / "scenes" / "generated"

WORD_NUMS = {
    "a": 1, "an": 1, "one": 1, "single": 1,
    "two": 2, "couple": 2, "pair": 2,
    "three": 3, "few": 3, "several": 3,
    "four": 4, "five": 5, "six": 6, "many": 5, "lots": 6,
}


def find_blender() -> str:
    """Mac / Linux / Windows の Blender 実行ファイルを探す。"""
    env_bin = os.environ.get("BLENDER_BIN")
    if env_bin and Path(env_bin).exists():
        return env_bin
    which_bin = shutil.which("blender")
    if which_bin:
        return which_bin
    mac_bin = Path("/Applications/Blender.app/Contents/MacOS/Blender")
    if mac_bin.exists():
        return str(mac_bin)
    raise FileNotFoundError(
        "Blender が見つかりません。/Applications/Blender.app を入れるか BLENDER_BIN を指定してください。"
    )


def find_claude_cli() -> str | None:
    """ローカルの Claude Code CLI を探す。"""
    if os.environ.get("DISABLE_CLAUDE_CLI") == "1":
        return None
    for candidate in (
        os.environ.get("CLAUDE_BIN"),
        shutil.which("claude"),
        str(Path.home() / ".local" / "bin" / "claude"),
    ):
        if candidate and Path(candidate).exists():
            return str(candidate)
    return None


def count_in_prompt(low: str, keywords: tuple[str, ...], default_if_present: int = 1) -> int:
    """プロンプト内のキーワードと直前の数詞（例: 'three dogs', '2 cars'）から個数を返す。"""
    for kw in keywords:
        pattern = rf"\b(\d+|one|two|three|four|five|six|few|several|many|couple|pair|a|an)\s+(?:[a-z]+\s+)?{re.escape(kw)}s?\b"
        m = re.search(pattern, low)
        if m:
            tok = m.group(1)
            if tok.isdigit():
                return max(1, min(8, int(tok)))
            return WORD_NUMS.get(tok, default_if_present)
        if re.search(rf"\b{re.escape(kw)}s?\b", low):
            if re.search(rf"\b{re.escape(kw)}s\b", low) and not kw.endswith("s"):
                return max(2, default_if_present)
            return default_if_present
    return 0


def parse_prompt_to_scene_spec(prompt: str) -> dict:
    """プロンプトの自然言語からバイオーム（場所・季節・時間帯）と登場オブジェクトの種類・個数を抽出する。"""
    low = prompt.lower()

    if any(w in low for w in ("beach", "ocean", "sea", "island", "coast", "surf", "tropical", "海", "ビーチ", "砂浜")):
        biome = "beach"
    elif any(w in low for w in ("classroom", "school", "room", "kitchen", "office", "indoor", "study", "cafe", "coffee", "shop", "教室", "部屋", "室内", "台所", "カフェ")):
        biome = "indoor"
    elif any(w in low for w in ("city", "street", "station", "road", "town", "crosswalk", "downtown", "駅", "街", "道路", "都会")):
        biome = "city"
    elif any(w in low for w in ("desert", "cactus", "dune", "sand", "砂漠")):
        biome = "desert"
    elif any(w in low for w in ("snow", "snowy", "winter", "ice", "freezing", "雪", "冬")):
        biome = "snow"
    elif any(w in low for w in ("autumn", "fall", "maple", "秋", "紅葉")):
        biome = "autumn"
    else:
        biome = "park"

    is_night = any(w in low for w in ("night", "evening", "dark", "midnight", "夜"))

    cherry_count = count_in_prompt(low, ("cherry", "blossom", "sakura", "桜"))
    pine_count = count_in_prompt(low, ("pine", "fir", "christmas tree", "松", "針葉樹"))
    palm_count = count_in_prompt(low, ("palm", "coconut", "ヤシ"))
    low_without_specific_trees = re.sub(
        r"\b(cherry(\s+blossom)?|blossom|sakura|pine|fir|christmas|palm|coconut)\s+trees?\b",
        "",
        low,
    )

    spec = {
        "biome": biome,
        "is_night": is_night,
        "trees": count_in_prompt(low_without_specific_trees, ("tree", "woods", "forest", "木")),
        "cherry_trees": cherry_count,
        "pine_trees": pine_count,
        "palm_trees": palm_count,
        "cacti": count_in_prompt(low, ("cactus", "cacti", "サボテン")),
        "pond": count_in_prompt(low, ("pond", "lake", "puddle", "fountain", "池", "泉")),
        "bench": count_in_prompt(low, ("bench", "seat", "ベンチ")),
        "lamp": count_in_prompt(low, ("lamp", "light", "streetlight", "lantern", "街灯", "ライト")),
        "dog": count_in_prompt(low, ("dog", "puppy", "shiba", "hound", "犬")),
        "cat": count_in_prompt(low, ("cat", "kitten", "kitty", "猫")),
        "snowman": count_in_prompt(low, ("snowman", "snowmen", "雪だるま")),
        "ball": count_in_prompt(low, ("ball", "soccer", "football", "basketball", "ボール")),
        "car": count_in_prompt(low, ("car", "taxi", "cab", "sedan", "vehicle", "車", "タクシー")),
        "bus": count_in_prompt(low, ("bus", "train", "truck", "van", "バス", "電車", "トラック")),
        "house": count_in_prompt(low, ("house", "building", "shop", "store", "cabin", "home", "家", "建物", "店")),
        "vending": count_in_prompt(low, ("vending", "machine", "自販機", "自動販売機")),
        "desk": count_in_prompt(low, ("desk", "table", "counter", "机", "テーブル")),
        "blackboard": count_in_prompt(low, ("blackboard", "chalkboard", "whiteboard", "黒板")),
        "umbrella": count_in_prompt(low, ("umbrella", "parasol", "パラソル", "傘")),
        "surfboard": count_in_prompt(low, ("surfboard", "サーフボード")),
        "boat": count_in_prompt(low, ("boat", "ship", "yacht", "canoe", "船", "ボート")),
        "flowers": count_in_prompt(low, ("flower", "rose", "tulip", "garden", "花")),
        "rocks": count_in_prompt(low, ("rock", "stone", "boulder", "岩", "石")),
        "fence": count_in_prompt(low, ("fence", "wall", "gate", "柵", "フェンス")),
        "people": count_in_prompt(
            low,
            ("person", "people", "boy", "girl", "man", "woman", "child", "children", "kid", "student", "teacher", "人", "男", "女", "子供", "先生", "生徒"),
        ),
    }

    total_props = sum(
        v for k, v in spec.items() if k not in ("biome", "is_night") and isinstance(v, int)
    )
    if biome == "beach":
        if spec["palm_trees"] == 0 and spec["trees"] == 0:
            spec["palm_trees"] = 2
        if total_props == 0:
            spec["umbrella"] = 1
            spec["surfboard"] = 1
            spec["boat"] = 1
            spec["people"] = 1
    elif biome == "indoor":
        if spec["desk"] == 0:
            spec["desk"] = 3
        if spec["blackboard"] == 0:
            spec["blackboard"] = 1
        if spec["people"] == 0 and total_props == 0:
            spec["people"] = 2
    elif biome == "city":
        if spec["house"] == 0:
            spec["house"] = 2
        if spec["lamp"] == 0:
            spec["lamp"] = 2
        if total_props == 0:
            spec["car"] = 1
            spec["vending"] = 1
            spec["people"] = 2
    elif biome == "snow":
        if spec["pine_trees"] == 0 and spec["trees"] == 0:
            spec["pine_trees"] = 3
        if total_props == 0:
            spec["snowman"] = 1
            spec["house"] = 1
    elif biome == "desert":
        if spec["cacti"] == 0:
            spec["cacti"] = 4
        if spec["rocks"] == 0:
            spec["rocks"] = 3
    else:
        if total_props == 0:
            spec["trees"] = 2
            spec["cherry_trees"] = 1
            spec["pond"] = 1
            spec["bench"] = 1
            spec["lamp"] = 1
            spec["dog"] = 1
            spec["people"] = 1
        else:
            # 公園・秋でも花や岩・ベンチ・街灯を少し補完して華やかにする
            if spec["flowers"] == 0:
                spec["flowers"] = 3
            if spec["rocks"] == 0:
                spec["rocks"] = 2

    return spec


def load_anthropic_api_key() -> str | None:
    """環境変数または .env / backend/.dev.vars から ANTHROPIC_API_KEY を読む。"""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"].strip()
    for env_path in (REPO / ".env", REPO / "backend" / ".dev.vars", REPO / "backend" / ".env"):
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("ANTHROPIC_API_KEY="):
                    val = line.split("=", 1)[1].strip().strip("'\"")
                    if val:
                        return val
    return None


AGENT_TRIES = 3
BIOME_NAMES = BIOMES


def _build_agent_prompt(prompt: str, base_spec: dict, errors: list[str] | None = None) -> str:
    """Claude / Ollama に渡すプロンプト。Blender のコードは書かせず、決まった物の一覧で返してもらう。"""
    text = (
        "You arrange a small 3D diorama for a speaking game. Return ONLY one JSON object. No prose, no code.\n"
        f"Scene description from the host: {prompt!r}\n"
        "The diorama is 8 m by 8 m. The floor is at z=0. x and y are metres from the centre, in [-3.0, 3.0]. "
        "Negative y is the front (toward the viewer), positive y is the back.\n"
        f"biome must be one of: {', '.join(BIOME_NAMES)}.\n"
        "List 6 to 20 objects that match the description. Use only these object types:\n"
        "- table: w, d (metres), color\n"
        "- chair: rot, color\n"
        "- bookshelf: w, color\n"
        "- blackboard: w, h (metres), a board on legs\n"
        "- lamp, plant, bench, bin, box (w, d, h, color), ball (w, color), umbrella (color), book_stack\n"
        "- person: pose (sit, stand, walk, point, raise_hand, phone), outfit "
        "{skin: light|medium|tan|dark, hair: black|brown|gold|grey|red, hair_style: short|bun|long, "
        "skirt: true|false, top: <color>, bottom: <color>, shoe: brown|white|black}\n"
        "Use only objects that the description names. Do not add anything extra. "
        "If the description says there are no people, use no person objects at all.\n"
        "If the description has tables with people, the tables and seats are placed for you: "
        "choose the other objects and the outfits only.\n"
        f"Colors: {', '.join(COLORS)}.\n"
        "Output format:\n"
        '{"name": "short title", "biome": "indoor", "elements": ["4 to 8 short English phrases"], '
        '"objects": [{"type": "table", "x": 0, "y": 0, "w": 1.5, "d": 0.8, "color": "wood"}, '
        '{"type": "person", "x": -0.4, "y": -0.75, "pose": "sit", "outfit": {"skin": "medium", "hair": "black", '
        '"hair_style": "bun", "top": "blue", "bottom": "navy", "shoe": "brown"}}]}'
    )
    if errors:
        text += "\nYour previous answer had these problems. Fix them: " + "; ".join(errors[:6])
    return text


def _extract_json(text: str) -> dict | None:
    """応答から JSON のオブジェクトを取り出す（```json のかこみも外す）。"""
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        parsed = json.loads(m.group(0))
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _check_agent(text: str, base_spec: dict, prompt: str) -> tuple[dict | None, list[str]]:
    """応答を検査する。使える物が無ければ (None, 問題の一覧) を返し、再依頼に使う。"""
    parsed = _extract_json(text)
    if parsed is None:
        return None, ["the answer was not one JSON object"]
    objects, errors = validate_objects(parsed.get("objects"))
    if not objects:
        return None, errors or ["the objects list is empty"]
    objects = filter_by_prompt(objects, prompt)
    if not objects:
        return None, ["no object in the answer is named in the description"]
    objects = arrange_groups(objects, prompt)
    spec = dict(base_spec)
    if parsed.get("biome") in BIOME_NAMES:
        spec["biome"] = parsed["biome"]
    name = parsed.get("name")
    raw_elements = parsed.get("elements")
    elements = [str(e) for e in raw_elements if str(e).strip()] if isinstance(raw_elements, list) else []
    return {
        "name": str(name) if name else None,
        "spec": spec,
        "elements": elements or None,
        "objects": objects,
    }, errors


def _run_agent(prompt: str, base_spec: dict, ask, label: str) -> dict | None:
    """AI に頼み、検査に通るまで最大 AGENT_TRIES 回まで直させる。
    ask が None を返したとき（残高不足・サーバーが無いなど）は、やり直さずに諦める。"""
    problems: list[str] | None = None
    for attempt in range(1, AGENT_TRIES + 1):
        text = ask(_build_agent_prompt(prompt, base_spec, problems))
        if text is None:
            return None
        result, problems = _check_agent(text, base_spec, prompt)
        if result:
            print(f"[ai_generator] {label}: {len(result['objects'])} objects (attempt {attempt})", file=sys.stderr)
            return result
        print(f"[ai_generator] {label} attempt {attempt} invalid: {problems[:3]}", file=sys.stderr)
    return None


def objects_source(objects: list[dict]) -> str:
    """生成スクリプトに入れる、物の一覧と組み立ての呼び出し。"""
    return "OBJECTS = " + repr(objects) + "\n\n\ndef build_custom(root):\n    build_objects(root, OBJECTS)\n"


def _ask_claude_api(text: str, api_key: str) -> str | None:
    model = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5")
    body = {"model": model, "max_tokens": 2048, "messages": [{"role": "user", "content": text}]}
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return json.loads(resp.read().decode("utf-8"))["content"][0]["text"]
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore") if hasattr(exc, "read") else ""
        print(f"[ai_generator] Anthropic API HTTP {exc.code}: {err_body[:180]}", file=sys.stderr)
    except Exception as exc:
        print(f"[ai_generator] Anthropic API error ({exc})", file=sys.stderr)
    return None


def _ask_ollama(text: str) -> str | None:
    model = os.environ.get("OLLAMA_MODEL", "qwen2.5-coder:7b")
    # 形は JSON スキーマで縛り、同じ説明からは毎回同じ答えが出るように温度 0 と seed を固定する
    body = {"model": model, "prompt": text, "format": agent_schema(), "stream": False,
            "options": {"temperature": 0, "seed": 7, "num_predict": 3000}}
    req = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode("utf-8"))["response"]
    except Exception as exc:
        print(f"[ai_generator] Ollama fallback ({exc})", file=sys.stderr)
        return None


def _ask_claude_cli(text: str, claude_bin: str) -> str | None:
    # ANTHROPIC_API_KEY が残高不足のとき claude CLI がそちらを使って失敗するのを防ぐため環境変数から外す
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    try:
        proc = subprocess.run(
            [claude_bin, "-p", text, "--model", os.environ.get("CLAUDE_CLI_MODEL", "haiku")],
            env=env, cwd=str(REPO), stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=35, check=False,
        )
    except Exception as exc:
        print(f"[ai_generator] Claude CLI fallback ({exc})", file=sys.stderr)
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        print(f"[ai_generator] Claude CLI rc={proc.returncode}: {proc.stderr[:180]}", file=sys.stderr)
        return None
    return proc.stdout


def call_claude_agent(prompt: str, base_spec: dict, api_key: str | None) -> dict | None:
    if not api_key:
        return None
    return _run_agent(prompt, base_spec, lambda t: _ask_claude_api(t, api_key), "Claude API")


def call_ollama_agent(prompt: str, base_spec: dict) -> dict | None:
    """ローカルの Ollama（無料・オフライン）。DISABLE_OLLAMA=1 で止められる。"""
    if os.environ.get("DISABLE_OLLAMA") == "1":
        return None
    return _run_agent(prompt, base_spec, _ask_ollama, "Ollama")


def call_claude_cli(prompt: str, base_spec: dict) -> dict | None:
    claude_bin = find_claude_cli()
    if not claude_bin:
        return None
    return _run_agent(prompt, base_spec, lambda t: _ask_claude_cli(t, claude_bin), "Claude CLI")


def build_procedural_scene(prompt: str, scene_id: str) -> dict:
    """プロンプトから抽出した Scene Spec＋Claude エージェントのカスタム 3D 部品で、高ディテールな Blender スクリプトを生成する。"""
    spec = parse_prompt_to_scene_spec(prompt)
    custom_python = "def build_custom(root):\n    pass\n"
    custom_name: str | None = None
    custom_elements: list[str] | None = None

    api_key = load_anthropic_api_key()
    agent_result = (
        call_claude_agent(prompt, spec, api_key)
        or call_ollama_agent(prompt, spec)
        or call_claude_cli(prompt, spec)
    )
    if agent_result:
        spec = agent_result["spec"]
        custom_python = objects_source(agent_result["objects"])
        custom_name = agent_result["name"]
        custom_elements = agent_result["elements"]

    seed_val = int(hashlib.sha1(prompt.strip().lower().encode("utf-8")).hexdigest()[:8], 16)
    biome = str(spec.get("biome", "park"))

    elements: list[str] = custom_elements or [f"{biome} setting"]
    if not custom_elements:
        for key, label in [
            ("palm_trees", "palm trees"),
            ("cherry_trees", "pink cherry blossom trees"),
            ("pine_trees", "pine trees"),
            ("trees", "trees"),
            ("cacti", "green cacti"),
            ("pond", "a blue pond with lily pads"),
            ("bench", "wooden slatted bench"),
            ("house", "buildings"),
            ("car", "cars"),
            ("bus", "a bus"),
            ("vending", "a vending machine"),
            ("desk", "desks and chairs"),
            ("blackboard", "a blackboard on the wall"),
            ("umbrella", "a beach umbrella"),
            ("surfboard", "a surfboard"),
            ("boat", "a boat on the water"),
            ("snowman", "a snowman"),
            ("dog", "a Shiba Inu dog"),
            ("cat", "a cat"),
            ("ball", "a ball"),
            ("people", "people in the scene"),
        ]:
            if int(spec.get(key, 0) or 0) > 0:
                cnt = int(spec[key])
                elements.append(f"{cnt} {label}" if cnt > 1 else label)

    spec_json_repr = repr(spec)

    code = f'''from __future__ import annotations
import argparse, math, random, sys
from pathlib import Path
import bmesh, bpy
from mathutils import Euler, Matrix, Vector, noise

sys.path.insert(0, str({str(SCENE_SCRIPTS_DIR)!r}))
from common import HALF, SIZE, Part, material, materials, person, run
from object_kit import build_objects

SCENE_ID = {scene_id!r}
SPEC = {spec_json_repr}
rng = random.Random({seed_val})


def pick_spot(used: list[tuple[float, float, float]], r: float, x_range=(-3.1, 3.1), y_range=(-3.1, 3.1)) -> tuple[float, float]:
    """他のオブジェクトと重ならない座標を探す。"""
    for _ in range(80):
        x = rng.uniform(*x_range)
        y = rng.uniform(*y_range)
        if all(math.hypot(x - ux, y - uy) >= (r + ur + 0.22) for ux, uy, ur in used):
            used.append((x, y, r))
            return x, y
    x, y = rng.uniform(*x_range), rng.uniform(*y_range)
    used.append((x, y, r))
    return x, y


{custom_python}


def build():
    root = bpy.data.objects.new(SCENE_ID, None)
    bpy.context.scene.collection.objects.link(root)
    biome = str(SPEC.get("biome", "park"))
    is_night = bool(SPEC.get("is_night", False))

    ground_colors = {{
        "park": "#355e3b" if is_night else "#6dbb45",
        "autumn": "#d89b48",
        "snow": "#eef4fa",
        "beach": "#f4dc9c",
        "desert": "#e6b86a",
        "city": "#cfcac2",
        "indoor": "#c8935a",
    }}

    M = materials({{
        "ground": (ground_colors.get(biome, "#6dbb45"), 0.88),
        "grass_dark": ("#4a9530" if biome != "autumn" else "#b8732a", 0.9),
        "grass_light": ("#93d35c" if biome != "autumn" else "#e8b04e", 0.9),
        "soil": ("#7a4a2a", 0.95),
        "soil_dark": ("#4f2f1a", 0.95),
        "sand": ("#f4dc9c", 0.85),
        "asphalt": ("#4a4c52", 0.9),
        "stripe": ("#f4f4f0", 0.7),
        "stone_a": ("#cbbfa8", 0.75),
        "stone_b": ("#b2a58f", 0.8),
        "wall": ("#f3ead8", 0.85),
        "board": ("#2f5e45", 0.85),
        "bark": ("#6b4428", 0.9),
        "leaf": ("#e06a2b" if biome == "autumn" else "#3f9a3a", 0.7),
        "leaf2": ("#f29b38" if biome == "autumn" else "#5cb848", 0.7),
        "leaf3": ("#c44d1c" if biome == "autumn" else "#2f7d33", 0.7),
        "pine": ("#2d5a3c", 0.75),
        "snow": ("#f8fbff", 0.6),
        "blossom": ("#f7b6c8", 0.6),
        "blossom2": ("#f093b0", 0.6),
        "lily": ("#4c9c3b", 0.5),
        "cactus": ("#3b8c47", 0.7),
        "wood": ("#a8683a", 0.55),
        "fence": ("#c98e5a", 0.6),
        "desk": ("#d9a868", 0.45),
        "rock": ("#8d8d94", 0.8),
        "rock_dark": ("#6a6a72", 0.85),
        "dog": ("#e0893a", 0.7),
        "dog_white": ("#f6efe4", 0.7),
        "cat": ("#f2994a", 0.7),
        "white": ("#ffffff", 0.6),
        "dark": ("#2a211c", 0.3),
        "red": ("#e3483c", 0.45),
        "blue": ("#3a7bd5", 0.45),
        "yellow": ("#ffc93a", 0.4),
        "pink": ("#ff8fb3", 0.55),
        "purple": ("#b48cff", 0.6),
        "stem": ("#4e9a33", 0.7),
        "building_a": ("#f4efe4", 0.8),
        "building_b": ("#d9c3b0", 0.8),
        "roof_red": ("#c94a3f", 0.6),
        "roof_slate": ("#5a6170", 0.6),
        "skin": ("#f6caa6", 0.55),
        "hair_a": ("#3a2618", 0.6),
        "hair_b": ("#2a1f1a", 0.6),
    }})
    M["iron"] = material("iron", "#2b2b30", 0.35, metal=0.8)
    M["water"] = material("water", "#1f78c8", 0.25, ior=1.12)
    M["glass"] = material("glass", "#bfe3ff", 0.15, emit=0.5)
    M["lamp_glass"] = material("lamp_glass", "#ffe7a8", 0.2, emit=4.0)

    used: list[tuple[float, float, float]] = []

    # ---------- 1. 島の土台（3 層スラブ＋崖側面の岩） ----------
    base = Part("island")
    base.slab(SIZE, 0.0, 0.25, 1.0, M["ground"])
    base.slab(SIZE - 0.08, -0.25, 0.85, 0.96, M["soil"])
    base.slab(SIZE - 0.4, -1.1, 0.18, 0.8, M["soil_dark"])
    base.finish(root)

    cliff_rocks = Part("island_rocks")
    for _ in range(24):
        side = rng.choice(["x+", "x-", "y+", "y-"])
        a = rng.uniform(-HALF + 1.2, HALF - 1.2)
        z = rng.uniform(-1.0, -0.45)
        d = HALF - 0.02
        loc = {{"x+": (d, a, z), "x-": (-d, a, z), "y+": (a, d, z), "y-": (a, -d, z)}}[side]
        cliff_rocks.blob(rng.uniform(0.14, 0.3), loc, rng.choice([M["rock"], M["rock_dark"]]),
                         scale=(1, 1, 0.75), bumpy=0.3, subdiv=2, seed=rng.random() * 10, smooth=False)
    cliff_rocks.finish(root)

    if biome == "beach":
        sea = Part("sea")
        sea.box((SIZE - 0.3, 3.2, 0.08), (0, -2.2, 0.02), M["water"], bevel=0.03)
        sea.box((SIZE - 0.4, 0.22, 0.05), (0, -0.55, 0.03), M["white"], bevel=0.02)
        sea.finish(root)
        used.append((0, -2.2, 1.5))
    elif biome == "city":
        road = Part("road")
        road.box((SIZE - 0.4, 1.6, 0.03), (0, -2.2, 0.015), M["asphalt"])
        for k in range(7):
            road.box((0.3, 1.2, 0.015), (-1.5 + k * 0.5, -2.2, 0.032), M["stripe"])
        road.finish(root)
    elif biome == "indoor":
        walls = Part("walls")
        walls.box((SIZE, 0.25, 3.0), (0, HALF - 0.125, 1.5), M["wall"])
        walls.box((0.25, SIZE - 0.25, 3.0), (-HALF + 0.125, -0.125, 1.5), M["wall"])
        for wy in (-1.5, 0.8):
            walls.box((0.08, 1.4, 1.3), (-HALF + 0.26, wy, 1.7), M["glass"])
        walls.finish(root)
    elif biome in ("park", "autumn"):
        # S 字の飛び石の小道
        path = Part("stepping_stones")
        for i in range(13):
            t = i / 12
            py = -HALF + 0.45 + (SIZE - 0.9) * t
            px = 0.5 * math.sin(t * math.pi * 2.0) + (0.14 if i % 2 else -0.14)
            r = rng.uniform(0.21, 0.27)
            path.cyl(r, r * 0.92, 0.06, (px, py, 0.03), M["stone_a"] if i % 2 else M["stone_b"], segs=12)
            used.append((px, py, 0.35))
        path.finish(root)

    # ---------- 2. AI エージェントが書いたカスタム 3D オブジェクト ----------
    try:
        build_custom(root)
        for obj in list(root.children):
            if obj.name not in ("island", "island_rocks", "sea", "road", "walls", "stepping_stones"):
                used.append((obj.location.x, obj.location.y, 0.85))
    except Exception as exc:
        print(f"[ai_generator] custom_python warning: {{exc}}", file=sys.stderr)

    # ---------- 3. 黒板（室内） ----------
    if int(SPEC.get("blackboard", 0) or 0) > 0:
        bb = Part("blackboard")
        y = HALF - 0.26
        bb.box((4.0, 0.08, 1.5), (0.2, y, 1.65), M["wood"], bevel=0.02)
        bb.box((3.8, 0.06, 1.3), (0.2, y - 0.04, 1.65), M["board"])
        bb.finish(root)
        used.append((0.2, y - 0.4, 1.2))

    # ---------- 4. 建物・家 ----------
    for i in range(int(SPEC.get("house", 0) or 0)):
        hx, hy = pick_spot(used, 1.3, (-2.6, 2.6), (1.4, 2.7) if biome == "city" else (-2.2, 2.4))
        h = Part(f"house_{{i}}")
        w, d, z_h = rng.uniform(1.8, 2.4), rng.uniform(1.4, 1.8), rng.uniform(1.8, 2.6)
        b_mat = M["building_a"] if i % 2 == 0 else M["building_b"]
        h.box((w, d, z_h), (0, 0, z_h / 2), b_mat, bevel=0.03)
        h.box((w + 0.2, d + 0.2, 0.35), (0, 0, z_h + 0.17), M["roof_red"] if i % 2 == 0 else M["roof_slate"], bevel=0.04)
        h.box((0.45, 0.08, 0.85), (0, -d / 2 - 0.02, 0.42), M["wood"])
        for wx in (-w * 0.26, w * 0.26):
            h.box((0.42, 0.08, 0.45), (wx, -d / 2 - 0.02, z_h * 0.65), M["glass"])
        h.finish(root, loc=(hx, hy, 0))

    # ---------- 5. 池（岩の縁＋睡蓮の葉と花） ----------
    for i in range(int(SPEC.get("pond", 0) or 0)):
        px, py = pick_spot(used, 1.35, (-2.2, 2.2), (-2.0, 2.2))
        pond = Part(f"pond_{{i}}")
        pr = rng.uniform(1.0, 1.25)
        pond.cyl(pr, pr, 0.05, (0, 0, 0.02), M["water"], segs=36, smooth=False)
        for k in range(18):
            a = k / 18 * math.tau + rng.uniform(-0.08, 0.08)
            rr = pr + rng.uniform(0.04, 0.14)
            pond.blob(rng.uniform(0.13, 0.2), (math.cos(a) * rr, math.sin(a) * rr, 0.05),
                      rng.choice([M["rock"], M["rock_dark"]]), scale=(1, 1, 0.6), bumpy=0.25, subdiv=2, seed=k, smooth=False)
        for dx, dy, s in [(-0.28, 0.18, 0.19), (0.24, -0.15, 0.15), (0.05, 0.32, 0.12)]:
            pond.cyl(s, s, 0.015, (dx, dy, 0.055), M["lily"], segs=14, smooth=False)
        pond.sphere(0.045, (-0.28, 0.18, 0.08), M["pink"], segs=10)
        pond.finish(root, loc=(px, py, 0))

    # ---------- 6. 木（枝付き広葉樹・花びら付き桜・雪付き針葉樹・ヤシ・サボテン） ----------
    def make_detailed_tree(name: str, loc: tuple[float, float], blossom: bool):
        t = Part(name)
        height = rng.uniform(2.7, 3.4)
        crown = rng.uniform(0.85, 1.05)
        trunk_h = height * 0.5
        t.cyl(0.2, 0.11, trunk_h, (0, 0, trunk_h / 2), M["bark"], segs=10)
        t.cyl(0.07, 0.04, 0.8, (0.22, 0, trunk_h * 0.85), M["bark"], rot=(0, 0.8, 0), segs=8)
        t.cyl(0.06, 0.035, 0.7, (-0.18, 0.05, trunk_h * 0.9), M["bark"], rot=(0.2, -0.7, 0), segs=8)
        mats = [M["blossom"], M["blossom2"], M["blossom"]] if blossom else [M["leaf"], M["leaf2"], M["leaf3"]]
        cz = trunk_h + 0.75 * crown
        blobs = [
            (0, 0, cz, 0.95), (0.6, 0.2, cz - 0.25, 0.7), (-0.55, -0.15, cz - 0.2, 0.72),
            (0.1, -0.5, cz - 0.1, 0.65), (-0.1, 0.5, cz + 0.05, 0.68), (0.15, 0.05, cz + 0.6, 0.62),
        ]
        for idx, (bx, by, bz, br) in enumerate(blobs):
            t.blob(br * crown, (bx * crown, by * crown, bz), mats[idx % 3], bumpy=0.18, subdiv=3, seed=idx * 3.1 + loc[0])
        t.finish(root, loc=(*loc, 0))
        if blossom:
            petals = Part(name + "_petals")
            for _ in range(24):
                a, d = rng.random() * math.tau, rng.uniform(0.4, 1.35)
                petals.cyl(0.045, 0.045, 0.01, (loc[0] + math.cos(a) * d, loc[1] + math.sin(a) * d, 0.01),
                           rng.choice([M["blossom"], M["blossom2"]]), segs=6, smooth=False)
            petals.finish(root)

    for i in range(int(SPEC.get("cherry_trees", 0) or 0)):
        tx, ty = pick_spot(used, 0.95, (-3.1, 3.1), (-2.8, 3.0))
        make_detailed_tree(f"cherry_tree_{{i}}", (tx, ty), blossom=True)

    for i in range(int(SPEC.get("trees", 0) or 0)):
        tx, ty = pick_spot(used, 0.95, (-3.1, 3.1), (-2.8, 3.0))
        make_detailed_tree(f"tree_{{i}}", (tx, ty), blossom=False)

    for i in range(int(SPEC.get("pine_trees", 0) or 0)):
        tx, ty = pick_spot(used, 0.85, (-3.1, 3.1), (-2.8, 3.0))
        t = Part(f"pine_tree_{{i}}")
        t.cyl(0.16, 0.1, 1.1, (0, 0, 0.55), M["bark"], segs=10)
        for z_base, r_cone, d_cone in [(1.2, 1.05, 1.1), (1.85, 0.82, 0.95), (2.4, 0.55, 0.8)]:
            t.cyl(r_cone, 0.05, d_cone, (0, 0, z_base), M["pine"], segs=12)
            if biome == "snow":
                t.cyl(r_cone * 0.92, 0.04, d_cone * 0.35, (0, 0, z_base + d_cone * 0.3), M["snow"], segs=12)
        t.finish(root, loc=(tx, ty, 0))

    for i in range(int(SPEC.get("palm_trees", 0) or 0)):
        tx, ty = pick_spot(used, 0.85, (-3.0, 3.0), (0.0, 3.0) if biome == "beach" else (-2.8, 2.8))
        t = Part(f"palm_tree_{{i}}")
        t.limb((0, 0, 0), (0.25, -0.15, 2.4), 0.18, 0.1, M["bark"])
        for k in range(6):
            a = k / 6 * math.tau
            t.box((0.95, 0.28, 0.06), (0.25 + math.cos(a) * 0.55, -0.15 + math.sin(a) * 0.55, 2.35),
                  M["leaf"], rot=(0.25 * math.sin(a), -0.25 * math.cos(a), a), bevel=0.02)
        t.finish(root, loc=(tx, ty, 0))

    for i in range(int(SPEC.get("cacti", 0) or 0)):
        cx, cy = pick_spot(used, 0.5, (-3.1, 3.1), (-2.8, 2.8))
        c = Part(f"cactus_{{i}}")
        c.cyl(0.16, 0.14, 1.5, (0, 0, 0.75), M["cactus"], segs=10)
        c.sphere(0.14, (0, 0, 1.5), M["cactus"])
        c.limb((0, 0, 0.75), (0.38, 0, 0.9), 0.1, 0.09, M["cactus"])
        c.limb((0.38, 0, 0.9), (0.38, 0, 1.3), 0.09, 0.08, M["cactus"])
        c.limb((0, 0, 0.6), (-0.35, 0, 0.75), 0.1, 0.09, M["cactus"])
        c.limb((-0.35, 0, 0.75), (-0.35, 0, 1.15), 0.09, 0.08, M["cactus"])
        c.finish(root, loc=(cx, cy, 0), rot_z=rng.uniform(0, math.tau))

    # ---------- 7. 机・ベンチ（park.py 仕様スラット構造）・自販機・六角街灯・柵 ----------
    for i in range(int(SPEC.get("desk", 0) or 0)):
        dx, dy = pick_spot(used, 0.75, (-2.4, 2.4), (-2.2, 1.6))
        d = Part(f"desk_{{i}}")
        d.box((1.1, 0.7, 0.06), (0, 0, 0.72), M["desk"], bevel=0.01)
        for sx in (-0.48, 0.48):
            for sy in (-0.28, 0.28):
                d.cyl(0.03, 0.03, 0.7, (sx, sy, 0.35), M["iron"], segs=8)
        d.box((0.5, 0.46, 0.05), (0, -0.55, 0.44), M["wood"], bevel=0.01)
        d.box((0.5, 0.05, 0.42), (0, -0.76, 0.66), M["wood"], bevel=0.01)
        d.finish(root, loc=(dx, dy, 0))

    for i in range(int(SPEC.get("bench", 0) or 0)):
        bx, by = pick_spot(used, 0.85, (-2.6, 2.6), (-2.2, 2.2))
        b = Part(f"bench_{{i}}")
        for k in range(4):
            b.box((1.6, 0.085, 0.045), (0, -0.17 + k * 0.105, 0.46), M["wood"], bevel=0.012)
        for k in range(3):
            b.box((1.6, 0.045, 0.085), (0, 0.27, 0.62 + k * 0.12), M["wood"], rot=(-0.22, 0, 0), bevel=0.012)
        for sx in (-0.68, 0.68):
            b.box((0.05, 0.05, 0.45), (sx, -0.17, 0.225), M["iron"], bevel=0.01)
            b.box((0.05, 0.05, 0.95), (sx, 0.24, 0.47), M["iron"], rot=(-0.22, 0, 0), bevel=0.01)
            b.box((0.06, 0.5, 0.045), (sx, 0.02, 0.66), M["iron"], bevel=0.015)
            b.box((0.05, 0.45, 0.04), (sx, 0.03, 0.43), M["iron"], bevel=0.01)
        b.finish(root, loc=(bx, by, 0), rot_z=rng.uniform(-0.8, 0.8))

    for i in range(int(SPEC.get("vending", 0) or 0)):
        vx, vy = pick_spot(used, 0.65, (-2.8, 2.8), (-1.5, 2.5))
        v = Part(f"vending_{{i}}")
        v.box((0.95, 0.65, 1.85), (0, 0, 0.925), M["red"] if i % 2 == 0 else M["blue"], bevel=0.03)
        v.box((0.76, 0.04, 0.95), (0, -0.32, 1.22), M["glass"])
        v.finish(root, loc=(vx, vy, 0))

    for i in range(int(SPEC.get("lamp", 0) or 0)):
        lx, ly = pick_spot(used, 0.4, (-2.9, 2.9), (-2.4, 2.4))
        lamp = Part(f"lamp_{{i}}")
        lamp.cyl(0.16, 0.13, 0.16, (0, 0, 0.08), M["iron"], segs=16)
        lamp.cyl(0.05, 0.04, 2.6, (0, 0, 1.45), M["iron"], segs=12)
        lamp.cyl(0.08, 0.08, 0.06, (0, 0, 2.75), M["iron"], segs=12)
        lamp.cyl(0.13, 0.17, 0.34, (0, 0, 2.95), M["lamp_glass"], segs=6, smooth=False)
        lamp.cyl(0.25, 0.03, 0.22, (0, 0, 3.23), M["iron"], segs=6, smooth=False)
        lamp.sphere(0.05, (0, 0, 3.37), M["iron"], segs=10)
        lamp.finish(root, loc=(lx, ly, 0))

    if int(SPEC.get("fence", 0) or 0) > 0:
        f = Part("fence")
        x0, x1, fy = 1.1, 3.4, 3.55
        n = int((x1 - x0) / 0.5)
        posts = [x0 + (x1 - x0) * k / n for k in range(n + 1)]
        for x in posts:
            f.box((0.08, 0.08, 0.62), (x, fy, 0.31), M["fence"], bevel=0.015)
            f.cyl(0.06, 0.0, 0.08, (x, fy, 0.66), M["fence"], segs=4, smooth=False)
            used.append((x, fy, 0.25))
        for z in (0.22, 0.46):
            f.box((x1 - x0 + 0.1, 0.05, 0.07), ((x0 + x1) / 2, fy - 0.06, z), M["fence"], bevel=0.012)
        f.finish(root)

    # ---------- 8. 車・バス・ボート・ビーチ用品 ----------
    for i in range(int(SPEC.get("car", 0) or 0)):
        cx, cy = pick_spot(used, 1.15, (-2.6, 2.6), (-2.5, -1.6) if biome == "city" else (-2.4, 2.0))
        car = Part(f"car_{{i}}")
        c_mat = [M["yellow"], M["red"], M["blue"]][i % 3]
        car.box((1.9, 1.05, 0.48), (0, 0, 0.38), c_mat, bevel=0.06)
        car.box((1.1, 0.92, 0.42), (-0.05, 0, 0.78), c_mat, bevel=0.06)
        car.box((1.14, 0.96, 0.32), (-0.05, 0, 0.78), M["glass"], bevel=0.03)
        for sx in (-0.6, 0.6):
            for sy in (-0.5, 0.5):
                car.cyl(0.22, 0.22, 0.14, (sx, sy, 0.22), M["iron"], rot=(math.pi / 2, 0, 0), segs=12)
        car.finish(root, loc=(cx, cy, 0), rot_z=0.0 if biome == "city" else rng.uniform(-0.6, 0.6))

    for i in range(int(SPEC.get("bus", 0) or 0)):
        bx, by = pick_spot(used, 1.5, (-2.2, 2.2), (-2.5, -1.5) if biome == "city" else (-2.2, 1.8))
        bus = Part(f"bus_{{i}}")
        bus.box((3.0, 1.2, 1.35), (0, 0, 0.85), M["blue"], bevel=0.06)
        bus.box((2.8, 1.24, 0.5), (0, 0, 1.05), M["glass"], bevel=0.02)
        for sx in (-0.95, 0.95):
            for sy in (-0.58, 0.58):
                bus.cyl(0.26, 0.26, 0.16, (sx, sy, 0.26), M["iron"], rot=(math.pi / 2, 0, 0), segs=12)
        bus.finish(root, loc=(bx, by, 0))

    for i in range(int(SPEC.get("umbrella", 0) or 0)):
        ux, uy = pick_spot(used, 0.85, (-2.5, 2.5), (0.0, 2.4) if biome == "beach" else (-2.2, 2.2))
        u = Part(f"umbrella_{{i}}")
        u.cyl(0.04, 0.04, 1.9, (0, 0, 0.95), M["white"], segs=10)
        u.cyl(1.15, 0.08, 0.55, (0, 0, 1.95), M["red"] if i % 2 == 0 else M["yellow"], segs=16)
        u.finish(root, loc=(ux, uy, 0), rot_z=rng.uniform(0, math.tau))

    for i in range(int(SPEC.get("surfboard", 0) or 0)):
        sx, sy = pick_spot(used, 0.6, (-2.6, 2.6), (-0.4, 2.0))
        sb = Part(f"surfboard_{{i}}")
        sb.sphere(0.75, (0, 0, 0.08), M["red"] if i % 2 == 0 else M["yellow"], scale=(0.32, 1.0, 0.08))
        sb.finish(root, loc=(sx, sy, 0), rot_z=rng.uniform(-0.8, 0.8))

    for i in range(int(SPEC.get("boat", 0) or 0)):
        bx, by = (rng.uniform(-2.2, 2.2), rng.uniform(-2.9, -1.5)) if biome == "beach" else pick_spot(used, 0.9, (-2.2, 2.2), (-2.2, 2.2))
        bt = Part(f"boat_{{i}}")
        bt.box((1.5, 0.75, 0.32), (0, 0, 0.2), M["wood"], bevel=0.08)
        bt.cyl(0.03, 0.02, 1.3, (0, 0, 0.85), M["wood"], segs=8)
        bt.box((0.04, 0.65, 0.95), (0, 0.3, 0.95), M["white"])
        bt.finish(root, loc=(bx, by, 0.04), rot_z=rng.uniform(-0.4, 0.4))

    # ---------- 9. 雪だるま・柴犬（park.py 仕様）・猫・ボール・花壇・低木・岩 ----------
    for i in range(int(SPEC.get("snowman", 0) or 0)):
        sx, sy = pick_spot(used, 0.55, (-2.6, 2.6), (-2.4, 2.4))
        sm = Part(f"snowman_{{i}}")
        sm.sphere(0.42, (0, 0, 0.38), M["snow"])
        sm.sphere(0.3, (0, 0, 0.95), M["snow"])
        sm.sphere(0.22, (0, 0, 1.38), M["snow"])
        sm.cyl(0.04, 0.01, 0.18, (0, -0.24, 1.38), M["dog"], rot=(math.pi / 2, 0, 0), segs=8)
        sm.cyl(0.18, 0.18, 0.25, (0, 0, 1.66), M["iron"], segs=12)
        sm.finish(root, loc=(sx, sy, 0), rot_z=rng.uniform(-0.5, 0.5))

    for i in range(int(SPEC.get("dog", 0) or 0)):
        dx, dy = pick_spot(used, 0.5, (-2.6, 2.6), (-2.2, 2.2))
        dog = Part(f"dog_{{i}}")
        dog.sphere(0.2, (0, 0.02, 0.4), M["dog"], scale=(1, 1.75, 0.95))
        dog.sphere(0.15, (0, -0.24, 0.38), M["dog_white"], scale=(1, 0.8, 1.05))
        dog.sphere(0.17, (0, -0.42, 0.62), M["dog"])
        dog.sphere(0.09, (0, -0.56, 0.57), M["dog_white"], scale=(1, 1.15, 0.8))
        dog.sphere(0.03, (0, -0.665, 0.6), M["dark"], segs=10)
        for sx in (-1, 1):
            dog.sphere(0.024, (sx * 0.075, -0.55, 0.67), M["dark"], segs=10)
            dog.cyl(0.065, 0.0, 0.13, (sx * 0.09, -0.4, 0.79), M["dog"], rot=(-0.15, sx * 0.3, 0), segs=4, smooth=False)
            dog.cyl(0.05, 0.045, 0.28, (sx * 0.1, -0.24, 0.17), M["dog"], rot=(-0.45, 0, 0), segs=10)
            dog.cyl(0.05, 0.045, 0.28, (sx * 0.1, 0.27, 0.17), M["dog"], rot=(0.45, 0, 0), segs=10)
            dog.sphere(0.05, (sx * 0.1, -0.31, 0.04), M["dog_white"], segs=10)
            dog.sphere(0.05, (sx * 0.1, 0.34, 0.04), M["dog_white"], segs=10)
        for k in range(6):
            a = k / 6 * math.pi * 1.3
            dog.sphere(0.06 - k * 0.006, (0, 0.36 + math.sin(a) * 0.1, 0.55 + (1 - math.cos(a)) * 0.1 + k * 0.01),
                       M["dog"] if k < 5 else M["dog_white"], segs=10)
        dog.finish(root, loc=(dx, dy, 0), rot_z=rng.uniform(0, math.tau))

    for i in range(int(SPEC.get("cat", 0) or 0)):
        cx, cy = pick_spot(used, 0.38, (-2.6, 2.6), (-2.2, 2.2))
        cat = Part(f"cat_{{i}}")
        cat.sphere(0.16, (0, 0, 0.16), M["cat"], scale=(0.9, 1.3, 0.8))
        cat.sphere(0.13, (0, -0.18, 0.29), M["cat"])
        for sx in (-1, 1):
            cat.cyl(0.04, 0.005, 0.09, (sx, -0.18, 0.41), M["cat"], segs=6)
        cat.finish(root, loc=(cx, cy, 0), rot_z=rng.uniform(0, math.tau))

    for i in range(int(SPEC.get("ball", 0) or 0)):
        bx, by = pick_spot(used, 0.3, (-2.5, 2.5), (-2.2, 2.2))
        ball = Part(f"ball_{{i}}")
        ball.sphere(0.14, (0, 0, 0.14), M["red"] if i % 2 == 0 else M["yellow"], segs=22)
        ball.cyl(0.141, 0.141, 0.025, (0, 0, 0.14), M["white"], rot=(0.5, 0.3, 0), segs=22)
        ball.finish(root, loc=(bx, by, 0))

    for i in range(int(SPEC.get("rocks", 0) or 0)):
        rx, ry = pick_spot(used, 0.45, (-3.2, 3.2), (-2.8, 2.8))
        rk = Part(f"rock_{{i}}")
        s = rng.uniform(0.24, 0.36)
        rk.blob(s, (0, 0, s * 0.3), M["rock"], scale=(1.2, 1, 0.7), bumpy=0.3, subdiv=2, seed=i * 2.3, smooth=False)
        rk.blob(s * 0.55, (s * 0.9, -s * 0.4, s * 0.2), M["rock_dark"], scale=(1.1, 1, 0.7), bumpy=0.3, subdiv=2, seed=i * 4.1, smooth=False)
        rk.finish(root, loc=(rx, ry, 0), rot_z=rng.uniform(0, math.tau))

    flower_colors = [M["pink"], M["yellow"], M["white"], M["purple"]]
    for i in range(int(SPEC.get("flowers", 0) or 0)):
        fx, fy = pick_spot(used, 0.45, (-3.1, 3.1), (-2.8, 2.8))
        fl = Part(f"flowers_{{i}}")
        for _ in range(14):
            a, d = rng.random() * math.tau, rng.random() * 0.48
            ox, oy = math.cos(a) * d, math.sin(a) * d
            h = rng.uniform(0.14, 0.25)
            fl.cyl(0.012, 0.01, h, (ox, oy, h / 2), M["stem"], segs=6)
            fl.blob(rng.uniform(0.045, 0.065), (ox, oy, h), rng.choice(flower_colors),
                    scale=(1, 1, 0.7), bumpy=0.35, subdiv=1, seed=rng.random() * 9)
            fl.sphere(0.02, (ox, oy, h + 0.03), M["yellow"], segs=8)
        fl.finish(root, loc=(fx, fy, 0))

    # ---------- 10. 人物 ----------
    top_mats = [M["yellow"], M["red"], M["blue"], M["pink"]]
    poses = ["walk", "stand", "point", "raise_hand", "phone"]
    for i in range(int(SPEC.get("people", 0) or 0)):
        px, py = pick_spot(used, 0.45, (-2.4, 2.4), (-2.0, 2.0))
        person(root, f"person_{{i}}", (px, py), rng.uniform(-0.9, 0.9), {{
            "skin": M["skin"],
            "hair": M["hair_a"] if i % 2 == 0 else M["hair_b"],
            "top": top_mats[i % len(top_mats)],
            "bottom": M["blue"] if i % 2 == 0 else M["iron"],
            "shoe": M["red"] if i % 2 == 0 else M["white"],
            "eye": M["dark"],
            "skirt": (i % 2 == 1),
            "hair_style": ["short", "long", "bun"][i % 3],
        }}, pose=poses[i % len(poses)], scale=rng.uniform(0.9, 1.0))

    # ---------- 11. 草むら（公園・秋バイオームの地面ディテール） ----------
    if biome in ("park", "autumn"):
        grass = Part("grass_tufts")
        placed = 0
        attempts = 0
        while placed < 200 and attempts < 900:
            attempts += 1
            gx, gy = rng.uniform(-HALF + 0.3, HALF - 0.3), rng.uniform(-HALF + 0.3, HALF - 0.3)
            corner = Vector((max(abs(gx) - (HALF - 1.0), 0), max(abs(gy) - (HALF - 1.0), 0))).length
            if corner > 0.85 or any((gx - kx) ** 2 + (gy - ky) ** 2 < (kr + 0.15) ** 2 for kx, ky, kr in used):
                continue
            gmat = rng.choice([M["grass_dark"], M["grass_dark"], M["grass_light"]])
            for _ in range(rng.randint(3, 5)):
                gh = rng.uniform(0.08, 0.15)
                lean = (rng.uniform(-0.35, 0.35), rng.uniform(-0.35, 0.35), 0)
                grass.cyl(0.026, 0.0, gh, (gx + rng.uniform(-0.05, 0.05), gy + rng.uniform(-0.05, 0.05), gh / 2),
                          gmat, rot=lean, segs=4, smooth=False)
            placed += 1
        grass.finish(root)

    return root


if __name__ == "__main__":
    run(SCENE_ID, build)
'''
    return {
        "name": custom_name or f"AI 生成シーン ({biome})",
        "description": prompt.strip(),
        "elements": elements,
        "python_code": code,
    }


def generate_scene(prompt: str, scene_id: str | None = None, out_dir: Path = OUT_DIR) -> dict:
    """プロンプトから Blender を回して .usdz と .json を書き出し、メタデータを返す。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    if not scene_id:
        digest = hashlib.sha1(f"{prompt}-{time.time()}".encode("utf-8")).hexdigest()[:8]
        scene_id = f"gen_{digest}"
    scene_id = re.sub(r"[^a-zA-Z0-9_]", "_", scene_id)

    spec = build_procedural_scene(prompt, scene_id)

    script_path = out_dir / f"{scene_id}.py"
    script_path.write_text(spec["python_code"], encoding="utf-8")

    blender_bin = find_blender()
    cmd = [
        blender_bin,
        "--background",
        "--factory-startup",
        "--python",
        str(script_path),
        "--",
        "--out",
        str(out_dir),
        "--no-render",
    ]
    subprocess.run(cmd, capture_output=True, text=True, timeout=90, check=True)
    usdz_path = out_dir / f"{scene_id}.usdz"

    meta = {
        "id": scene_id,
        "name": spec["name"],
        "model": f"{scene_id}.usdz",
        "description": spec["description"],
        "elements": spec["elements"],
    }
    json_path = out_dir / f"{scene_id}.json"
    json_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        **meta,
        "usdz_path": str(usdz_path),
        "json_path": str(json_path),
    }


class SceneGeneratorHandler(BaseHTTPRequestHandler):
    """iOS アプリやバックエンドからプロンプトを受け取って .usdz を生成・配信する HTTP サーバー。"""

    def _send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        if self.path.startswith("/scenes/"):
            filename = Path(self.path).name
            file_path = OUT_DIR / filename
            if not file_path.exists():
                file_path = REPO / "assets" / "scenes" / filename
            if not file_path.exists():
                self._send_json(404, {"error": "not_found"})
                return
            data = file_path.read_bytes()
            self.send_response(200)
            content_type = "model/vnd.usdz+zip" if filename.endswith(".usdz") else "application/json"
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/generate-scene":
            self._send_json(404, {"error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "invalid_json"})
            return

        prompt = str(body.get("prompt", "")).strip()
        if not prompt:
            self._send_json(400, {"error": "empty_prompt"})
            return

        t0 = time.time()
        try:
            result = generate_scene(prompt=prompt, scene_id=body.get("sceneId"))
        except Exception as exc:
            self._send_json(500, {"error": str(exc)})
            return

        elapsed = round(time.time() - t0, 2)
        host = self.headers.get("Host", f"localhost:{self.server.server_port}")
        usdz_url = f"http://{host}/scenes/{result['model']}"
        print(f"[ai_generator] Generated {result['id']} for prompt={prompt!r} in {elapsed}s -> {result['elements']}")
        self._send_json(
            200,
            {
                "sceneId": result["id"],
                "name": result["name"],
                "description": result["description"],
                "elements": result["elements"],
                "usdzUrl": usdz_url,
                "elapsedSeconds": elapsed,
            },
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="ホストの 1 文から Blender で 3D シーン (.usdz) を生成する")
    ap.add_argument("--prompt", type=str, help="生成する場面の英文プロンプト")
    ap.add_argument("--id", type=str, default=None, help="出力するシーン ID（省略時は自動生成）")
    ap.add_argument("--serve", action="store_true", help="HTTP サーバーとして起動する")
    ap.add_argument("--port", type=int, default=8790, help="HTTP サーバーのポート番号（既定: 8790）")
    args = ap.parse_args()

    if args.serve:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        server = ThreadingHTTPServer(("0.0.0.0", args.port), SceneGeneratorHandler)
        print(f"[ai_generator] Serving on http://localhost:{args.port} (POST /generate-scene)")
        server.serve_forever()
        return

    if not args.prompt:
        ap.error("--prompt または --serve を指定してください")

    t0 = time.time()
    result = generate_scene(prompt=args.prompt, scene_id=args.id)
    elapsed = round(time.time() - t0, 2)
    print(json.dumps({**result, "elapsedSeconds": elapsed}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
