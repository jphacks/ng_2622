"""3D シーン（ジオラマ）を作るスクリプトの共通部分。scripts/scene/ の各シーン（park.py など）から使う。

Blender の中で動かす（Blender 4.5 LTS で確認）。外部の素材は使わず、形はすべてコードで作る。
シーンのスクリプトは build() で部品を組み立てて run() に渡す。run() はアプリ用の USDZ と発表用の画像を書き出す。

  <out>/<scene>.usdz   アプリ用。RealityKit の座標（Y が上、メートル、正面は +Z）。部品は名前付きの Xform に分ける
  <out>/<scene>.png    発表用の画像（Cycles。--no-render で省略）
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

REPO = Path(__file__).resolve().parents[2]
SIZE = 8.0          # ジオラマの一辺（m）
HALF = SIZE / 2


# ---------- マテリアル ----------

def srgb(hex_color: str) -> tuple[float, float, float]:
    """#rrggbb を Blender が使うリニアの色に直す。"""
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    h = hex_color.lstrip("#")
    return tuple(lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def material(name: str, color: str, rough: float = 0.6, metal: float = 0.0,
             emit: float = 0.0, coat: float = 0.0, ior: float | None = None, trans: float = 0.0,
             alpha: float = 1.0) -> bpy.types.Material:
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    rgb = srgb(color)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit
    if ior is not None:
        bsdf.inputs["IOR"].default_value = ior
    if trans:  # 水やガラスのように透かす（画像だけ。USDZ では不透明になる）
        bsdf.inputs["Transmission Weight"].default_value = trans
    if alpha < 1.0:  # 半透明（USDZ にも opacity として入る。アプリでも向こうが見えるガラスに使う）
        bsdf.inputs["Alpha"].default_value = alpha
    mat.diffuse_color = (*rgb, 1.0)
    return mat


def materials(spec: dict) -> dict:
    """{名前: (色, 粗さ)} からマテリアルの辞書を作る。"""
    return {name: material(name, color, rough) for name, (color, rough) in spec.items()}


# ---------- 形を作る道具 ----------

class Part:
    """図形を足していき、最後に 1 つのオブジェクトにする。座標は Blender（Z が上、正面は -Y）。

    図形は 1 つずつ別の bmesh で作って色を付けてから合体させる。同じ bmesh に足していくと、
    細分化で空いた場所に後の面が入り、面の並びから「新しい面」を見分けられなくなるため。
    """

    _tmp_mesh = None

    def __init__(self, name: str):
        self.name = name
        self.bm = bmesh.new()
        self.mats: list[bpy.types.Material] = []

    def _merge(self, tb: bmesh.types.BMesh, mat, smooth: bool) -> None:
        if mat not in self.mats:
            self.mats.append(mat)
        index = self.mats.index(mat)
        for f in tb.faces:
            f.material_index = index
            # 円柱のふたなど大きい多角形は平らに塗る
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
        self._merge(tb, mat, smooth=False)

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

    def blob(self, r, loc, mat, scale=(1, 1, 1), bumpy=0.15, subdiv=3, seed=0.0, smooth=True):
        """凸凹のある玉（木の葉・植え込み・岩）。"""
        tb = bmesh.new()
        center = Vector(loc)
        bmesh.ops.create_icosphere(tb, subdivisions=subdiv, radius=1.0,
                                   matrix=Matrix.LocRotScale(center, Euler((0, 0, 0)), Vector(scale) * r))
        offset = Vector((seed, seed * 1.7, seed * 0.3))
        for v in tb.verts:
            d = v.co - center
            v.co += d.normalized() * r * bumpy * noise.noise(d / r * 1.8 + offset)
        self._merge(tb, mat, smooth)

    def slab(self, size, z_top, thickness, radius, mat, segments=10):
        """角の丸い板（島の地面と土の層）。縦の辺だけを丸める。"""
        tb = bmesh.new()
        bmesh.ops.create_cube(tb, size=1.0, matrix=Matrix.LocRotScale(
            Vector((0, 0, z_top - thickness / 2)), Euler((0, 0, 0)), Vector((size, size, thickness))))
        vertical = [e for e in tb.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-4]
        bmesh.ops.bevel(tb, geom=vertical, offset=radius, segments=segments, profile=0.5, affect="EDGES")
        self._merge(tb, mat, smooth=False)

    def terrain(self, x0, x1, y0, y1, step, height, bottom, top_mat, side_mat, round_front=0.0, round_back=0.0):
        """上面の高さが場所で変わる塊（砂浜・海）。height(x, y) が上面の高さで、下は z = bottom の平らな面で閉じる。

        round_front・round_back は手前（-Y）と奥（+Y）の角の丸みの半径。島の縁の丸みに合わせるときに使う。
        """
        nx, ny = max(2, round((x1 - x0) / step)), max(2, round((y1 - y0) / step))
        corners = [(cx, cy, sx, sy, r) for r, cy, sy in ((round_front, y0 + round_front, -1), (round_back, y1 - round_back, 1)) if r
                   for cx, sx in ((x0 + r, -1), (x1 - r, 1))]

        def place(x, y):
            # 角の正方形を四分円に写す（辺の上の点はそのまま、角の点は円の上へ）
            for cx, cy, sx, sy, r in corners:
                u, v = (x - cx) * sx, (y - cy) * sy
                if u > 0 and v > 0:
                    k = max(u, v) / math.hypot(u, v)
                    return cx + sx * u * k, cy + sy * v * k
            return x, y

        tb = bmesh.new()
        grid = []
        for j in range(ny + 1):
            row = []
            for i in range(nx + 1):
                x, y = place(x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny)
                row.append(tb.verts.new((x, y, height(x, y))))
            grid.append(row)
        for j in range(ny):
            for i in range(nx):
                tb.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
        self._merge(tb, top_mat, smooth=True)

        # 側面と底。上面と頂点を分けて、縁で陰がにじまないようにする
        ring = ([(i, 0) for i in range(nx)] + [(nx, j) for j in range(ny)]
                + [(i, ny) for i in range(nx, 0, -1)] + [(0, j) for j in range(ny, 0, -1)])
        tb = bmesh.new()
        tops, bots = [], []
        for i, j in ring:
            x, y = place(x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny)
            tops.append(tb.verts.new((x, y, height(x, y))))
            bots.append(tb.verts.new((x, y, bottom)))
        n = len(ring)
        for k in range(n):
            tb.faces.new((tops[k], bots[k], bots[(k + 1) % n], tops[(k + 1) % n]))
        tb.faces.new(list(reversed(bots)))  # 縁は上から見て左回りなので、逆にすると下向き
        self._merge(tb, side_mat, smooth=True)

    def poly(self, points, mat, smooth=False):
        """点を順に結んだ 1 枚の面（傘の布など）。表は点が左回りに見える側。"""
        tb = bmesh.new()
        tb.faces.new([tb.verts.new(tuple(pt)) for pt in points])
        self._merge(tb, mat, smooth)

    def limb(self, a, b, r1, r2, mat, segs=12):
        """点 a から点 b へ伸びる円柱（腕・脚・棒）。"""
        a, b = Vector(a), Vector(b)
        d = b - a
        tb = bmesh.new()
        bmesh.ops.create_cone(tb, cap_ends=True, segments=segs, radius1=r1, radius2=r2, depth=d.length,
                              matrix=Matrix.LocRotScale((a + b) / 2, d.to_track_quat("Z", "Y"), Vector((1, 1, 1))))
        self._merge(tb, mat, smooth=True)

    def finish(self, parent, loc=(0, 0, 0), rot_z=0.0, scale=1.0) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        obj.location = (*loc, 0) if len(loc) == 2 else loc  # 高さを省いたら床（0）に置く
        obj.rotation_euler = (0, 0, rot_z)
        obj.scale = (scale, scale, scale)
        return obj


# ---------- 人物 ----------

POSES = ("stand", "walk", "sit", "raise_hand", "point", "phone", "run", "kneel")


def person(root, name, loc, rot_z, outfit: dict, pose="stand", scale=1.0, point_side=1, hands=None, lift=0.0):
    """デフォルメした人物。正面は -Y。

    outfit は skin・hair・top・bottom・shoe・eye のマテリアルと、skirt（True でスカート）、
    hair_style（short / bun / long / hood）を持つ。cheek・mouth のマテリアルがあれば、ほおと口も描く。
    point_side は指さす向き（1 で +X、-1 で -X）。hands は左右の手の位置 [(x, y, dz), (x, y, dz)] で、
    ポーズの手の位置を置き換える（dz は肩の高さからの差。物を持たせるときに使う）。lift は体を浮かせる高さ（跳ぶ）。
    """
    assert pose in POSES, pose
    p = Part(name)
    o = outfit
    sitting = pose in ("sit", "raise_hand")
    hip_z = 0.48 if sitting else 0.5 if pose == "kneel" else 0.78 if pose == "run" else 0.8
    sh_z = hip_z + 0.5
    head_z = sh_z + 0.22
    leg_mat = o["skin"] if o.get("skirt") else o["bottom"]

    # 脚と靴
    for sx in (-1, 1):
        hip = Vector((sx * 0.09, 0, hip_z))
        shoe_y = -0.05
        if sitting or pose in ("kneel", "run"):
            if sitting:
                knee, foot = Vector((sx * 0.1, -0.4, hip_z)), Vector((sx * 0.1, -0.44, 0.07))
            elif pose == "kneel":
                # ひざを砂（床）につけ、すねは後ろへ寝かせる
                knee, foot = Vector((sx * 0.1, -0.1, 0.08)), Vector((sx * 0.1, 0.3, 0.07))
                shoe_y = 0.08
            elif sx > 0:  # 走る: 右脚が前、左脚は後ろでけり上げる
                knee, foot = Vector((sx * 0.09, -0.3, 0.42)), Vector((sx * 0.09, -0.2, 0.07))
            else:
                knee, foot = Vector((sx * 0.09, 0.14, 0.4)), Vector((sx * 0.09, 0.42, 0.24))
            p.limb(hip, knee, 0.075, 0.068, leg_mat if pose == "run" else o["bottom"])
            if not sitting:
                p.sphere(0.066, tuple(knee), o["bottom"] if pose == "kneel" else leg_mat, segs=10)
            p.limb(knee, foot, 0.062, 0.055, leg_mat)
        else:
            step = -0.2 * sx if pose == "walk" else 0.0
            foot = Vector((sx * 0.09, step, 0.07))
            p.limb(hip, foot, 0.072, 0.058, leg_mat)
        p.box((0.11, 0.2, 0.08), (foot.x, foot.y + shoe_y, foot.z - 0.03), o["shoe"], bevel=0.03)
    if o.get("skirt"):
        p.cyl(0.24, 0.15, 0.36, (0, 0, hip_z - 0.08), o["bottom"], segs=16)
    else:
        p.sphere(0.17, (0, 0, hip_z), o["bottom"], scale=(1.05, 0.85, 0.55))

    # 胴・首・頭
    p.cyl(0.17, 0.19, sh_z - hip_z + 0.04, (0, 0, (hip_z + sh_z) / 2), o["top"], segs=16)
    p.sphere(0.19, (0, 0, sh_z), o["top"], scale=(1.1, 0.85, 0.42))
    p.cyl(0.055, 0.055, 0.1, (0, 0, sh_z + 0.07), o["skin"], segs=10)
    p.sphere(0.15, (0, 0, head_z), o["skin"])
    style = o.get("hair_style", "short")
    if style == "hood":
        # フード（髪のマテリアルにフードの色を渡す）。顔の前だけ空ける
        p.sphere(0.172, (0, 0.045, head_z + 0.02), o["hair"], scale=(1.02, 1, 1.02))
        p.cyl(0.13, 0.13, 0.03, (0, -0.1, head_z + 0.0), o["hair"], rot=(math.pi / 2, 0, 0), segs=20)
    else:
        p.sphere(0.158, (0, 0.03, head_z + 0.045), o["hair"], scale=(1, 1, 0.82))
    if style == "bun":
        p.sphere(0.07, (0, 0.1, head_z + 0.15), o["hair"])
    elif style == "long":
        p.box((0.3, 0.1, 0.32), (0, 0.1, head_z - 0.12), o["hair"], bevel=0.04)
    for sx in (-1, 1):
        p.sphere(0.02, (sx * 0.055, -0.135, head_z), o["eye"], segs=8)
        if style != "hood":
            p.sphere(0.03, (sx * 0.15, 0, head_z), o["skin"], segs=8)
        if o.get("cheek"):
            p.sphere(0.026, (sx * 0.09, -0.125, head_z - 0.045), o["cheek"], scale=(1, 0.45, 0.7), segs=10)
    if o.get("mouth"):
        p.sphere(0.02, (0, -0.145, head_z - 0.065), o["mouth"], scale=(1.3, 0.5, 0.6), segs=10)

    # 腕（肩から手まで）
    hands = [(x, y, sh_z + dz) for x, y, dz in hands] if hands else {
        "stand": [(-0.27, 0.0, sh_z - 0.52), (0.27, 0.0, sh_z - 0.52)],
        "walk": [(-0.26, 0.17, sh_z - 0.5), (0.26, -0.17, sh_z - 0.5)],
        "sit": [(-0.2, -0.32, hip_z + 0.27), (0.2, -0.32, hip_z + 0.27)],
        "raise_hand": [(-0.2, -0.32, hip_z + 0.27), (0.36, -0.06, sh_z + 0.66)],
        "point": [(-0.27, 0.0, sh_z - 0.52), (0.27, 0.0, sh_z - 0.52)],
        "phone": [(-0.08, -0.26, sh_z - 0.22), (0.08, -0.26, sh_z - 0.22)],
        "run": [(-0.22, -0.3, sh_z - 0.3), (0.24, 0.24, sh_z - 0.42)],
        "kneel": [(-0.16, -0.42, 0.2), (0.16, -0.42, 0.2)],
    }[pose]
    if pose == "point":
        hands[(point_side + 1) // 2] = (0.78 * point_side, -0.08, sh_z + 0.05)
    for sx, hand in zip((-1, 1), hands):
        shoulder = Vector((sx * 0.22, 0, sh_z - 0.02))
        hand = Vector(hand)
        elbow = shoulder + (hand - shoulder) * 0.32
        p.limb(shoulder, elbow, 0.062, 0.058, o["top"])
        p.limb(elbow, hand, 0.048, 0.042, o["skin"])
        p.sphere(0.048, tuple(hand), o["skin"], segs=10)
    if pose == "phone":
        p.box((0.09, 0.02, 0.16), (0, -0.28, sh_z - 0.17), o["eye"], rot=(0.5, 0, 0), bevel=0.01)
    return p.finish(root, loc=(*loc, lift), rot_z=rot_z, scale=scale)


# ---------- 書き出し ----------

def export_usdz(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.usd_export(
        filepath=str(path),
        export_materials=True,
        generate_preview_surface=True,
        export_animation=False,
        convert_orientation=True,
        export_global_forward_selection="NEGATIVE_Z",
        export_global_up_selection="Y",
    )


# 画像の光と背景。晴れの昼がふつうで、シーンごとに run(env=...) で一部を変えられる
ENV = {
    "sun_elevation": 38, "sun_rotation": 210,       # 空（Nishita）の太陽の位置（度）
    "sky_strength": 0.22,                            # 空から受ける光の強さ
    "sun_energy": 2.4, "sun_color": "#fff2dc",       # 太陽の光（影を落とす）
    "bg_strength": 1.7, "bg_edge": "#aebde9", "bg_center": "#eef1fd",  # カメラに映る背景
    "exposure": -0.35,
}


def setup_render(samples: int, lens: float = 46, env: dict | None = None) -> None:
    e = {**ENV, **(env or {})}
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.image_settings.compression = 90
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = e["exposure"]
    try:
        scene.view_settings.look = "AgX - Punchy"
    except TypeError:
        pass

    # 光は空（Nishita）から受け、カメラに映る背景はやわらかい単色にする
    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(e["sun_elevation"])
    sky.sun_rotation = math.radians(e["sun_rotation"])
    sky_bg = nt.nodes.new("ShaderNodeBackground")
    sky_bg.inputs["Strength"].default_value = e["sky_strength"]
    flat_bg = nt.nodes.new("ShaderNodeBackground")
    flat_bg.inputs["Strength"].default_value = e["bg_strength"]  # 露出を下げた分、背景だけ明るくして淡い色にする
    # 画面の真ん中が明るく、端にいくほど少し濃くなる背景
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Location"].default_value = (-0.5, -0.5, 0)
    mapping.inputs["Scale"].default_value = (1.6, 1.0, 1)
    gradient = nt.nodes.new("ShaderNodeTexGradient")
    gradient.gradient_type = "SPHERICAL"
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*srgb(e["bg_edge"]), 1)
    ramp.color_ramp.elements[1].color = (*srgb(e["bg_center"]), 1)
    nt.links.new(coord.outputs["Window"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], gradient.inputs["Vector"])
    nt.links.new(gradient.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], flat_bg.inputs["Color"])
    light_path = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs["Color"], sky_bg.inputs["Color"])
    nt.links.new(light_path.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(sky_bg.outputs["Background"], mix.inputs[1])
    nt.links.new(flat_bg.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = e["sun_energy"]
    sun.data.angle = math.radians(4)
    sun.data.color = srgb(e["sun_color"])
    sun.rotation_euler = Euler((math.radians(50), math.radians(10), math.radians(-35)))
    scene.collection.objects.link(sun)

    cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    scene.collection.objects.link(cam)
    cam.location = Vector((0, -14.5, 10.8))
    target = Vector((0, 0.2, -0.1))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    # ミニチュアのように手前と奥を少しぼかす
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (target - cam.location).length - 1.0
    cam.data.dof.aperture_fstop = 1.6
    scene.camera = cam


def run(scene_id: str, build, lens: float = 46, env: dict | None = None) -> None:
    """build() で組み立てたシーンを、USDZ と画像に書き出す。build() はルートの空オブジェクトを返す。

    lens は画像のカメラの焦点距離（mm）。背の高いシーンは小さくして画面に収める。
    env は画像の光と背景のうち、ENV から変えるもの（雨の日の暗い空など）。
    """
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog=f"{scene_id}.py")
    ap.add_argument("--out", type=Path, default=REPO / "assets" / "scenes")
    ap.add_argument("--no-render", action="store_true", help="発表用の画像を作らない")
    ap.add_argument("--samples", type=int, default=128)
    args = ap.parse_args(argv)
    out: Path = args.out.resolve()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = build()
    usdz = out / f"{scene_id}.usdz"
    export_usdz(usdz)
    print(f"wrote {usdz}")

    if not args.no_render:
        # 画像は斜めから見せる（USDZ には回転を入れない）
        root.rotation_euler = (0, 0, math.radians(-38))
        setup_render(args.samples, lens, env)
        png = out / f"{scene_id}.png"
        bpy.context.scene.render.filepath = str(png)
        bpy.ops.render.render(write_still=True)
        print(f"wrote {png}")
