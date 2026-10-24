"""配置の JSON（scenenglish.scene/1）を読み、assets/parts/ の部品を並べて PNG に描く。

AI や人が書いた配置が、場面として組めているか（向き・接地・位置・大きさ）を目で確かめるためのもの。
アプリと同じく、知らない部品は飛ばして警告を出し、残りを並べる。
動き（motion）は描けないので、move は行き先への矢印、fall は真下への点線で示し、下の欄に文字でも添える。
各部品の上には key を小さく書く。下の欄には name・description・elements の label と配点を書く。

座標（scene-protocol.md の「座標」）: m・Y が上・正面 +Z・原点は底面の中心・yaw は度で上から見て反時計回り。
Blender は Z が上なので、プロトコルの (x, y, z) を Blender の (x, -z, y) に置く。USDZ の読み込み（usd_import）が
Y が上を Z が上に直すので、部品の正面 +Z は Blender の -Y になり、yaw はそのまま Blender の Z 軸まわりの回転になる。

使い方:
  blender --background --factory-startup --python scripts/scene/render_layout.py -- <layout.json> [...] --out <dir>
  （--parts で部品の場所を変えられる。既定は assets/parts）
<dir>/<JSON のファイル名>.png に書き出す。
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector

REPO = Path(__file__).resolve().parents[2]
PROTOCOL = "scenenglish.scene/1"
SIZE = 8.0                    # 場面の一辺（m）
WIDTH, HEIGHT = 1280, 960     # PNG の大きさ（px）
PANEL = 0.30                  # 下の文字の欄が占める高さの割合
FOV_Y = 30.0                  # 縦の画角（度）
TILT = 28.0                   # 見下ろす角度（度。アプリの SceneOrbit.defaultTilt と同じ）
DISTANCE = 17.5               # 注視点からカメラまで（m）
TARGET = (0.0, 0.6, 0.0)      # 注視点（プロトコルの座標）
FONT = Path("/System/Library/Fonts/ヒラギノ角ゴシック W5.ttc")


def to_blender(p) -> Vector:
    """プロトコルの (x, y, z) を Blender の座標に直す。"""
    return Vector((p[0], -p[2], p[1]))


# ---------- マテリアル ----------

def flat_material(name: str, color, alpha: float = 1.0) -> bpy.types.Material:
    """光に左右されない単色（文字・矢印・枠）。alpha < 1 なら半透明にする。"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*color, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if alpha < 1:
        transparent = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        mix.inputs["Fac"].default_value = alpha
        nt.links.new(transparent.outputs["BSDF"], mix.inputs[1])
        nt.links.new(emit.outputs["Emission"], mix.inputs[2])
        nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
        mat.blend_method = "BLEND"
    else:
        nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    mat.shadow_method = "NONE"
    return mat


def no_shadow(obj: bpy.types.Object) -> None:
    obj.visible_shadow = False


# ---------- 部品 ----------

def resolve_part(parts: Path, ref: str) -> tuple[str, Path | None]:
    """part（"apple_red" や "apple_red@1"）から USDZ のパスを探す。版が無ければいちばん新しい版。"""
    pid, _, ver = ref.partition("@")
    folder = parts / pid
    if ver:
        path = folder / f"{ver}.usdz"
        return pid, path if path.exists() else None
    versions = sorted((int(p.stem), p) for p in folder.glob("*.usdz") if p.stem.isdigit()) if folder.is_dir() else []
    return pid, versions[-1][1] if versions else None


def place_part(path: Path, key: str, position, yaw: float, scale: float) -> bpy.types.Object:
    """USDZ を読み込み、空のオブジェクトの下にまとめて、位置・向き・大きさを付ける。"""
    before = set(bpy.data.objects)
    bpy.ops.wm.usd_import(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(f"item_{key}", None)
    bpy.context.scene.collection.objects.link(root)
    for o in new:
        if o.parent is None or o.parent not in new:
            o.parent = root
    root.location = to_blender(position)
    root.rotation_euler = (0, 0, math.radians(yaw))
    root.scale = (scale, scale, scale)
    return root


def world_bounds(root: bpy.types.Object) -> tuple[Vector, Vector] | None:
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in root.children_recursive if o.type == "MESH" for c in o.bound_box]
    if not pts:
        return None
    return (Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)]))


# ---------- 目印（地面・枠・矢印・文字） ----------

def add_mesh(name: str, verts, faces, mat) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def ground_plane() -> None:
    """場面の範囲（一辺 8 m）の枠と、灰色の床。床は地面の部品（厚さ 2 cm）に隠れるよう 3 cm 下に敷く。"""
    h = SIZE / 2
    floor = bpy.data.materials.new("floor")
    floor.use_nodes = True
    floor.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.55, 0.56, 0.58, 1)
    z = -0.03
    add_mesh("floor", [(-h, -h, z), (h, -h, z), (h, h, z), (-h, h, z)], [(0, 1, 2, 3)], floor)
    edge = flat_material("edge", (0.15, 0.15, 0.2), 0.6)
    w = 0.03
    for k, (a, b) in enumerate((((-h, -h), (h, -h)), ((h, -h), (h, h)), ((h, h), (-h, h)), ((-h, h), (-h, -h)))):
        d = Vector((b[0] - a[0], b[1] - a[1], 0)).normalized()
        n = Vector((-d.y, d.x, 0)) * w
        z = 0.15   # 芝生（高さ 0.128 m）より少し上
        pa, pb = Vector((*a, z)), Vector((*b, z))
        no_shadow(add_mesh(f"edge{k}", [pa - n, pb - n, pb + n, pa + n], [(0, 1, 2, 3)], edge))


def segment(name: str, a: Vector, b: Vector, radius: float, mat, dashed: bool = False, head: bool = False) -> None:
    """a から b への線（dashed なら点線、head なら先に矢じり）。"""
    length = (b - a).length
    if length < 1e-4:
        return
    direction = (b - a) / length
    rot = direction.to_track_quat("Z", "Y").to_euler()
    pieces = [(0.0, length)]
    if dashed:
        step = 0.2
        pieces = [(s, min(s + step * 0.55, length)) for s in [i * step for i in range(int(length / step) + 1)] if s < length]
    tip = 0.32 if head else 0.0
    for k, (s, e) in enumerate(pieces):
        e = min(e, length - tip) if head else e
        if e <= s:
            continue
        bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=e - s, vertices=10,
                                            location=a + direction * (s + e) / 2, rotation=rot)
        obj = bpy.context.object
        obj.name = f"{name}_{k}"
        obj.data.materials.append(mat)
        no_shadow(obj)
    if head:
        bpy.ops.mesh.primitive_cone_add(radius1=radius * 3.2, radius2=0, depth=tip, vertices=16,
                                        location=b - direction * tip / 2, rotation=rot)
        obj = bpy.context.object
        obj.name = f"{name}_head"
        obj.data.materials.append(mat)
        no_shadow(obj)


def ring(name: str, center: Vector, radius: float, mat) -> None:
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=0.025, location=center)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    no_shadow(obj)


def text(name: str, body: str, size: float, mat, font, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), align="LEFT"):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = body
    curve.size = size
    curve.align_x = align
    if font:
        curve.font = font
    curve.materials.append(mat)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    obj.location = loc
    obj.rotation_euler = rot
    no_shadow(obj)
    return obj


def wrap(body: str, max_em: float) -> list[str]:
    """全角を 1、半角を 0.55 文字分として、max_em 文字分の幅で折り返す。英語は語の切れ目で折る。"""
    lines, line, width = [], "", 0.0
    for token in re.findall(r"[!-~]+\s*|\s+|[^ -~]", body):
        w = sum(0.55 if " " <= c <= "~" else 1.0 for c in token)
        if width + w > max_em and line:
            lines.append(line.rstrip())
            line, width = token.lstrip(), sum(0.55 if " " <= c <= "~" else 1.0 for c in token.lstrip())
        else:
            line, width = line + token, width + w
    if line.strip():
        lines.append(line.rstrip())
    return lines


def motion_text(key: str, m: dict) -> str:
    t = m.get("type", "?")
    s = f"{key}: {t} {m.get('duration', '?')}s"
    if t == "move" and "to" in m:
        s += " → [" + ", ".join(f"{v:g}" for v in m["to"]) + "]"
    if t == "sway":
        s += f" ±{m.get('angle', 10)}°"
    if m.get("delay"):
        s += f" delay {m['delay']}s"
    if m.get("loop") is False:
        s += " 1 回"
    return s


# ---------- 1 つの配置を描く ----------

def setup_scene(font):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = WIDTH, HEIGHT
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    scene.eevee.taa_render_samples = 32
    scene.eevee.use_soft_shadows = True
    scene.eevee.shadow_cascade_size = "4096"
    world = bpy.data.worlds.new("bg")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.82, 0.86, 0.92, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.data.angle = math.radians(3)
    # アプリの光（[3, 8, 6] から原点へ）に近い向き
    sun.rotation_euler = to_blender((-3, -8, -6)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    t = math.radians(TILT)
    target = to_blender(TARGET)
    cam.location = target + to_blender((0, DISTANCE * math.sin(t), DISTANCE * math.cos(t)))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(FOV_Y)
    # 下の欄の分だけ、場面を上に寄せる（shift は画像の長い辺に対する割合）
    cam.data.shift_y = -(PANEL / 2) * HEIGHT / WIDTH
    cam.data.clip_start = 0.05
    cam.data.clip_end = 200
    scene.camera = cam
    return cam


def info_panel(cam, layout: dict, notes: list[str], motions: list[str], font) -> None:
    """カメラの前（距離 1）に下の欄を置き、名前・説明・要素・動き・警告を書く。"""
    hh = math.tan(math.radians(FOV_Y) / 2)            # 距離 1 での画面の高さの半分
    hw = hh * WIDTH / HEIGHT
    off_y = cam.data.shift_y * 2 * hw                 # shift で動いた画面の中心
    px = 2 * hh / HEIGHT                              # 1 px の大きさ
    top = off_y - hh + PANEL * 2 * hh                 # 欄の上端
    bottom = off_y - hh
    d = -1.0
    bg = flat_material("panel", (0.97, 0.97, 0.96), 0.93)
    plane = add_mesh("panel", [(-hw, bottom, d - 0.001), (hw, bottom, d - 0.001), (hw, top, d - 0.001), (-hw, top, d - 0.001)],
                     [(0, 1, 2, 3)], bg)
    plane.parent = cam
    no_shadow(plane)
    # Standard の表示ではリニアの値を sRGB に直して出すので、文字の色は小さめの値にする
    ink = flat_material("ink", (0.004, 0.004, 0.006))
    sub = flat_material("ink_sub", (0.025, 0.03, 0.04))
    warn = flat_material("ink_warn", (0.6, 0.02, 0.01))
    margin = 22 * px
    limit = bottom + margin * 0.6

    def lines(prefix: str, rows: list[tuple[str, object]], x: float, y: float, size: float, step: float, max_em: float) -> float:
        """rows（文字列と色）を、欄の下端に収まる分だけ書く。収まらない分は「ほか n 行」にまとめる。"""
        flat = [(seg, mat) for body, mat in rows for seg in wrap(body, max_em)]
        room = max(int((y - limit) / (step * px)) + 1, 0)
        if len(flat) > room:
            flat = flat[:max(room - 1, 0)] + [(f"…ほか {len(flat) - room + 1} 行（標準出力を見る）", warn)]
        for k, (seg, mat) in enumerate(flat):
            text(f"{prefix}{k}", seg, size * px, mat, font, cam, (x, y, d))
            y -= step * px
        return y

    x0 = -hw + margin
    col2 = -hw + 2 * hw * 0.55
    y = top - margin - 24 * px
    head = f"{layout.get('name', '(name なし)')}   [{layout.get('difficulty', '?')}]"
    text("name", head, 26 * px, ink, font, cam, (x0, y, d))
    y -= 36 * px
    left_em = (col2 - x0 - margin) / (17 * px)
    y = lines("desc", [(layout.get("description", ""), sub)], x0, y, 17, 23, left_em)
    y -= 8 * px
    lines("motion", [(m, ink) for m in motions], x0, y, 16, 21, left_em)

    y = top - margin - 18 * px
    elements = layout.get("elements", [])
    total = sum(e.get("points", 0) for e in elements)
    text("el_head", f"elements（{total} + extraMax {layout.get('extraMax', '?')}）", 18 * px, ink, font, cam, (col2, y, d))
    y -= 28 * px
    right_em = (hw - col2 - margin) / (16 * px)
    rows = [(f"{e.get('points', '?'):>3}  {e.get('label', e.get('id', '?'))}", sub) for e in elements]
    lines("el", rows + [(n, warn) for n in notes], col2, y, 16, 21, right_em)


def render_layout(src: Path, out_dir: Path, parts: Path) -> list[str]:
    """1 つの配置を描いて PNG にする。警告の一覧を返す。"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    layout = json.loads(src.read_text(encoding="utf-8"))
    notes: list[str] = []
    if layout.get("protocol") != PROTOCOL:
        notes.append(f"protocol が {layout.get('protocol')!r}（{PROTOCOL} のはず）")
    font = bpy.data.fonts.load(str(FONT)) if FONT.exists() else None
    cam = setup_scene(font)
    index = {}
    if (parts / "index.json").exists():
        index = {m["id"]: m for m in json.loads((parts / "index.json").read_text(encoding="utf-8"))}

    label_mat = flat_material("key_label", (0.05, 0.05, 0.1))
    move_mat = flat_material("motion_move", (1.0, 0.45, 0.05), 0.75)
    fall_mat = flat_material("motion_fall", (0.85, 0.1, 0.5), 0.8)
    motions: list[str] = []
    items = layout.get("items", [])
    if len(items) > 40:
        notes.append(f"items が {len(items)} 個（40 個まで）")
    for item in items:
        key, ref = item.get("key", "?"), item.get("part", "")
        pid, path = resolve_part(parts, ref)
        if path is None:
            notes.append(f"知らない部品 {ref!r}（{key}）を飛ばした")
            continue
        pos = item.get("position", [0, 0, 0])
        scale = item.get("scale", 1)
        if not 0.25 <= scale <= 4:
            notes.append(f"{key}: scale {scale} が 0.25〜4 の外")
        if any(abs(v) > SIZE / 2 for v in (pos[0], pos[2])):
            notes.append(f"{key}: 位置 {pos} が場面（±4 m）の外")
        root = place_part(path, key, pos, item.get("yaw", 0), scale)
        if index.get(pid, {}).get("category") != "ground":
            bounds = world_bounds(root)
            top_z = bounds[1].z if bounds else pos[1]
            label = text(f"key_{key}", key, 0.26, label_mat, font, None,
                         Vector((pos[0], -pos[2], top_z + 0.12)), cam.rotation_euler, "CENTER")
            label.location.x = (bounds[0].x + bounds[1].x) / 2 if bounds else pos[0]
        m = item.get("motion")
        if not m:
            continue
        motions.append(motion_text(key, m))
        start = to_blender(pos)
        if m.get("type") == "move" and isinstance(m.get("to"), list) and len(m["to"]) == 3:
            lift = Vector((0, 0, 0.08))
            segment(f"move_{key}", start + lift, to_blender(m["to"]) + lift, 0.045, move_mat, head=True)
            ring(f"move_{key}_end", to_blender(m["to"]) + lift, 0.25, move_mat)
        elif m.get("type") == "fall":
            ground = Vector((start.x, start.y, 0.02))
            segment(f"fall_{key}", start, ground, 0.025, fall_mat, dashed=True)
            ring(f"fall_{key}_end", ground + Vector((0, 0, 0.13)), 0.18, fall_mat)
    ground_plane()
    info_panel(cam, layout, notes, motions, font)

    out = out_dir / f"{src.stem}.png"
    bpy.context.scene.render.filepath = str(out)
    bpy.ops.render.render(write_still=True)
    print(f"wrote {out}")
    for n in notes:
        print(f"  警告: {n}")
    return notes


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="render_layout.py", description="配置の JSON を PNG に描く")
    ap.add_argument("layouts", nargs="+", type=Path, help="配置の JSON（いくつでも）")
    ap.add_argument("--out", type=Path, required=True, help="PNG を書き出す場所")
    ap.add_argument("--parts", type=Path, default=REPO / "assets" / "parts", help="部品の場所（既定 assets/parts）")
    args = ap.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    for src in args.layouts:
        render_layout(src.resolve(), args.out.resolve(), args.parts.resolve())


main()
