"""アイコンの元にする公園のシーンを、背景を透過にして正方形で描く（Blender で動かす）。

    blender --background --factory-startup --python scripts/app-icon/render_park.py -- --out scripts/app-icon/build/park.png

scripts/scene/park.py の build() を、common.run を差し替えてから読み込んで使う
（park.py は読み込むと run("park", build) を呼ぶので、USDZ の書き出しと 16:10 の描画を飛ばす）。
描いた画像は scripts/app-icon/build.py がグラデーションの上に置いてアイコンにする。
"""

import argparse
import math
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scene"))

import common  # noqa: E402


def render(scene_id: str, build, lens: float = 46, env: dict | None = None) -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="render_park.py")
    ap.add_argument("--out", type=Path, default=HERE / "build" / "park.png")
    ap.add_argument("--samples", type=int, default=128)
    ap.add_argument("--size", type=int, default=1600)
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = build()
    root.rotation_euler = (0, 0, math.radians(-38))
    common.setup_render(args.samples, lens, env)
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    # 正方形にすると上下が詰まるので、少し引いて全体を入れる
    scene.camera.data.lens = lens * 0.8
    scene.render.filepath = str(args.out.resolve())
    bpy.ops.render.render(write_still=True)
    print(f"wrote {args.out}")


common.run = render
import park  # noqa: E402,F401  読み込むと build() が組まれ、上の render が呼ばれる
