"""アプリのアイコン（1024x1024、透過なし）を、公園のシーンの画像から作る。

    blender --background --factory-startup --python scripts/app-icon/render_park.py   # 透過の公園を描く
    uv run --with pillow python3 scripts/app-icon/build.py

render_park.py が描いた scripts/app-icon/build/park.png（背景が透過。build/ は commit しない）を切り抜き、テーマの色（Theme.accentSoft → 白）の
グラデーションの上に置いて、ios/NG2622/Assets.xcassets/AppIcon.appiconset/AppIcon.png に書く。
App Store のアイコンは透過を許さないので RGB で保存する。角の丸めは iOS が行うので付けない。
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "scripts/app-icon/build/park.png"
OUT = ROOT / "ios/NG2622/Assets.xcassets/AppIcon.appiconset/AppIcon.png"

SIZE = 1024
# 上から下へのグラデーション（Theme.accentSoft の薄紫 → Theme.background に近い白）
TOP = (0xD9, 0xD9, 0xFA)
BOTTOM = (0xF7, 0xF7, 0xFB)
# 場面がアイコンの幅に占める割合（iOS の角丸で端が切れないよう余白を残す）
SCENE_WIDTH = 0.86


def gradient() -> Image.Image:
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        c = tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM))
        for x in range(SIZE):
            px[x, y] = c
    return img


def main() -> None:
    scene = Image.open(SRC).convert("RGBA")
    scene = scene.crop(scene.getchannel("A").getbbox())
    w = round(SIZE * SCENE_WIDTH)
    h = round(scene.height * w / scene.width)
    scene = scene.resize((w, h), Image.LANCZOS)

    icon = gradient()
    # 見た目の重心が少し下がるので、わずかに上へ寄せる
    icon.paste(scene, ((SIZE - w) // 2, (SIZE - h) // 2 - SIZE // 40), scene)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUT, "PNG")
    print(f"wrote {OUT.relative_to(ROOT)} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
