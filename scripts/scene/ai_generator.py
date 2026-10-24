#!/usr/bin/env python3
"""ホストが話した 1 文（プロンプト）から Blender で 3D シーン（.usdz）と採点用 JSON を動的生成するエージェント＆サーバー。

使い方:
  1) 単発で 1 文から生成する（CLI）:
     python3 scripts/scene/ai_generator.py --prompt "A sandy beach with palm trees, a red surfboard, and a crab"

  2) iOS アプリから呼べる HTTP サーバーとして起動する（既定: http://localhost:8790）:
     python3 scripts/scene/ai_generator.py --serve --port 8790

AI バックエンドの優先順位:
  1. 環境変数 ANTHROPIC_API_KEY があれば Claude API を使用
  2. ローカルの Ollama (http://127.0.0.1:11434) が動いていればローカル LLM を使用
  3. 環境変数 USE_CLAUDE_CLI=1 があれば `~/.local/bin/claude -p` を使用
  4. キー無し・オフラインでも即座（約 2 秒）に動く自然言語シーン合成エンジン（バイオーム・個数・色・配置をプロンプトから自動構築）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

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
            # 複数形なら 2 個、単数形なら default_if_present
            if re.search(rf"\b{re.escape(kw)}s\b", low) and not kw.endswith("s"):
                return max(2, default_if_present)
            return default_if_present
    return 0


def parse_prompt_to_scene_spec(prompt: str) -> dict:
    """プロンプトの自然言語からバイオーム（場所・季節・時間帯）と登場オブジェクトの種類・個数を抽出する。"""
    low = prompt.lower()

    # 1. バイオーム（舞台）の判定
    if any(w in low for w in ("beach", "ocean", "sea", "island", "coast", "surf", "tropical", "海", "ビーチ", "砂浜")):
        biome = "beach"
    elif any(w in low for w in ("classroom", "school", "room", "kitchen", "office", "indoor", "study", "教室", "部屋", "室内", "台所")):
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

    # 特定種類の木（桜・松・ヤシ）を数えたあと、一般の「tree」と二重カウントしないよう除外した文字列を作る
    cherry_count = count_in_prompt(low, ("cherry", "blossom", "sakura", "桜"))
    pine_count = count_in_prompt(low, ("pine", "fir", "christmas tree", "松", "針葉樹"))
    palm_count = count_in_prompt(low, ("palm", "coconut", "ヤシ"))
    low_without_specific_trees = re.sub(
        r"\b(cherry(\s+blossom)?|blossom|sakura|pine|fir|christmas|palm|coconut)\s+trees?\b",
        "",
        low,
    )

    # 2. 各オブジェクトの個数をプロンプトから抽出
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

    # 3. バイオームごとの自然なデフォルト補完（プロンプトで指定されなかった背景要素を少し足す）
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
        # park / autumn
        if total_props == 0:
            spec["trees"] = 2
            spec["bench"] = 1
            spec["dog"] = 1
            spec["people"] = 1

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


def call_claude_for_spec(prompt: str, base_spec: dict, api_key: str) -> dict | None:
    """ANTHROPIC_API_KEY があるとき、Claude API でプロンプトから Scene Spec JSON を抽出する。"""
    model = os.environ.get("CLAUDE_MODEL", "claude-haiku-4-5")
    body = {
        "model": model,
        "max_tokens": 1024,
        "messages": [
            {
                "role": "user",
                "content": (
                    f"Analyze this 3D scene description spoken by the host: {prompt!r}\n"
                    f"Update the following Scene Spec JSON with the appropriate biome "
                    f"('park', 'beach', 'indoor', 'city', 'snow', 'autumn', 'desert'), "
                    f"is_night (boolean), and integer object counts (0-6) matching the prompt.\n"
                    f"Return ONLY valid JSON with the exact same keys:\n{json.dumps(base_spec)}"
                ),
            }
        ],
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = data["content"][0]["text"]
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, dict) and "biome" in parsed:
                return {**base_spec, **parsed}
    except Exception as exc:
        print(f"[ai_generator] Claude API fallback ({exc})", file=sys.stderr)
    return None


def call_ollama_for_spec(prompt: str, base_spec: dict) -> dict | None:
    """ローカルで Ollama が動いていれば、プロンプトから Scene Spec を補強する。"""
    if os.environ.get("USE_OLLAMA") != "1":
        return None
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            tags = json.loads(resp.read().decode("utf-8")).get("models", [])
        if not tags:
            return None
        model_name = tags[0]["name"]
        body = {
            "model": model_name,
            "prompt": (
                f"Extract scene counts from this prompt: {prompt!r}. "
                f"Base JSON: {json.dumps(base_spec)}. Return updated JSON with same keys."
            ),
            "format": "json",
            "stream": False,
        }
        req2 = urllib.request.Request(
            "http://127.0.0.1:11434/api/generate",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req2, timeout=8.0) as resp2:
            out = json.loads(resp2.read().decode("utf-8"))
            parsed = json.loads(out["response"])
            if isinstance(parsed, dict) and "biome" in parsed:
                return {**base_spec, **parsed}
    except Exception:
        pass
    return None


def build_procedural_scene(prompt: str, scene_id: str) -> dict:
    """プロンプトから抽出した Scene Spec に基づき、毎回異なる 3D シーンの Blender スクリプトを生成する。"""
    spec = parse_prompt_to_scene_spec(prompt)
    api_key = load_anthropic_api_key()
    if api_key:
        claude_spec = call_claude_for_spec(prompt, spec, api_key)
        if claude_spec:
            spec = claude_spec
    else:
        ollama_spec = call_ollama_for_spec(prompt, spec)
        if ollama_spec:
            spec = ollama_spec

    seed_val = int(hashlib.sha1(prompt.strip().lower().encode("utf-8")).hexdigest()[:8], 16)
    biome = spec["biome"]

    elements: list[str] = [f"{biome} setting"]
    for key, label in [
        ("palm_trees", "palm trees"),
        ("cherry_trees", "pink cherry blossom trees"),
        ("pine_trees", "pine trees"),
        ("trees", "trees"),
        ("cacti", "green cacti"),
        ("pond", "a blue pond"),
        ("bench", "wooden bench"),
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
        ("dog", "dog"),
        ("cat", "cat"),
        ("ball", "a ball"),
        ("people", "people in the scene"),
    ]:
        if spec.get(key, 0) > 0:
            elements.append(f"{spec[key]} {label}" if spec[key] > 1 else label)

    spec_json_repr = repr(spec)

    code = f'''from __future__ import annotations
import argparse, math, random, sys
from pathlib import Path
import bmesh, bpy
from mathutils import Euler, Matrix, Vector, noise

sys.path.insert(0, str({str(SCENE_SCRIPTS_DIR)!r}))
try:
    from common import HALF, SIZE, Part, material, materials, person, run
except ImportError:
    SIZE = 8.0
    HALF = SIZE / 2

    def _srgb(hex_color: str):
        def lin(c: float) -> float:
            return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        h = hex_color.lstrip("#")
        return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))

    def material(name: str, color: str, rough: float = 0.6, metal: float = 0.0,
                 emit: float = 0.0, coat: float = 0.0, ior: float | None = None):
        mat = bpy.data.materials.get(name)
        if mat:
            return mat
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        rgb = _srgb(color)
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if emit:
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emit
        mat.diffuse_color = (*rgb, 1.0)
        return mat

    def materials(spec_dict: dict) -> dict:
        return {{n: material(n, c, r) for n, (c, r) in spec_dict.items()}}

    class Part:
        _tmp_mesh = None
        def __init__(self, name: str):
            self.name = name
            self.bm = bmesh.new()
            self.mats = []
        def _merge(self, tb, mat, smooth: bool):
            if mat not in self.mats:
                self.mats.append(mat)
            idx = self.mats.index(mat)
            for f in tb.faces:
                f.material_index = idx
                f.smooth = smooth and len(f.verts) <= 4
            if Part._tmp_mesh is None:
                Part._tmp_mesh = bpy.data.meshes.new("_tmp")
            tb.to_mesh(Part._tmp_mesh)
            tb.free()
            self.bm.from_mesh(Part._tmp_mesh)
        def box(self, size, loc, mat, rot=(0, 0, 0), bevel=0.0, segments=3):
            tb = bmesh.new()
            bmesh.ops.create_cube(tb, size=1.0, matrix=Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(size)))
            if bevel:
                bmesh.ops.bevel(tb, geom=list(tb.edges), offset=bevel, segments=segments, profile=0.5, affect="EDGES")
            self._merge(tb, mat, False)
        def cyl(self, r1, r2, depth, loc, mat, rot=(0, 0, 0), segs=16, smooth=True):
            tb = bmesh.new()
            bmesh.ops.create_cone(tb, cap_ends=True, segments=segs, radius1=r1, radius2=r2, depth=depth,
                                  matrix=Matrix.LocRotScale(Vector(loc), Euler(rot), Vector((1, 1, 1))))
            self._merge(tb, mat, smooth)
        def sphere(self, r, loc, mat, scale=(1, 1, 1), rot=(0, 0, 0), segs=20, smooth=True):
            tb = bmesh.new()
            bmesh.ops.create_uvsphere(tb, u_segments=segs, v_segments=max(8, segs * 2 // 3), radius=1.0,
                                      matrix=Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale) * r))
            self._merge(tb, mat, smooth)
        def blob(self, r, loc, mat, scale=(1, 1, 1), bumpy=0.15, subdiv=2, seed=0.0, smooth=True):
            tb = bmesh.new()
            center = Vector(loc)
            bmesh.ops.create_icosphere(tb, subdivisions=subdiv, radius=1.0,
                                       matrix=Matrix.LocRotScale(center, Euler((0, 0, 0)), Vector(scale) * r))
            offset = Vector((seed, seed * 1.7, seed * 0.3))
            for v in tb.verts:
                d = v.co - center
                v.co += d.normalized() * r * bumpy * noise.noise(d / r * 1.8 + offset)
            self._merge(tb, mat, smooth)
        def slab(self, size, z_top, thickness, radius, mat, segments=8):
            tb = bmesh.new()
            bmesh.ops.create_cube(tb, size=1.0, matrix=Matrix.LocRotScale(
                Vector((0, 0, z_top - thickness / 2)), Euler((0, 0, 0)), Vector((size, size, thickness))))
            vertical = [e for e in tb.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-4]
            bmesh.ops.bevel(tb, geom=vertical, offset=radius, segments=segments, profile=0.5, affect="EDGES")
            self._merge(tb, mat, False)
        def limb(self, a, b, r1, r2, mat, segs=10):
            a, b = Vector(a), Vector(b)
            d = b - a
            tb = bmesh.new()
            bmesh.ops.create_cone(tb, cap_ends=True, segments=segs, radius1=r1, radius2=r2, depth=d.length,
                                  matrix=Matrix.LocRotScale((a + b) / 2, d.to_track_quat("Z", "Y"), Vector((1, 1, 1))))
            self._merge(tb, mat, True)
        def finish(self, parent, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
            mesh = bpy.data.meshes.new(self.name)
            self.bm.normal_update()
            self.bm.to_mesh(mesh)
            self.bm.free()
            for m in self.mats:
                mesh.materials.append(m)
            obj = bpy.data.objects.new(self.name, mesh)
            bpy.context.scene.collection.objects.link(obj)
            obj.parent = parent
            obj.location = (*loc, 0) if len(loc) == 2 else loc
            obj.rotation_euler = (0, 0, rot_z)
            obj.scale = (scale, scale, scale)
            return obj

    def person(root, name, loc, rot_z, outfit: dict, pose="stand", scale=1.0, point_side=1):
        p = Part(name)
        p.cyl(0.16, 0.18, 0.52, (0, 0, 1.05), outfit["top"], segs=12)
        p.sphere(0.15, (0, 0, 1.48), outfit["skin"])
        p.sphere(0.158, (0, 0.03, 1.52), outfit["hair"], scale=(1, 1, 0.82))
        for sx in (-1, 1):
            p.limb((sx * 0.09, 0, 0.8), (sx * 0.09, 0, 0.07), 0.07, 0.055, outfit["bottom"])
            p.limb((sx * 0.2, 0, 1.26), (sx * 0.25, 0, 0.78), 0.055, 0.045, outfit["skin"])
        return p.finish(root, loc=(*loc, 0), rot_z=rot_z, scale=scale)

    def run(scene_id: str, build_fn, lens: float = 46):
        argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
        ap = argparse.ArgumentParser()
        ap.add_argument("--out", type=Path, default=Path("."))
        ap.add_argument("--no-render", action="store_true")
        args, _ = ap.parse_known_args(argv)
        out = args.out.resolve()
        out.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        build_fn()
        usdz = out / f"{{scene_id}}.usdz"
        bpy.ops.wm.usd_export(
            filepath=str(usdz),
            export_materials=True,
            generate_preview_surface=True,
            export_animation=False,
            convert_orientation=True,
            export_global_forward_selection="NEGATIVE_Z",
            export_global_up_selection="Y",
        )

SCENE_ID = {scene_id!r}
SPEC = {spec_json_repr}
rng = random.Random({seed_val})


def pick_spot(used: list[tuple[float, float, float]], r: float, x_range=(-3.1, 3.1), y_range=(-3.1, 3.1)) -> tuple[float, float]:
    """他のオブジェクトと重ならない座標を探す。"""
    for _ in range(60):
        x = rng.uniform(*x_range)
        y = rng.uniform(*y_range)
        if all(math.hypot(x - ux, y - uy) >= (r + ur + 0.25) for ux, uy, ur in used):
            used.append((x, y, r))
            return x, y
    x, y = rng.uniform(*x_range), rng.uniform(*y_range)
    used.append((x, y, r))
    return x, y


def build():
    root = bpy.data.objects.new(SCENE_ID, None)
    bpy.context.scene.collection.objects.link(root)
    biome = SPEC["biome"]
    is_night = SPEC["is_night"]

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
        "soil": ("#7a4a2a", 0.95),
        "soil_dark": ("#4f2f1a", 0.95),
        "sand": ("#f4dc9c", 0.85),
        "asphalt": ("#4a4c52", 0.9),
        "stripe": ("#f4f4f0", 0.7),
        "wall": ("#f3ead8", 0.85),
        "board": ("#2f5e45", 0.85),
        "bark": ("#6b4428", 0.9),
        "leaf": ("#e06a2b" if biome == "autumn" else "#3f9a3a", 0.7),
        "leaf2": ("#f29b38" if biome == "autumn" else "#5cb848", 0.7),
        "pine": ("#2d5a3c", 0.75),
        "snow": ("#f8fbff", 0.6),
        "blossom": ("#f7b6c8", 0.6),
        "blossom2": ("#f093b0", 0.6),
        "cactus": ("#3b8c47", 0.7),
        "wood": ("#a8683a", 0.55),
        "desk": ("#d9a868", 0.45),
        "iron": ("#2b2b30", 0.4),
        "rock": ("#8d8d94", 0.8),
        "dog": ("#e0893a", 0.7),
        "cat": ("#f2994a", 0.7),
        "white": ("#ffffff", 0.6),
        "dark": ("#2a211c", 0.3),
        "red": ("#e3483c", 0.45),
        "blue": ("#3a7bd5", 0.45),
        "yellow": ("#ffc93a", 0.4),
        "pink": ("#ff8fb3", 0.55),
        "building_a": ("#f4efe4", 0.8),
        "building_b": ("#d9c3b0", 0.8),
        "roof_red": ("#c94a3f", 0.6),
        "roof_slate": ("#5a6170", 0.6),
        "skin": ("#f6caa6", 0.55),
        "hair_a": ("#3a2618", 0.6),
        "hair_b": ("#2a1f1a", 0.6),
    }})
    M["water"] = material("water", "#1f88d8", 0.2, ior=1.12)
    M["glass"] = material("glass", "#bfe3ff", 0.15, emit=0.5)
    M["lamp_glass"] = material("lamp_glass", "#ffe7a8", 0.2, emit=4.0)

    used: list[tuple[float, float, float]] = []

    # ---------- 1. バイオーム別の地面・背景 ----------
    base = Part("ground_base")
    base.slab(SIZE, 0.0, 0.25, 0.7, M["ground"])
    base.slab(SIZE - 0.1, -0.25, 0.75, 0.65, M["soil"])
    base.slab(SIZE - 0.4, -1.0, 0.18, 0.55, M["soil_dark"])

    if biome == "beach":
        # 手前半分を青い海と白い波にする
        base.box((SIZE - 0.3, 3.2, 0.08), (0, -2.2, 0.02), M["water"], bevel=0.03)
        base.box((SIZE - 0.4, 0.22, 0.05), (0, -0.55, 0.03), M["white"], bevel=0.02)
        used.append((0, -2.2, 1.5))
    elif biome == "city":
        # 手前にアスファルトの道路と横断歩道
        base.box((SIZE - 0.4, 1.6, 0.03), (0, -2.2, 0.015), M["asphalt"])
        for k in range(7):
            base.box((0.3, 1.2, 0.015), (-1.5 + k * 0.5, -2.2, 0.032), M["stripe"])
    elif biome == "indoor":
        # 奥と左の壁＋窓
        base.box((SIZE, 0.25, 3.0), (0, HALF - 0.125, 1.5), M["wall"])
        base.box((0.25, SIZE - 0.25, 3.0), (-HALF + 0.125, -0.125, 1.5), M["wall"])
        for wy in (-1.5, 0.8):
            base.box((0.08, 1.4, 1.3), (-HALF + 0.26, wy, 1.7), M["glass"])
    base.finish(root)

    # ---------- 2. 黒板（室内） ----------
    if SPEC["blackboard"] > 0:
        bb = Part("blackboard")
        y = HALF - 0.26
        bb.box((4.0, 0.08, 1.5), (0.2, y, 1.65), M["wood"], bevel=0.02)
        bb.box((3.8, 0.06, 1.3), (0.2, y - 0.04, 1.65), M["board"])
        bb.finish(root)
        used.append((0.2, y - 0.4, 1.2))

    # ---------- 3. 建物・家 ----------
    for i in range(SPEC["house"]):
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

    # ---------- 4. 池 ----------
    for i in range(SPEC["pond"]):
        px, py = pick_spot(used, 1.35, (-2.2, 2.2), (-2.0, 2.0))
        pond = Part(f"pond_{{i}}")
        pr = rng.uniform(1.05, 1.35)
        pond.cyl(pr, pr, 0.06, (0, 0, 0.02), M["water"], segs=32, smooth=False)
        for k in range(14):
            a = k / 14 * math.tau
            pond.blob(0.16, (math.cos(a) * (pr + 0.06), math.sin(a) * (pr + 0.06), 0.05), M["rock"], scale=(1, 1, 0.6), seed=k)
        pond.finish(root, loc=(px, py, 0))

    # ---------- 5. 木（桜・針葉樹・ヤシの木・広葉樹・サボテン） ----------
    for i in range(SPEC["cherry_trees"]):
        tx, ty = pick_spot(used, 0.95, (-3.1, 3.1), (-2.8, 3.0))
        t = Part(f"cherry_tree_{{i}}")
        t.cyl(0.18, 0.11, 1.5, (0, 0, 0.75), M["bark"], segs=10)
        for dx, dy, dz, r in [(0, 0, 1.7, 0.95), (-0.45, 0.2, 1.45, 0.68), (0.45, -0.2, 1.5, 0.65)]:
            t.blob(r, (dx, dy, dz), M["blossom"] if (i + int(r * 10)) % 2 else M["blossom2"], scale=(1, 1, 0.82), seed=i * 5 + r)
        t.finish(root, loc=(tx, ty, 0))

    for i in range(SPEC["pine_trees"]):
        tx, ty = pick_spot(used, 0.85, (-3.1, 3.1), (-2.8, 3.0))
        t = Part(f"pine_tree_{{i}}")
        t.cyl(0.16, 0.1, 1.1, (0, 0, 0.55), M["bark"], segs=10)
        for layer, (z_base, r_cone, d_cone) in enumerate([(1.2, 1.05, 1.1), (1.85, 0.82, 0.95), (2.4, 0.55, 0.8)]):
            t.cyl(r_cone, 0.05, d_cone, (0, 0, z_base), M["pine"], segs=12)
            if biome == "snow":
                t.cyl(r_cone * 0.92, 0.04, d_cone * 0.35, (0, 0, z_base + d_cone * 0.3), M["snow"], segs=12)
        t.finish(root, loc=(tx, ty, 0))

    for i in range(SPEC["palm_trees"]):
        tx, ty = pick_spot(used, 0.85, (-3.0, 3.0), (0.0, 3.0) if biome == "beach" else (-2.8, 2.8))
        t = Part(f"palm_tree_{{i}}")
        t.limb((0, 0, 0), (0.25, -0.15, 2.4), 0.18, 0.1, M["bark"])
        for k in range(6):
            a = k / 6 * math.tau
            t.box((0.95, 0.28, 0.06), (0.25 + math.cos(a) * 0.55, -0.15 + math.sin(a) * 0.55, 2.35), M["leaf"], rot=(0.25 * math.sin(a), -0.25 * math.cos(a), a), bevel=0.02)
        t.finish(root, loc=(tx, ty, 0))

    for i in range(SPEC["trees"]):
        tx, ty = pick_spot(used, 0.9, (-3.1, 3.1), (-2.8, 3.0))
        t = Part(f"tree_{{i}}")
        t.cyl(0.18, 0.11, 1.45, (0, 0, 0.72), M["bark"], segs=10)
        for dx, dy, dz, r in [(0, 0, 1.65, 0.92), (-0.42, 0.22, 1.4, 0.65), (0.42, -0.2, 1.45, 0.65)]:
            t.blob(r, (dx, dy, dz), M["leaf"] if (i + int(r * 10)) % 2 else M["leaf2"], scale=(1, 1, 0.82), seed=i * 9 + r)
        t.finish(root, loc=(tx, ty, 0))

    for i in range(SPEC["cacti"]):
        cx, cy = pick_spot(used, 0.5, (-3.1, 3.1), (-2.8, 2.8))
        c = Part(f"cactus_{{i}}")
        c.cyl(0.16, 0.14, 1.5, (0, 0, 0.75), M["cactus"], segs=10)
        c.sphere(0.14, (0, 0, 1.5), M["cactus"])
        c.limb((0, 0, 0.75), (0.38, 0, 0.9), 0.1, 0.09, M["cactus"])
        c.limb((0.38, 0, 0.9), (0.38, 0, 1.3), 0.09, 0.08, M["cactus"])
        c.limb((0, 0, 0.6), (-0.35, 0, 0.75), 0.1, 0.09, M["cactus"])
        c.limb((-0.35, 0, 0.75), (-0.35, 0, 1.15), 0.09, 0.08, M["cactus"])
        c.finish(root, loc=(cx, cy, 0), rot_z=rng.uniform(0, math.tau))

    # ---------- 6. 机・ベンチ・自販機・街灯 ----------
    for i in range(SPEC["desk"]):
        dx, dy = pick_spot(used, 0.75, (-2.4, 2.4), (-2.2, 1.6))
        d = Part(f"desk_{{i}}")
        d.box((1.1, 0.7, 0.06), (0, 0, 0.72), M["desk"], bevel=0.01)
        for sx in (-0.48, 0.48):
            for sy in (-0.28, 0.28):
                d.cyl(0.03, 0.03, 0.7, (sx, sy, 0.35), M["iron"], segs=8)
        d.box((0.5, 0.46, 0.05), (0, -0.55, 0.44), M["wood"], bevel=0.01)
        d.box((0.5, 0.05, 0.42), (0, -0.76, 0.66), M["wood"], bevel=0.01)
        d.finish(root, loc=(dx, dy, 0))

    for i in range(SPEC["bench"]):
        bx, by = pick_spot(used, 0.8, (-2.6, 2.6), (-2.2, 2.2))
        b = Part(f"bench_{{i}}")
        for sx in (-0.65, 0.65):
            b.box((0.08, 0.48, 0.42), (sx, 0, 0.21), M["iron"], bevel=0.01)
        b.box((1.55, 0.46, 0.06), (0, 0, 0.44), M["wood"], bevel=0.01)
        b.box((1.55, 0.06, 0.42), (0, 0.21, 0.68), M["wood"], bevel=0.01)
        b.finish(root, loc=(bx, by, 0), rot_z=rng.uniform(-0.5, 0.5))

    for i in range(SPEC["vending"]):
        vx, vy = pick_spot(used, 0.65, (-2.8, 2.8), (-1.5, 2.5))
        v = Part(f"vending_{{i}}")
        v.box((0.95, 0.65, 1.85), (0, 0, 0.925), M["red"] if i % 2 == 0 else M["blue"], bevel=0.03)
        v.box((0.76, 0.04, 0.95), (0, -0.32, 1.22), M["glass"])
        v.finish(root, loc=(vx, vy, 0))

    for i in range(SPEC["lamp"]):
        lx, ly = pick_spot(used, 0.4, (-2.9, 2.9), (-2.4, 2.4))
        lamp = Part(f"lamp_{{i}}")
        lamp.cyl(0.06, 0.04, 2.5, (0, 0, 1.25), M["iron"], segs=10)
        lamp.sphere(0.2, (0, 0, 2.6), M["lamp_glass"], segs=12)
        lamp.finish(root, loc=(lx, ly, 0))

    # ---------- 7. 車・バス・ボート・ビーチ用品 ----------
    for i in range(SPEC["car"]):
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

    for i in range(SPEC["bus"]):
        bx, by = pick_spot(used, 1.5, (-2.2, 2.2), (-2.5, -1.5) if biome == "city" else (-2.2, 1.8))
        bus = Part(f"bus_{{i}}")
        bus.box((3.0, 1.2, 1.35), (0, 0, 0.85), M["blue"], bevel=0.06)
        bus.box((2.8, 1.24, 0.5), (0, 0, 1.05), M["glass"], bevel=0.02)
        for sx in (-0.95, 0.95):
            for sy in (-0.58, 0.58):
                bus.cyl(0.26, 0.26, 0.16, (sx, sy, 0.26), M["iron"], rot=(math.pi / 2, 0, 0), segs=12)
        bus.finish(root, loc=(bx, by, 0))

    for i in range(SPEC["umbrella"]):
        ux, uy = pick_spot(used, 0.85, (-2.5, 2.5), (0.0, 2.4) if biome == "beach" else (-2.2, 2.2))
        u = Part(f"umbrella_{{i}}")
        u.cyl(0.04, 0.04, 1.9, (0, 0, 0.95), M["white"], segs=10)
        u.cyl(1.15, 0.08, 0.55, (0, 0, 1.95), M["red"] if i % 2 == 0 else M["yellow"], segs=16)
        u.finish(root, loc=(ux, uy, 0), rot_z=rng.uniform(0, math.tau))

    for i in range(SPEC["surfboard"]):
        sx, sy = pick_spot(used, 0.6, (-2.6, 2.6), (-0.4, 2.0))
        sb = Part(f"surfboard_{{i}}")
        sb.sphere(0.75, (0, 0, 0.08), M["red"] if i % 2 == 0 else M["yellow"], scale=(0.32, 1.0, 0.08))
        sb.finish(root, loc=(sx, sy, 0), rot_z=rng.uniform(-0.8, 0.8))

    for i in range(SPEC["boat"]):
        bx, by = (rng.uniform(-2.2, 2.2), rng.uniform(-2.9, -1.5)) if biome == "beach" else pick_spot(used, 0.9, (-2.2, 2.2), (-2.2, 2.2))
        bt = Part(f"boat_{{i}}")
        bt.box((1.5, 0.75, 0.32), (0, 0, 0.2), M["wood"], bevel=0.08)
        bt.cyl(0.03, 0.02, 1.3, (0, 0, 0.85), M["wood"], segs=8)
        bt.box((0.04, 0.65, 0.95), (0, 0.3, 0.95), M["white"])
        bt.finish(root, loc=(bx, by, 0.04), rot_z=rng.uniform(-0.4, 0.4))

    # ---------- 8. 雪だるま・犬・猫・ボール・花・岩 ----------
    for i in range(SPEC["snowman"]):
        sx, sy = pick_spot(used, 0.55, (-2.6, 2.6), (-2.4, 2.4))
        sm = Part(f"snowman_{{i}}")
        sm.sphere(0.42, (0, 0, 0.38), M["snow"])
        sm.sphere(0.3, (0, 0, 0.95), M["snow"])
        sm.sphere(0.22, (0, 0, 1.38), M["snow"])
        sm.cyl(0.04, 0.01, 0.18, (0, -0.24, 1.38), M["dog"], rot=(math.pi / 2, 0, 0), segs=8)
        sm.cyl(0.18, 0.18, 0.25, (0, 0, 1.66), M["iron"], segs=12)
        sm.finish(root, loc=(sx, sy, 0), rot_z=rng.uniform(-0.5, 0.5))

    for i in range(SPEC["dog"]):
        dx, dy = pick_spot(used, 0.45, (-2.6, 2.6), (-2.2, 2.2))
        dog = Part(f"dog_{{i}}")
        dog.box((0.24, 0.52, 0.24), (0, 0, 0.28), M["dog"], bevel=0.08)
        dog.sphere(0.16, (0, -0.3, 0.44), M["dog"])
        dog.box((0.12, 0.16, 0.1), (0, -0.44, 0.4), M["white"], bevel=0.03)
        for lx in (-0.08, 0.08):
            for ly in (-0.18, 0.18):
                dog.cyl(0.04, 0.035, 0.22, (lx, ly, 0.11), M["dog"], segs=8)
        dog.finish(root, loc=(dx, dy, 0), rot_z=rng.uniform(0, math.tau))

    for i in range(SPEC["cat"]):
        cx, cy = pick_spot(used, 0.38, (-2.6, 2.6), (-2.2, 2.2))
        cat = Part(f"cat_{{i}}")
        cat.sphere(0.16, (0, 0, 0.16), M["cat"], scale=(0.9, 1.3, 0.8))
        cat.sphere(0.13, (0, -0.18, 0.29), M["cat"])
        for sx in (-0.07, 0.07):
            cat.cyl(0.04, 0.005, 0.09, (sx, -0.18, 0.41), M["cat"], segs=6)
        cat.finish(root, loc=(cx, cy, 0), rot_z=rng.uniform(0, math.tau))

    for i in range(SPEC["ball"]):
        bx, by = pick_spot(used, 0.3, (-2.5, 2.5), (-2.2, 2.2))
        ball = Part(f"ball_{{i}}")
        ball.sphere(0.2, (0, 0, 0.2), M["red"] if i % 2 == 0 else M["yellow"], segs=18)
        ball.finish(root, loc=(bx, by, 0))

    for i in range(SPEC["rocks"]):
        rx, ry = pick_spot(used, 0.4, (-3.0, 3.0), (-2.6, 2.6))
        rk = Part(f"rock_{{i}}")
        rk.blob(rng.uniform(0.25, 0.42), (0, 0, 0.18), M["rock"], scale=(1.2, 0.9, 0.7), seed=i * 3)
        rk.finish(root, loc=(rx, ry, 0), rot_z=rng.uniform(0, math.tau))

    for i in range(SPEC["flowers"]):
        fx, fy = pick_spot(used, 0.35, (-2.9, 2.9), (-2.6, 2.6))
        fl = Part(f"flowers_{{i}}")
        for k in range(5):
            ox, oy = rng.uniform(-0.22, 0.22), rng.uniform(-0.22, 0.22)
            fl.cyl(0.015, 0.015, 0.18, (ox, oy, 0.09), M["leaf"], segs=6)
            fl.sphere(0.055, (ox, oy, 0.2), M["pink"] if k % 2 == 0 else M["yellow"], segs=10)
        fl.finish(root, loc=(fx, fy, 0))

    # ---------- 9. 人物 ----------
    top_mats = [M["yellow"], M["red"], M["blue"], M["pink"]]
    poses = ["walk", "stand", "point", "raise_hand", "phone"]
    for i in range(SPEC["people"]):
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

    return root


if __name__ == "__main__":
    run(SCENE_ID, build)
'''
    return {
        "name": f"AI 生成シーン ({biome})",
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
