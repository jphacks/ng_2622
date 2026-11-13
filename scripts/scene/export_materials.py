"""parts.py の make_materials() の材質（名前・色・粗さなど）を、サーバーの部品の組み立てが読む JSON に書き出す。

サーバー（backend/src/parts/）は Claude に書かせた部品表を USDZ に組むとき、材質を名前で選ばせ、色などはこの JSON から引く。
parts.py は bpy を読み込むので、Blender は使わずに make_materials() の本体だけを取り出し、material()・materials() の
まね（common.py と同じ色の直し方）で動かす。parts.py の材質を変えたら、このスクリプトを回し直して commit する。

  python3 -I scripts/scene/export_materials.py   # backend/src/parts/materials.json を書き、Biome で整形する

JSON の 1 件: {"hex": "#rrggbb", "base": [r, g, b]（リニア）, "rough", "metal", "emit", "alpha"}
（coat・ior・trans は USDZ に出さないので書かない）
"""
from __future__ import annotations

import ast
import json
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PARTS_PY = REPO / "scripts" / "scene" / "parts.py"
OUT = REPO / "backend" / "src" / "parts" / "materials.json"


def srgb(hex_color: str) -> list[float]:
    """#rrggbb を Blender が使うリニアの色に直す（common.py の srgb と同じ）。"""
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = hex_color.lstrip("#")
    return [round(lin(int(h[i:i + 2], 16) / 255), 5) for i in (0, 2, 4)]


def main() -> None:
    tree = ast.parse(PARTS_PY.read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "make_materials")
    made: dict[str, dict] = {}

    def material(name, color, rough=0.6, metal=0.0, emit=0.0, coat=0.0, ior=None, trans=0.0, alpha=1.0):
        # common.material() と同じく、同じ名前は最初に作ったものを返す
        if name not in made:
            made[name] = {"hex": color.lower(), "base": srgb(color), "rough": rough, "metal": metal,
                          "emit": emit, "alpha": alpha}
        return made[name]

    def materials(spec):
        return {name: material(name, color, rough) for name, (color, rough) in spec.items()}

    M: dict[str, dict] = {}
    scope = {"M": M, "material": material, "materials": materials}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), str(PARTS_PY), "exec"), scope)
    scope["make_materials"]()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(M, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    subprocess.run(["pnpm", "exec", "biome", "format", "--write", str(OUT)], cwd=REPO, check=True)
    print(f"wrote {OUT} ({len(M)} materials)")


main()
