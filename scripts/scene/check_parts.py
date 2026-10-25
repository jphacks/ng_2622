"""parts.py が書き出した部品（assets/parts/）を読み直して、プロトコル v1 に合っているかを確かめる。

Blender の中で動かす（Blender に入っている pxr で USDZ を読む）。確かめること:
  - メタデータ: id・version・file・category・words・pose・size・label の形と値、index.json と各部品の JSON が同じこと
  - USDZ: 2 MB 以下、Y が上でメートル、外接箱の最小 y が 0・x と z の中心が 0（原点が底面の中心）
  - 大きさ: 外接箱の大きさが JSON の size と合う
  - 向き: 正面の目印（人の目、車のライトなど。parts.py の front）が +Z 側にある。背もたれは -Z 側にある
  - anchors: 付けるはずの部品にあり、外接箱の内側にある。座る人の hip を座る家具の seat に合わせると、
    脚が家具の前に出て、足が床に深くめり込まず、背中が背もたれの後ろへ抜けない
--sheet を付けると、全部品を並べた確かめの画像（assets/parts/contact_sheet.png）も作る。
--sheet-only <id> と --sheet-out <png> で、一部の部品だけを並べた画像を別の場所に作れる（足した部品を見るとき）。

使い方:
  blender --background --factory-startup --python scripts/scene/check_parts.py -- [--sheet] [--dir assets/parts]
  blender --background --factory-startup --python scripts/scene/check_parts.py -- --sheet-only train --sheet-out /tmp/new.png
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import tempfile
from pathlib import Path

from pxr import Usd, UsdGeom, UsdShade

REPO = Path(__file__).resolve().parents[2]
MAX_BYTES = 2 * 1024 * 1024
TOL_ORIGIN = 0.002   # 原点のずれの許容（m）
TOL_SIZE = 0.002     # 大きさのずれの許容（m）
CATEGORIES = {"person", "animal", "plant", "food", "furniture", "vehicle", "building", "ground", "thing"}

# scene-protocol.md の「最初に作る部品（34 個）」と、場面の文の調べ（research/scene-sentence-coverage.md）で
# 「足すと効く」とされた物 14 個・人物 15 体。この順で contact_sheet.png に並ぶ
EXPECTED = [
    "tree", "bench", "ball_red", "bicycle", "umbrella", "vending_machine",
    "person_stand_adult_a", "person_walk_adult_a", "person_run_adult_a", "person_sit_adult_a", "person_phone_adult_a",
    "car", "trash_bin", "smartphone", "flower", "grass_patch", "road_patch", "animal_run_dog_a",
    "table", "chair", "box", "apple_red", "bag", "book", "bottle", "cup", "sofa",
    "person_read_adult_a", "person_eat_adult_a", "person_carry_adult_a",
    "person_walk_woman_a", "person_sit_woman_a", "person_run_boy_a", "person_stand_girl_a",
    # 足した物
    "door", "wall", "window", "checkout_counter", "shelf", "basket", "plate", "shirt", "seat",
    "laptop", "clock", "cart", "pan", "bed",
    # 足した人物（新しいポーズと、今あるポーズの見た目違い）
    "person_hold_woman_a", "person_hold_girl_a", "person_put_adult_a", "person_put_woman_a", "person_put_boy_a",
    "person_drink_woman_a", "person_drink_adult_a", "person_write_boy_a", "person_write_girl_a", "person_look_girl_a",
    "person_carry_boy_a", "person_carry_woman_a", "person_carry_girl_a", "person_sit_girl_a", "person_sit_boy_a",
    # 床（8 m 四方の地面）。室内も駅も芝生か道路になっていたので足した
    "floor_wood", "floor_tile", "floor_carpet", "floor_classroom",
    "platform_station", "sand_beach", "sidewalk_stone", "ground_dirt",
    # 背景の壁（奥に 1 枚置く）
    "wall_window", "wall_kitchen_tile", "wall_blackboard", "wall_store_shelves",
]

# 向きの目印（parts.py の front と同じ）。(マテリアル名, 向き, 比べる相手)。向きが 1 なら相手より +Z 側、
# -1 なら -Z 側にあるはず。相手が None なら外接箱の中心と比べ、文字列ならその名前で始まるマテリアルの重心と比べる
# （人物は手や持ち物・座った脚が前に出て外接箱の中心がずれるので、目を髪と比べる）
FRONT = {"bench": ("bench_back", -1, None), "chair": ("chair_back", -1, None), "sofa": ("sofa_back", -1, None),
         "bicycle": ("bike_basket", 1, None), "car": ("headlight", 1, None), "vending_machine": ("vending_glow", 1, None),
         "animal_run_dog_a": ("dog_dark", 1, None),
         "window": ("window_sill", 1, None), "checkout_counter": ("counter_front", 1, None), "shelf": ("shelf_back", -1, None),
         "shirt": ("shirt_collar", 1, None), "seat": ("seat_back", -1, None), "laptop": ("trackpad", 1, None),
         "cart": ("cart_handle", -1, None), "platform_station": ("platform_edge", -1, None),
         "wall_window": ("wall_window_sill", 1, None), "wall_kitchen_tile": ("kitchen_cabinet", 1, None),
         "wall_blackboard": ("chalk_tray", 1, None), "wall_store_shelves": ("price_rail", 1, None)}
FRONT.update({pid: ("eye", 1, "hair") for pid in EXPECTED if pid.startswith("person_")})

# anchors を付けるはずの部品と、その種類（scene-protocol.md の「部品のメタデータ」）
ANCHORS = {"table": {"top"}, "box": {"top"}, "chair": {"seat"}, "bench": {"seat"}, "sofa": {"seat"},
           "checkout_counter": {"top"}, "shelf": {"top"}, "plate": {"top"}, "seat": {"seat"}, "bed": {"top", "seat"}}
ANCHORS.update({pid: {"hip"} for pid in EXPECTED if pid.startswith(("person_sit_", "person_write_"))})
TOL_ANCHOR = 0.001   # anchors が外接箱からはみ出してよい量（m。丸めの分）
LEG_AHEAD = 0.05     # 座らせたとき、人の前の端が家具の前の端より前に出ているはずの量（m）
SINK = 0.03          # 座らせたとき、足が床（y = 0）にめり込んでよい深さ（m）
BACK = 0.05          # 座らせたとき、人の後ろの端が家具の後ろの端より後ろに出てよい量（m）。外接箱で見るので、
                     # 背もたれより上にある長い髪（person_sit_woman_a）の分を許す


def check_meta(pid: str, meta: dict) -> list[str]:
    errs = []
    if meta.get("id") != pid or not re.fullmatch(r"[a-z0-9_]{1,48}", pid):
        errs.append(f"id が {meta.get('id')!r}")
    if meta.get("version") != 1:
        errs.append(f"version が {meta.get('version')!r}")
    if meta.get("file") != f"parts/{pid}/1.usdz":
        errs.append(f"file が {meta.get('file')!r}")
    if meta.get("category") not in CATEGORIES:
        errs.append(f"category が {meta.get('category')!r}")
    words = meta.get("words") or []
    if not words or any(set(w) != {"word", "pos"} or w["pos"] not in ("noun", "verb") for w in words):
        errs.append(f"words が {words!r}")
    if (meta.get("category") in ("person", "animal")) != ("pose" in meta):
        errs.append("pose は人物と動物だけに付ける")
    if meta.get("category") in ("person", "animal") and not any(w["pos"] == "verb" for w in words):
        errs.append("人物・動物の words に動詞が無い")
    size = meta.get("size")
    if not (isinstance(size, list) and len(size) == 3 and all(isinstance(v, (int, float)) and v > 0 for v in size)):
        errs.append(f"size が {size!r}")
    if not meta.get("label"):
        errs.append("label が無い")
    errs += check_anchors(pid, meta)
    return errs


def check_anchors(pid: str, meta: dict) -> list[str]:
    """anchors の形と、外接箱の内側にあること。"""
    anchors = meta.get("anchors")
    want = ANCHORS.get(pid, set())
    if anchors is None:
        return [f"anchors が無い（{sorted(want)} があるはず）"] if want else []
    if not isinstance(anchors, dict) or set(anchors) != want:
        return [f"anchors が {anchors!r}（{sorted(want)} があるはず）"]
    size = meta.get("size") or [0, 0, 0]
    lo = [-size[0] / 2 - TOL_ANCHOR, -TOL_ANCHOR, -size[2] / 2 - TOL_ANCHOR]
    hi = [size[0] / 2 + TOL_ANCHOR, size[1] + TOL_ANCHOR, size[2] / 2 + TOL_ANCHOR]
    errs = []
    for key, v in anchors.items():
        if key == "top":
            if not isinstance(v, (int, float)) or not lo[1] <= v <= hi[1]:
                errs.append(f"anchors.top {v!r} が高さ 0〜{size[1]} の外")
        elif not (isinstance(v, list) and len(v) == 3 and all(isinstance(c, (int, float)) for c in v)):
            errs.append(f"anchors.{key} が {v!r}")
        elif not all(lo[i] <= v[i] <= hi[i] for i in range(3)):
            errs.append(f"anchors.{key} {v} が外接箱の外")
    return errs


def check_sitting(index: dict[str, dict]) -> bool:
    """座る人（hip）を、座る家具（seat）に hip と seat が重なるように置いて、明らかにおかしくないかを見る。

    外接箱だけで見る（人と家具は同じ向き、正面は +Z）。
      - 脚が前に出る: 人の前の端が、家具の前の端より LEG_AHEAD 以上前
      - 床にめり込まない: 人の最も低い点（足）が y = -SINK より上
      - 背もたれを突き抜けない: 人の後ろの端が、家具の後ろの端から BACK より後ろに出ない
    """
    ok = True
    people = [m for m in index.values() if "hip" in m.get("anchors", {})]
    seats = [m for m in index.values() if "seat" in m.get("anchors", {})]
    for person in people:
        hip, ps = person["anchors"]["hip"], person["size"]
        for furn in seats:
            seat, fs = furn["anchors"]["seat"], furn["size"]
            d = [seat[i] - hip[i] for i in range(3)]   # 人を動かす量
            front, back, bottom = d[2] + ps[2] / 2, d[2] - ps[2] / 2, d[1]
            errs = []
            if front < fs[2] / 2 + LEG_AHEAD:
                errs.append(f"脚が前に出ない（人の前 z={front:+.2f}、家具の前 z={fs[2] / 2:+.2f}）")
            if bottom < -SINK:
                errs.append(f"足が床にめり込む（y={bottom:+.3f}）")
            if back < -fs[2] / 2 - BACK:
                errs.append(f"背中が背もたれの後ろへ抜ける（人の後ろ z={back:+.2f}、家具の後ろ z={-fs[2] / 2:+.2f}）")
            print(f"{'OK' if not errs else 'NG'} 座る {person['id']} → {furn['id']:6s} 人の前 z={front:+.2f}（家具 {fs[2] / 2:+.2f}）"
                  f" 足 y={bottom:+.3f} 人の後ろ z={back:+.2f}（家具 {-fs[2] / 2:+.2f}）")
            for e in errs:
                print(f"     - {e}")
            ok = ok and not errs
    return ok


def mesh_points_by_material(stage):
    """メッシュの頂点を、ワールド座標でマテリアルの名前ごとに集める。"""
    xf_cache = UsdGeom.XformCache()
    out: dict[str, list] = {}
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        m = xf_cache.GetLocalToWorldTransform(prim)
        pts = [m.Transform(p) for p in mesh.GetPointsAttr().Get()]
        counts = mesh.GetFaceVertexCountsAttr().Get()
        idx = mesh.GetFaceVertexIndicesAttr().Get()
        starts = [0]
        for c in counts:
            starts.append(starts[-1] + c)
        binding = UsdShade.MaterialBindingAPI(prim)
        subsets = binding.GetMaterialBindSubsets()
        if subsets:
            for sub in subsets:
                mat = UsdShade.MaterialBindingAPI(sub.GetPrim()).ComputeBoundMaterial()[0]
                verts = {idx[k] for f in sub.GetIndicesAttr().Get() for k in range(starts[f], starts[f + 1])}
                out.setdefault(mat.GetPrim().GetName(), []).extend(pts[v] for v in verts)
        else:
            mat = binding.ComputeBoundMaterial()[0]
            out.setdefault(mat.GetPrim().GetName() if mat else "", []).extend(pts)
    return out


def check_usdz(pid: str, path: Path, meta: dict) -> tuple[list[str], str]:
    errs = []
    nbytes = path.stat().st_size
    if nbytes > MAX_BYTES:
        errs.append(f"{nbytes / 1e6:.2f} MB で 2 MB を超える")
    stage = Usd.Stage.Open(str(path))
    if UsdGeom.GetStageUpAxis(stage) != UsdGeom.Tokens.y:
        errs.append(f"upAxis が {UsdGeom.GetStageUpAxis(stage)}")
    if UsdGeom.GetStageMetersPerUnit(stage) != 1.0:
        errs.append(f"metersPerUnit が {UsdGeom.GetStageMetersPerUnit(stage)}")
    rng = UsdGeom.BBoxCache(Usd.TimeCode.Default(), ["default", "render"]).ComputeWorldBound(stage.GetPseudoRoot()).ComputeAlignedRange()
    lo, hi = rng.GetMin(), rng.GetMax()
    cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
    if abs(lo[1]) > TOL_ORIGIN or abs(cx) > TOL_ORIGIN or abs(cz) > TOL_ORIGIN:
        errs.append(f"原点が底面の中心でない（min y={lo[1]:.4f}, 中心 x={cx:.4f}, z={cz:.4f}）")
    size = [hi[i] - lo[i] for i in range(3)]
    if any(abs(a - b) > TOL_SIZE for a, b in zip(size, meta["size"])):
        errs.append(f"size が合わない（USDZ {[round(v, 3) for v in size]}、JSON {meta['size']}）")

    front = "向きなし"
    if pid in FRONT:
        name, sign, ref = FRONT[pid]
        by_mat = mesh_points_by_material(stage)
        pts = by_mat.get(name)
        ref_pts = [p for m, ps in by_mat.items() if ref and m.startswith(ref) for p in ps]
        if not pts or (ref and not ref_pts):
            errs.append(f"向きの目印 {name}（相手 {ref}）が無い")
        else:
            z = sum(p[2] for p in pts) / len(pts)
            rz = sum(p[2] for p in ref_pts) / len(ref_pts) if ref else cz
            # 目印の z が、相手から 5 cm 以上その側に寄っていれば向きは合っている
            ok = sign * (z - rz) > 0.05
            front = f"{name} z={z:+.2f} {ref or '中心'} z={rz:+.2f} {'+Z' if sign > 0 else '-Z'} 側 {'OK' if ok else 'NG'}"
            if not ok:
                errs.append(f"向きが違う（{name} の z={z:+.3f}）")
    return errs, f"{nbytes / 1e6:.2f} MB  size={[round(v, 3) for v in size]}  min_y={lo[1]:+.4f} cx={cx:+.4f} cz={cz:+.4f}  {front}"


def check(root: Path) -> bool:
    ok = True
    index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    ids = [m["id"] for m in index]
    if sorted(ids) != sorted(EXPECTED) or len(ids) != len(set(ids)):
        missing, extra = set(EXPECTED) - set(ids), set(ids) - set(EXPECTED)
        print(f"NG index.json: 足りない {sorted(missing)}、余分 {sorted(extra)}")
        ok = False
    for pid in EXPECTED:
        jpath, upath = root / pid / "1.json", root / pid / "1.usdz"
        if not jpath.exists() or not upath.exists():
            print(f"NG {pid}: ファイルが無い")
            ok = False
            continue
        meta = json.loads(jpath.read_text(encoding="utf-8"))
        errs = check_meta(pid, meta)
        if meta not in index:
            errs.append("index.json の中身と違う")
        usd_errs, summary = check_usdz(pid, upath, meta)
        errs += usd_errs
        print(f"{'OK' if not errs else 'NG'} {pid:22s} {summary}")
        for e in errs:
            print(f"     - {e}")
        ok = ok and not errs
    ok = check_sitting({m["id"]: m for m in index}) and ok
    total = sum(p.stat().st_size for p in root.rglob("*.usdz"))
    print(f"{'すべて OK' if ok else 'NG あり'}（{len(EXPECTED)} 部品、USDZ の合計 {total / 1e6:.2f} MB）")
    return ok


# ---------- 確かめの画像 ----------

TILE = 256      # 1 部品の画像の大きさ（px）
COLS = 7


def render_tile(usdz: Path, png: Path, label: str, size_text: str) -> None:
    """部品を 1 つ読み込み、正面（+Z。Blender では -Y）を少し上から見た画像にする。"""
    import bpy
    from mathutils import Vector

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.usd_import(filepath=str(usdz))
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ v.co for o in bpy.context.scene.objects if o.type == "MESH" for v in o.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    center = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.05)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("bg")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.92, 0.93, 0.95, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(-30))
    scene.collection.objects.link(sun)

    # 正面から 25 度横、20 度上から見る。下の 1/4 に名前を書く
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = radius * 2.0 / 0.72
    yaw, pitch = math.radians(25), math.radians(20)
    direction = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    look = center - Vector((0, 0, cam.data.ortho_scale * 0.1))
    cam.location = look + direction * (radius * 4 + 1)
    cam.rotation_euler = (look - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = radius * 10 + 10
    scene.camera = cam

    font = bpy.data.fonts.load("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc") if Path("/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc").exists() else None
    ink = bpy.data.materials.new("ink")
    ink.use_nodes = True
    ink.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0, 0, 0, 1)
    ink.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (0.02, 0.02, 0.03, 1)
    for k, (text, h) in enumerate(((label, 0.064), (size_text, 0.056))):
        curve = bpy.data.curves.new(f"label{k}", "FONT")
        curve.body = text
        curve.align_x = "CENTER"
        curve.size = cam.data.ortho_scale * h
        if font:
            curve.font = font
        curve.materials.append(ink)
        obj = bpy.data.objects.new(f"label{k}", curve)
        scene.collection.objects.link(obj)
        obj.parent = cam
        obj.location = (0, -cam.data.ortho_scale * (0.37 + 0.085 * k), -1)
        obj.rotation_euler = (0, 0, 0)
    scene.render.filepath = str(png)
    bpy.ops.render.render(write_still=True)


def contact_sheet(root: Path, work: Path, ids: list[str] | None = None, out: Path | None = None) -> None:
    """部品を並べた画像を作る。ids を渡せばその部品だけを並べ、out に書く（既定は <root>/contact_sheet.png）。"""
    import bpy
    import numpy as np

    index = {m["id"]: m for m in json.loads((root / "index.json").read_text(encoding="utf-8"))}
    work.mkdir(parents=True, exist_ok=True)
    tiles = []
    for pid in ids or EXPECTED:
        m = index[pid]
        png = work / f"{pid}.png"
        render_tile(root / pid / "1.usdz", png, f"{pid}  {m['label']}", "{:g} x {:g} x {:g} m".format(*m["size"]))
        tiles.append(png)
    rows = math.ceil(len(tiles) / COLS)
    sheet = None
    for k, png in enumerate(tiles):
        img = bpy.data.images.load(str(png))
        px = np.array(img.pixels[:], dtype=np.float32).reshape(TILE, TILE, 4)   # 下の行から
        if sheet is None:   # 余ったマスは背景の色で埋める
            sheet = np.tile(px[0, 0], (rows * TILE, COLS * TILE, 1))
        r, c = k // COLS, k % COLS
        y0 = (rows - 1 - r) * TILE
        sheet[y0:y0 + TILE, c * TILE:(c + 1) * TILE] = px
        bpy.data.images.remove(img)
    image = bpy.data.images.new("contact_sheet", COLS * TILE, rows * TILE, alpha=False)
    image.pixels = sheet.ravel()
    settings = bpy.context.scene.render.image_settings
    settings.file_format, settings.color_mode, settings.compression = "PNG", "RGB", 100
    path = out or root / "contact_sheet.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save_render(str(path))
    print(f"wrote {path}")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="check_parts.py")
    ap.add_argument("--dir", type=Path, default=REPO / "assets" / "parts")
    ap.add_argument("--sheet", action="store_true", help="確かめの画像 contact_sheet.png も作る")
    ap.add_argument("--work", type=Path, default=None, help="部品ごとの画像を置く場所（既定は一時ディレクトリ）")
    ap.add_argument("--sheet-only", action="append", choices=EXPECTED, metavar="ID",
                    help="画像にこの部品だけを並べる（くり返して指定できる。--sheet-out と使う）")
    ap.add_argument("--sheet-out", type=Path, default=None, help="画像の書き出し先（既定は <dir>/contact_sheet.png）")
    args = ap.parse_args(argv)
    root = args.dir.resolve()
    ok = check(root)
    if args.sheet or args.sheet_only:
        contact_sheet(root, (args.work or Path(tempfile.mkdtemp(prefix="parts_tiles_"))).resolve(),
                      args.sheet_only, args.sheet_out.resolve() if args.sheet_out else None)
    if not ok:
        sys.exit(1)


main()
