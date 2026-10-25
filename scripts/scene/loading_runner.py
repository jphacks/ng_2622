"""待ち時間に出す「走る人」を、部品の人物と同じ見た目で 3D に作り、ひと回り分の連番 png に書き出す。

動きは人が実際に走ったモーションキャプチャ（CMU Graphics Lab Motion Capture Database の 09_01 "run"、
BVH は cgspeed の変換を https://github.com/Shriinivas/cmubvh から取得。CMU は使い道に制限を設けていない）を写す。
assets/mocap/cmu_09_01_run.bvh から右足の着地 2 回のあいだ（1 歩きっかり 2 歩）を切り出し、その場で走るように
前への移動を差し引く。骨の向きだけを写し、長さは部品の人物（common.py の person()）の寸法に置き換える。
人物はコマごとに作り直して撮る。背景は透明。足もとの影はアプリ側で楕円を敷く。

  ios/NG2622/Design/Loading/runner_00.png 〜 runner_<n-1>.png   ひと回り分のコマ（正方形・背景透明）

ひと回りの秒数は最後に表示する（アプリの LoadingRunner の fps は「コマ数 ÷ その秒数」にする）。

使い方:
  blender --background --factory-startup --python scripts/scene/loading_runner.py -- [--frames 24] [--size 480] [--samples 48] [--out <dir>]
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REPO, Part, materials, srgb  # noqa: E402

BVH = REPO / "assets" / "mocap" / "cmu_09_01_run.bvh"

# 部品の人物（common.py の person() と parts.py の adult_a）と同じ寸法と色
HIP_Z = 0.8
SH_Z = HIP_Z + 0.5
THIGH, SHIN = 0.37, 0.36
UPPER_ARM, FOREARM = 0.24, 0.22
ANKLE_Z = 0.07   # 足を床にべったりつけたときの足首の高さ

# 部品の人物の左（+X、正面が -Y なので）を BVH の Left* に当てる
JOINTS = {
    "hips": "Hips", "neck": "Neck",
    "hip_l": "LeftUpLeg", "knee_l": "LeftLeg", "ankle_l": "LeftFoot", "toe_l": "LeftToeBase",
    "hip_r": "RightUpLeg", "knee_r": "RightLeg", "ankle_r": "RightFoot", "toe_r": "RightToeBase",
    "sh_l": "LeftArm", "elbow_l": "LeftForeArm", "hand_l": "LeftHand",
    "sh_r": "RightArm", "elbow_r": "RightForeArm", "hand_r": "RightHand",
}


def make_outfit() -> dict:
    return materials({
        "skin": ("#f6caa6", 0.55), "eye": ("#2a211c", 0.3), "cheek": ("#f59a9a", 0.7), "mouth": ("#a8463d", 0.5),
        "hair": ("#2a1f1a", 0.6), "top": ("#5a8fd6", 0.7), "bottom": ("#4a4f5a", 0.7), "shoe": ("#6b4428", 0.5),
    })


# ---------- モーションキャプチャを読む ----------

def read_mocap() -> tuple[list[dict], float]:
    """BVH を読み込み、コマごとの関節の位置（Blender の座標）と 1 コマの秒数を返す。"""
    bpy.ops.import_anim.bvh(filepath=str(BVH), global_scale=1.0, rotate_mode="NATIVE", update_scene_fps=False,
                            update_scene_duration=True)
    arm = bpy.context.active_object
    scene = bpy.context.scene
    frames = []
    first, last = (int(x) for x in arm.animation_data.action.frame_range)
    # 最初のコマは骨の基準の姿勢（T ポーズ）なので使わない
    for f in range(first + 1, last + 1):
        scene.frame_set(f)
        frames.append({k: arm.matrix_world @ arm.pose.bones[b].head for k, b in JOINTS.items()})
    bpy.data.objects.remove(arm, do_unlink=True)
    dt = 1 / 120   # BVH の Frame Time（0.0083333 秒）
    return frames, dt


def strikes(frames: list[dict], side: str) -> list[int]:
    """足首がいちばん低くなるあたり（着地）のコマ。足首の高さの谷のうち、下がりきって止まる最初のコマ。"""
    z = [f[f"ankle_{side}"].z for f in frames]
    lo, hi = min(z), max(z)
    near = [i for i in range(len(z)) if z[i] < lo + (hi - lo) * 0.08]
    starts = [i for i in near if i - 1 not in near]
    return starts


def to_local(frames: list[dict], a: int, b: int) -> list[dict]:
    """着地 a から次の着地 b の前までを切り出し、前への移動を差し引いて人物の座標（正面 -Y・上 +Z）に直す。"""
    move = frames[b]["hips"] - frames[a]["hips"]
    fwd = Vector((move.x, move.y, 0)).normalized()
    up = Vector((0, 0, 1))
    right = fwd.cross(up)            # 人物の右
    n = b - a
    out = []
    for i in range(n + 1):
        f = frames[a + i]
        shift = frames[a]["hips"] + move * (i / n)   # まっすぐ一定の速さで進んだぶん
        out.append({k: Vector((-(v - shift).dot(right), -(v - shift).dot(fwd), v.z)) for k, v in f.items()})
    # 終わりと始まりがぴったりつながるよう、ずれを少しずつ配る
    for k in out[0]:
        drift = out[n][k] - out[0][k]
        for i in range(n + 1):
            out[i][k] = out[i][k] - drift * (i / n)
    return out[:n]


def sample(cycle: list[dict], t: float) -> dict:
    """ひと回りの割合 t（0〜1）の関節の位置。コマのあいだは線形に補う。"""
    x = (t % 1.0) * len(cycle)
    i = int(x)
    u = x - i
    a, b = cycle[i % len(cycle)], cycle[(i + 1) % len(cycle)]
    return {k: a[k].lerp(b[k], u) for k in a}


# ---------- 部品の人物の寸法に写す ----------

def retarget(m: dict, scale: float, floor: float) -> dict:
    """モーションキャプチャの関節から、部品の人物の寸法で関節の位置を作る。骨の向きだけを使う。"""
    def d(a, b):
        return (m[b] - m[a]).normalized()

    pelvis = Vector((m["hips"].x * scale, m["hips"].y * scale, m["hips"].z * scale - floor))
    side = d("hip_r", "hip_l")
    p = {"pelvis": pelvis}
    for s, sx in (("l", 1), ("r", -1)):
        hip = pelvis + side * 0.09 * sx
        knee = hip + d(f"hip_{s}", f"knee_{s}") * THIGH
        ankle = knee + d(f"knee_{s}", f"ankle_{s}") * SHIN
        p |= {f"hip_{s}": hip, f"knee_{s}": knee, f"ankle_{s}": ankle, f"foot_{s}": d(f"ankle_{s}", f"toe_{s}")}
    # 上体の向き: 上は腰から首、横は右肩から左肩
    up = d("hips", "neck")
    x = (m["sh_l"] - m["sh_r"])
    x = (x - up * x.dot(up)).normalized()
    p["torso"] = Matrix((x, up.cross(x), up)).transposed()   # 列が人物の X・Y・Z
    for s, sx in (("l", 1), ("r", -1)):
        shoulder = pelvis + p["torso"] @ Vector((sx * 0.22, 0, SH_Z - HIP_Z - 0.02))
        elbow = shoulder + d(f"sh_{s}", f"elbow_{s}") * UPPER_ARM
        hand = elbow + d(f"elbow_{s}", f"hand_{s}") * FOREARM
        p |= {f"sh_{s}": shoulder, f"elbow_{s}": elbow, f"hand_{s}": hand}
    return p


class Runner:
    """ひと回り分の動き。scale はモーションキャプチャを部品の人物の大きさに縮める倍率。"""

    def __init__(self):
        frames, dt = read_mocap()
        hits = strikes(frames, "r")
        a, b = hits[0], hits[1]
        self.cycle = to_local(frames, a, b)
        self.seconds = (b - a) * dt
        f0 = self.cycle[0]
        leg = ((f0["knee_l"] - f0["hip_l"]).length + (f0["ankle_l"] - f0["knee_l"]).length)
        self.scale = (THIGH + SHIN) / leg
        # 足の甲の向きは、足首がいちばん低いときに水平になるよう、その傾きを差し引く
        flat = min(self.cycle, key=lambda f: f["ankle_r"].z)
        v = flat["toe_r"] - flat["ankle_r"]
        self.foot_tilt = math.atan2(v.z, Vector((v.x, v.y)).length)
        # 床: ひと回りでいちばん低い足首が ANKLE_Z の高さに来るよう、全体を下げる
        self.floor = 0.0
        low = min(min(self.pose(i / 60)[f"ankle_{s}"].z for s in "lr") for i in range(60))
        self.floor = low - ANKLE_Z
        print(f"mocap: strikes={hits} cycle={a}..{b} ({self.seconds:.3f}s) scale={self.scale:.4f}")

    def pose(self, t: float) -> dict:
        return retarget(sample(self.cycle, t), self.scale, self.floor)


# ---------- 人物を組み立てる ----------

def legs(o: dict, p: dict) -> Part:
    """両脚と靴（人物の座標のまま作る）。"""
    part = Part("legs")
    for s in "lr":
        hip, knee, ankle, foot = p[f"hip_{s}"], p[f"knee_{s}"], p[f"ankle_{s}"], p[f"foot_{s}"]
        part.sphere(0.07, tuple(hip), o["bottom"], segs=10)
        part.limb(hip, knee, 0.075, 0.068, o["bottom"])
        part.sphere(0.066, tuple(knee), o["bottom"], segs=10)
        part.limb(knee, ankle, 0.062, 0.055, o["bottom"])
        # 靴は足首からつま先への向きに合わせる（傾きは足を床につけたときに水平になるよう直してある）
        pitch = p["foot_pitch"][s]
        yaw = math.atan2(foot.x, -foot.y)
        rot = Euler((-pitch, 0, yaw))
        center = ankle + rot.to_matrix() @ Vector((0, -0.035, -0.035))
        part.box((0.11, 0.21, 0.08), tuple(center), o["shoe"], rot=tuple(rot), bevel=0.03)
    return part


def torso(o: dict) -> Part:
    """腰・胴・頭。腰の点を原点にして作り、あとで上体の向きに回す。"""
    p = Part("torso")
    sh, head = SH_Z - HIP_Z, SH_Z - HIP_Z + 0.22
    p.sphere(0.17, (0, 0, 0), o["bottom"], scale=(1.05, 0.85, 0.55))
    p.cyl(0.17, 0.19, sh + 0.04, (0, 0, sh / 2), o["top"], segs=16)
    p.sphere(0.19, (0, 0, sh), o["top"], scale=(1.1, 0.85, 0.42))
    p.cyl(0.055, 0.055, 0.1, (0, 0, sh + 0.07), o["skin"], segs=10)
    p.sphere(0.15, (0, 0, head), o["skin"])
    p.sphere(0.158, (0, 0.03, head + 0.045), o["hair"], scale=(1, 1, 0.82))
    for sx in (-1, 1):
        p.sphere(0.02, (sx * 0.055, -0.135, head), o["eye"], segs=8)
        p.sphere(0.03, (sx * 0.15, 0, head), o["skin"], segs=8)
        p.sphere(0.026, (sx * 0.09, -0.125, head - 0.045), o["cheek"], scale=(1, 0.45, 0.7), segs=10)
    p.sphere(0.02, (0, -0.145, head - 0.065), o["mouth"], scale=(1.3, 0.5, 0.6), segs=10)
    return p


def arms(o: dict, p: dict) -> Part:
    part = Part("arms")
    for s in "lr":
        shoulder, elbow, hand = p[f"sh_{s}"], p[f"elbow_{s}"], p[f"hand_{s}"]
        part.limb(shoulder, elbow, 0.062, 0.058, o["top"])
        part.limb(elbow, hand, 0.048, 0.042, o["skin"])
        part.sphere(0.05, tuple(hand), o["skin"], segs=10)
    return part


def pose(root, o: dict, runner: Runner, t: float) -> list:
    """t は 0〜1（ひと回りの割合）。"""
    p = runner.pose(t)
    p["foot_pitch"] = {}
    for s in "lr":
        f = p[f"foot_{s}"]
        p["foot_pitch"][s] = math.atan2(f.z, Vector((f.x, f.y)).length) - runner.foot_tilt
    body = torso(o).finish(root)
    body.matrix_basis = Matrix.Translation(p["pelvis"]) @ p["torso"].to_4x4()
    return [legs(o, p).finish(root), body, arms(o, p).finish(root)]


def setup(size: int, samples: int):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass

    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*srgb("#eef1fd"), 1)
    bg.inputs["Strength"].default_value = 0.9

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.6
    sun.data.angle = math.radians(8)
    sun.data.color = srgb("#fff2dc")
    sun.rotation_euler = (math.radians(35), 0, math.radians(-60))
    scene.collection.objects.link(sun)

    cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    scene.collection.objects.link(cam)
    # 走る向き（-Y）が画面の右になるよう、-X 側の少し前から見る
    cam.location = Vector((-6.0, -2.6, 2.4))
    target = Vector((0, -0.05, 0.86))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.05
    scene.camera = cam


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="loading_runner.py")
    ap.add_argument("--frames", type=int, default=24)
    ap.add_argument("--size", type=int, default=480)
    ap.add_argument("--samples", type=int, default=48)
    ap.add_argument("--out", type=Path, default=REPO / "ios" / "NG2622" / "Design" / "Loading")
    args = ap.parse_args(argv)
    out: Path = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    runner = Runner()
    setup(args.size, args.samples)
    outfit = make_outfit()
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)
    for i in range(args.frames):
        objs = pose(root, outfit, runner, i / args.frames)
        bpy.context.scene.render.filepath = str(out / f"runner_{i:02d}.png")
        bpy.ops.render.render(write_still=True)
        for obj in objs:
            bpy.data.objects.remove(obj, do_unlink=True)
        print(f"wrote runner_{i:02d}.png")
    print(f"ひと回り {runner.seconds:.3f} 秒 → LoadingRunner の fps は {args.frames / runner.seconds:.1f}")


main()
