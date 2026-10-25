"""ホログラム用の映像（縄跳び）を作る。黒い背景に蛍光色の物だけが浮かび、ゆっくり回る。

ペットボトルや透明の板に反射させて見せる「ホログラム」の素材。物は少なく単純にし、
英語では「同時に起きていること」や数・位置まで言わないと満点にならないようにしている。

  <out>/jump_rope.mp4          アプリが流す映像（反転なし。ホログラムを選んだ端末では、アプリが左右反転して出す）
  <out>/jump_rope_mirror.mp4   アプリを使わずにスマホなどで流す用（反射で反転するので、左右を反転してある）
  <out>/jump_rope.png          確認用の 1 枚（反転なし）

1 回跳ぶのに 1 秒、全体は 20 秒で 1 周する。ホログラムで遊ぶ 1 回の長さ（20 秒）と同じで、繰り返し再生しても継ぎ目が出ない。

使い方:
  blender --background --factory-startup --python scripts/scene/hologram_jump_rope.py -- [--out assets/holograms] [--size 1080] [--samples 32]
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REPO, Part, material, person  # noqa: E402

FPS = 30
JUMP_FRAMES = 30          # 1 回跳ぶのにかかるフレーム（1 秒）
TURN_FRAMES = 600         # 1 周（20 秒）。ホログラムで遊ぶ 1 回の長さに合わせ、動画が終わったら結果へ進める
JUMP_HEIGHT = 0.28        # 女の子が跳ぶ高さ（m）
DOG_JUMP_HEIGHT = 0.22
ROPE_RADIUS = 0.97        # 縄の弧の大きさ。足の下（地面より少し下）を通るように
HAND_DZ = -0.38           # 手の高さ（肩からの差）
HAND_X = 0.38             # 手の左右の位置
STAND_SH_Z = 1.3          # 立つポーズの肩の高さ（common.person の stand）
M: dict = {}


def neon(name: str, color: str, strength: float = 4.0):
    """蛍光色。自分で光らせて、黒い背景の上ではっきり見せる。"""
    return material(name, color, 0.4, emit=strength)


def make_materials() -> None:
    M.update({
        "skin": material("skin", "#ffc9a3", 0.5, emit=0.35),
        "eye": neon("eye", "#3a2cff", 2.0),
        "cheek": neon("cheek", "#ff5fa2", 2.0),
        "mouth": neon("mouth", "#ff2d6f", 2.0),
        "hair": neon("hair", "#9b30ff", 1.6),
        "hoodie": neon("hoodie", "#ff1fc8", 1.5),
        "shorts": neon("shorts", "#5cff1f", 1.3),
        "sneaker": neon("sneaker", "#ffe600", 1.8),
        "rope": neon("rope", "#00f0ff", 6.0),   # 縄だけをシアンにして目立たせる
        "handle": neon("handle", "#ff8a00", 5.0),
        "dog": neon("dog", "#ff7a00", 1.5),
        "dog_light": neon("dog_light", "#ffc23a", 1.3),
        "dog_dark": neon("dog_dark", "#3a2cff", 2.0),
        "ring": neon("ring", "#ff2bd6", 6.0),
        "ring2": neon("ring2", "#00f0ff", 5.0),
        "counter": neon("counter", "#ffe600", 6.0),
        "star_a": neon("star_a", "#7dff2b", 8.0),
        "star_b": neon("star_b", "#00f0ff", 8.0),
        "star_c": neon("star_c", "#ff2bd6", 8.0),
    })


# ---------- 部品 ----------

def build_rope(parent, hand_z: float):
    """縄。持ち手のあいだの軸（X 軸）の周りを回る。回す前は頭の上（+Z）に弧がある。"""
    p = Part("jump_rope")
    hx = HAND_X
    pts = []
    n = 32
    for k in range(n + 1):
        # 持ち手から外へふくらむ、幅の広い U の字（だ円の半分）
        t = k / n
        s = math.sin(math.pi * t)
        pts.append(Vector((-math.cos(math.pi * t) * (hx + 0.1 * s), 0, ROPE_RADIUS * s)))
    for a, b in zip(pts, pts[1:]):
        p.limb(a, b, 0.028, 0.028, M["rope"], segs=8)
        p.sphere(0.028, tuple(b), M["rope"], segs=8)
    for sx in (-1, 1):   # 持ち手
        p.limb((sx * hx, 0, -0.07), (sx * hx, 0, 0.07), 0.03, 0.03, M["handle"], segs=10)
    obj = p.finish(parent, loc=(0, -0.08, hand_z))
    return obj


def build_dog(parent, loc, rot_z):
    """一緒に跳ねる小さな犬。正面は -Y。"""
    p = Part("dog")
    p.sphere(0.17, (0, 0.02, 0.36), M["dog"], scale=(1, 1.7, 0.95))
    p.sphere(0.13, (0, -0.22, 0.35), M["dog_light"], scale=(1, 0.8, 1.05))
    p.sphere(0.15, (0, -0.38, 0.58), M["dog"])
    p.sphere(0.08, (0, -0.5, 0.54), M["dog_light"], scale=(1, 1.15, 0.8))
    p.sphere(0.028, (0, -0.6, 0.57), M["dog_dark"], segs=10)
    for sx in (-1, 1):
        p.sphere(0.022, (sx * 0.065, -0.5, 0.63), M["dog_dark"], segs=10)
        p.cyl(0.06, 0.0, 0.13, (sx * 0.08, -0.36, 0.74), M["dog"], rot=(-0.15, sx * 0.3, 0), segs=4, smooth=False)
        # 跳んでいる脚（前脚は前へ、後ろ脚は後ろへ伸ばす）
        p.limb((sx * 0.09, -0.2, 0.3), (sx * 0.09, -0.36, 0.08), 0.045, 0.04, M["dog"], segs=10)
        p.limb((sx * 0.09, 0.22, 0.3), (sx * 0.09, 0.38, 0.1), 0.045, 0.04, M["dog"], segs=10)
        p.sphere(0.045, (sx * 0.09, -0.37, 0.07), M["dog_light"], segs=10)
        p.sphere(0.045, (sx * 0.09, 0.39, 0.09), M["dog_light"], segs=10)
    for k in range(6):   # 上を向いたしっぽ
        a = k / 6 * math.pi * 0.9
        p.sphere(0.05 - k * 0.005, (0, 0.33 + math.sin(a) * 0.08, 0.5 + (1 - math.cos(a)) * 0.1 + k * 0.02),
                 M["dog"] if k < 5 else M["dog_light"], segs=10)
    return p.finish(parent, loc=loc, rot_z=rot_z)


def build_ring(parent):
    """足もとの光る輪（2 重）。"""
    p = Part("glowing_ring")
    for r, mat, tube in ((1.15, M["ring"], 0.025), (0.98, M["ring2"], 0.015)):
        n = 72
        for k in range(n):
            a, b = k / n * math.tau, (k + 1) / n * math.tau
            p.limb((math.cos(a) * r, math.sin(a) * r, 0), (math.cos(b) * r, math.sin(b) * r, 0), tube, tube, mat, segs=8)
    return p.finish(parent)


def build_stars(parent):
    """まわりに浮かぶ小さな光の粒。"""
    p = Part("sparkles")
    spots = [(1.35, 0.3, 1.6), (-1.3, -0.2, 1.2), (0.9, -0.9, 2.0), (-0.8, 0.9, 1.9),
             (1.1, 0.8, 0.6), (-1.2, -0.7, 0.5), (0.2, 1.3, 1.3), (-1.0, -1.1, 2.1)]
    mats = [M["star_a"], M["star_b"], M["star_c"]]
    for i, (x, y, z) in enumerate(spots):
        p.sphere(0.05, (x, y, z), mats[i % 3], scale=(1, 1, 1.6), segs=4, smooth=False)
        p.sphere(0.05, (x, y, z), mats[i % 3], scale=(1.6, 1, 1), segs=4, smooth=False)
    return p.finish(parent)


def build_counter():
    """上に浮かぶ「100」の数字（回さず、いつも正面を向く）。"""
    curve = bpy.data.curves.new("counter", "FONT")
    curve.body = "100"
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = 0.42
    curve.extrude = 0.03
    obj = bpy.data.objects.new("counter", curve)
    obj.data.materials.append(M["counter"])
    obj.location = (0, 0.4, 2.45)
    obj.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# ---------- 動き ----------

def hop(frame: int, height: float) -> float:
    """1 回の跳び（地面から上がって戻る）。"""
    t = ((frame - 1) % JUMP_FRAMES) / JUMP_FRAMES
    return height * math.sin(math.pi * t)


def animate(root, girl, rope, dog) -> None:
    end = TURN_FRAMES + 1
    for f in range(1, end + 1):
        girl.location.z = hop(f, JUMP_HEIGHT)
        girl.keyframe_insert("location", index=2, frame=f)
        dog.location.z = hop(f, DOG_JUMP_HEIGHT)
        dog.keyframe_insert("location", index=2, frame=f)
        # 縄: 跳び始めは頭の上、いちばん高く跳んだとき（半分）に足の下を通る
        t = ((f - 1) % JUMP_FRAMES) / JUMP_FRAMES
        rope.rotation_euler.x = 2 * math.pi * t
        rope.keyframe_insert("rotation_euler", index=0, frame=f)
    root.rotation_euler.z = 0.0
    root.keyframe_insert("rotation_euler", index=2, frame=1)
    root.rotation_euler.z = 2 * math.pi
    root.keyframe_insert("rotation_euler", index=2, frame=end)
    for obj in (root, girl, rope, dog):
        for fc in obj.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"


# ---------- 組み立てと書き出し ----------

def build_scene():
    root = bpy.data.objects.new("jump_rope", None)
    bpy.context.scene.collection.objects.link(root)
    outfit = {"skin": M["skin"], "hair": M["hair"], "top": M["hoodie"], "bottom": M["shorts"], "shoe": M["sneaker"],
              "eye": M["eye"], "cheek": M["cheek"], "mouth": M["mouth"], "hair_style": "bun"}
    girl = person(root, "girl_jumping_rope", (-0.25, 0.0), 0.0, outfit,
                  hands=[(-HAND_X, -0.08, HAND_DZ), (HAND_X, -0.08, HAND_DZ)])
    rope = build_rope(girl, STAND_SH_Z + HAND_DZ)
    dog = build_dog(root, (0.85, -0.1), -0.35)
    build_ring(root)
    build_stars(root)
    build_counter()
    animate(root, girl, rope, dog)
    return root


def setup_render(size: int, samples: int) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = samples
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, TURN_FRAMES
    scene.view_settings.view_transform = "Standard"   # 蛍光色をくすませない
    scene.view_settings.exposure = 0.0

    world = bpy.data.worlds.new("black")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    scene.world = world

    # 肌や服に陰影を付けるための弱い光（色は物そのものの光が主）
    key = bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA"))
    key.data.energy = 300
    key.data.size = 3
    key.location = (2.5, -3.5, 4.0)
    key.rotation_euler = (Vector((0, 0, 1.0)) - key.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(key)

    cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    cam.location = (0, -7.5, 1.6)
    target = Vector((0, 0, 1.15))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 80
    scene.collection.objects.link(cam)
    scene.camera = cam


def setup_compositor(flip: bool) -> None:
    """光のにじみ（グロー）を足し、ホログラム用は左右を反転する。"""
    scene = bpy.context.scene
    scene.use_nodes = True
    nt = scene.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    glare = nt.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    for name, value in (("quality", "HIGH"), ("size", 8), ("threshold", 0.6)):
        if hasattr(glare, name):
            setattr(glare, name, value)
    for name, value in (("Threshold", 0.6), ("Size", 0.7), ("Strength", 1.0)):
        if name in glare.inputs:
            glare.inputs[name].default_value = value
    out = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(rl.outputs["Image"], glare.inputs["Image"])
    last = glare.outputs["Image"]
    if flip:
        fl = nt.nodes.new("CompositorNodeFlip")
        fl.axis = "X"
        nt.links.new(last, fl.inputs["Image"])
        last = fl.outputs["Image"]
    nt.links.new(last, out.inputs["Image"])


def render_video(path: Path, flip: bool) -> None:
    scene = bpy.context.scene
    setup_compositor(flip)
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.ffmpeg.audio_codec = "NONE"
    scene.render.filepath = str(path)
    bpy.ops.render.render(animation=True)
    print(f"wrote {path}")


def render_still(path: Path, frame: int) -> None:
    scene = bpy.context.scene
    setup_compositor(flip=False)
    scene.frame_set(frame)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print(f"wrote {path}")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="hologram_jump_rope.py")
    ap.add_argument("--out", type=Path, default=REPO / "assets" / "holograms")
    ap.add_argument("--size", type=int, default=1080)
    ap.add_argument("--samples", type=int, default=32)
    ap.add_argument("--still-only", action="store_true", help="確認用の 1 枚だけ作る")
    args = ap.parse_args(argv)
    out: Path = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    build_scene()
    setup_render(args.size, args.samples)
    # 縄が足の下を通る瞬間（いちばん高く跳んだとき）を、ほぼ正面から
    render_still(out / "jump_rope.png", JUMP_FRAMES // 2 + 1)
    if args.still_only:
        return
    render_video(out / "jump_rope.mp4", flip=False)
    render_video(out / "jump_rope_mirror.mp4", flip=True)


main()
