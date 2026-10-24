"""部品（assets/parts/）を 1 個ずつ 3D で回して見られる、自己完結の HTML 1 枚を作る。

ブラウザは USDZ（中身は usdc）を直接は読めないので、Blender で各部品の USDZ を読み直して GLB に書き出し、
three.js で表示する。three.js は版を固定して npm から一度だけ取り、esbuild で 1 つにまとめて HTML に埋め込む。
GLB・USDZ（iPhone の AR Quick Look 用）・一覧の小さな画像も HTML に埋め込むので、オフラインで開ける。

  1. npm で three・esbuild を取る（--cache に置く。2 回目からは使い回す）
  2. Blender で各部品の USDZ → GLB と、contact_sheet.png を縮めた一覧の画像を作る（このスクリプトを Blender の中で動かす）
  3. HTML を組み立てる（assets/parts/build/preview.html。commit しない）

使い方（Blender の外の Python 3 で動かす）:
  python3 scripts/scene/preview_parts.py [--blender <Blender のパス>] [--cache <取得した JS を置く場所>] [--out <HTML>]
"""
from __future__ import annotations

import argparse
import ast
import base64
import html
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PARTS = REPO / "assets" / "parts"
THREE_VERSION = "0.170.0"
ESBUILD_VERSION = "0.24.0"
THUMB = 80   # 一覧の小さな画像の 1 マスの大きさ（px）。contact_sheet.png の 1 マス 256 px を縮める


# ---------- Blender の中で動かす部分 ----------

def blender_main(argv: list[str]) -> None:
    """各部品の USDZ を GLB に書き出し、contact_sheet.png を縮めた画像を作る。"""
    import bpy

    ap = argparse.ArgumentParser(prog="preview_parts.py (Blender)")
    ap.add_argument("--work", type=Path, required=True)
    args = ap.parse_args(argv)
    work: Path = args.work
    (work / "glb").mkdir(parents=True, exist_ok=True)
    index = json.loads((PARTS / "index.json").read_text(encoding="utf-8"))
    for meta in index:
        pid = meta["id"]
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.wm.usd_import(filepath=str(PARTS / pid / f"{meta['version']}.usdz"))
        out = work / "glb" / f"{pid}.glb"
        bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", export_yup=True,
                                  export_cameras=False, export_lights=False, export_animations=False)
        print(f"wrote {out} {out.stat().st_size / 1e3:.0f} kB")

    # 一覧の画像。contact_sheet.png（1 マス 256 px）を 1 マス THUMB px に縮めて JPEG にする
    bpy.ops.wm.read_factory_settings(use_empty=True)
    img = bpy.data.images.load(str(PARTS / "contact_sheet.png"))
    w, h = img.size
    img.scale(w * THUMB // 256, h * THUMB // 256)
    settings = bpy.context.scene.render.image_settings
    settings.file_format, settings.color_mode, settings.quality = "JPEG", "RGB", 82
    img.save_render(str(work / "thumbs.jpg"))
    print(f"wrote {work / 'thumbs.jpg'}")


# ---------- Blender の外で動かす部分 ----------

def sheet_order() -> list[str]:
    """contact_sheet.png に並んでいる部品の順（check_parts.py の EXPECTED）。check_parts.py は Blender でしか動かないので、ソースから読む。"""
    tree = ast.parse((REPO / "scripts" / "scene" / "check_parts.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "EXPECTED" for t in node.targets):
            return ast.literal_eval(node.value)
    raise SystemExit("check_parts.py に EXPECTED が無い")


def sheet_cols() -> int:
    tree = ast.parse((REPO / "scripts" / "scene" / "check_parts.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "COLS" for t in node.targets):
            return ast.literal_eval(node.value)
    raise SystemExit("check_parts.py に COLS が無い")


def three_bundle(cache: Path) -> str:
    """three.js（GLTFLoader・OrbitControls・RoomEnvironment つき）を 1 つの IIFE にまとめた JS を返す。"""
    bundle = cache / f"three-{THREE_VERSION}.bundle.js"
    if bundle.exists():
        return bundle.read_text(encoding="utf-8")
    cache.mkdir(parents=True, exist_ok=True)
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("npm が無い（brew install node）")
    subprocess.run([npm, "install", "--no-save", "--no-audit", "--no-fund", "--prefix", str(cache),
                    f"three@{THREE_VERSION}", f"esbuild@{ESBUILD_VERSION}"], check=True)
    entry = cache / "entry.js"
    entry.write_text(
        "import * as THREE from 'three';\n"
        "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';\n"
        "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\n"
        "import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';\n"
        "window.PV = { THREE, GLTFLoader, OrbitControls, RoomEnvironment };\n", encoding="utf-8")
    subprocess.run([str(cache / "node_modules" / ".bin" / "esbuild"), str(entry), "--bundle", "--minify",
                    "--format=iife", "--target=es2020", "--legal-comments=none", f"--outfile={bundle}"],
                   check=True, cwd=cache)
    return bundle.read_text(encoding="utf-8")


def find_blender(arg: str | None) -> str:
    for cand in (arg, os.environ.get("BLENDER"), shutil.which("blender"),
                 "/Applications/Blender.app/Contents/MacOS/Blender"):
        if cand and Path(cand).exists():
            return cand
    raise SystemExit("Blender が見つからない（--blender で指定する）")


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def build_html(index: list[dict], work: Path, js_lib: str) -> str:
    order = sheet_order()
    cols = sheet_cols()
    thumbs = {pid: [order.index(pid) % cols, order.index(pid) // cols] for pid in order}
    blobs = []
    for meta in index:
        pid = meta["id"]
        blobs.append(f'<script type="application/octet-stream" id="glb-{pid}">{b64(work / "glb" / f"{pid}.glb")}</script>')
        usdz = PARTS / pid / f"{meta['version']}.usdz"
        blobs.append(f'<script type="application/octet-stream" id="usdz-{pid}">{b64(usdz)}</script>')
    data = {"parts": index, "thumbs": thumbs, "thumb": THUMB}
    page = TEMPLATE
    for key, value in {
        "__DATA__": json.dumps(data, ensure_ascii=False).replace("</", "<\\/"),
        "__THUMBS__": b64(work / "thumbs.jpg"),
        "__THREE__": js_lib.replace("</script", "<\\/script"),
        "__THREE_VERSION__": html.escape(THREE_VERSION),
        "__BLOBS__": "\n".join(blobs),
        "__COUNT__": str(len(index)),
    }.items():
        page = page.replace(key, value)
    return page


def main() -> None:
    ap = argparse.ArgumentParser(prog="preview_parts.py")
    ap.add_argument("--blender", help="Blender のパス（既定は $BLENDER、PATH の blender、/Applications の Blender）")
    ap.add_argument("--cache", type=Path, default=PARTS / "build" / "vendor",
                    help="npm で取った three・esbuild を置く場所（既定は assets/parts/build/vendor）")
    ap.add_argument("--out", type=Path, default=PARTS / "build" / "preview.html")
    args = ap.parse_args()
    out: Path = args.out.resolve()
    work = out.parent / "preview_work"
    js_lib = three_bundle(args.cache.resolve())
    subprocess.run([find_blender(args.blender), "--background", "--factory-startup", "--python-exit-code", "1",
                    "--python", __file__, "--", "--work", str(work)], check=True)
    index = json.loads((PARTS / "index.json").read_text(encoding="utf-8"))
    out.write_text(build_html(index, work, js_lib), encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB, {len(index)} parts)")


TEMPLATE = r"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>部品のプレビュー</title>
<style>
:root {
  --bg: #f4f5f7; --panel: #ffffff; --ink: #1d2128; --muted: #646b78; --line: #dde0e6;
  --accent: #2f6fd0; --chip: #eef2f8; --stage: #e9ecf1;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #15171b; --panel: #1f2228; --ink: #e8eaee; --muted: #9aa1ad; --line: #2f333b;
          --accent: #6ea2f0; --chip: #2a2f38; --stage: #23262c; }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif; }
body { display: flex; flex-direction: column; min-height: 100dvh; }
header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; padding-top: max(10px, env(safe-area-inset-top));
  border-bottom: 1px solid var(--line); background: var(--panel); touch-action: pan-y; }
header h1 { font-size: 16px; margin: 0; flex: 1; }
.count { font-variant-numeric: tabular-nums; color: var(--muted); }
button { font: inherit; color: var(--ink); background: var(--chip); border: 1px solid var(--line);
  border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
main { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 340px; min-height: 0; }
.stage { position: relative; background: var(--stage); min-height: 320px; }
.stage canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 64px; padding: 0;
  font-size: 26px; background: color-mix(in srgb, var(--panel) 80%, transparent); }
.nav.prev { left: 8px; } .nav.next { right: 8px; }
.loading { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); pointer-events: none; }
.tools { position: absolute; left: 8px; bottom: 8px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.tools label { background: color-mix(in srgb, var(--panel) 85%, transparent); border: 1px solid var(--line);
  border-radius: 8px; padding: 4px 8px; font-size: 13px; }
.grid-note { font-size: 12px; color: var(--muted); background: color-mix(in srgb, var(--panel) 85%, transparent);
  border-radius: 6px; padding: 2px 6px; }
#ar { position: absolute; right: 8px; bottom: 8px; display: none; }
#ar img { width: 1px; height: 1px; position: absolute; opacity: 0; }
#ar span { display: inline-block; background: var(--accent); color: #fff; border-radius: 8px; padding: 8px 12px; font-size: 14px; }
.info { background: var(--panel); border-left: 1px solid var(--line); padding: 16px; overflow: auto; touch-action: pan-y;
  user-select: none; -webkit-user-select: none; }
.info h2 { margin: 0 0 2px; font-size: 20px; }
.info .id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); margin: 0 0 12px; word-break: break-all; }
dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; }
dt { color: var(--muted); } dd { margin: 0; word-break: break-word; }
.chip { display: inline-block; background: var(--chip); border-radius: 999px; padding: 0 8px; margin: 0 4px 4px 0; font-size: 13px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.hint { margin-top: 16px; color: var(--muted); font-size: 13px; border-top: 1px dashed var(--line); padding-top: 10px; }
.swipe-hint { display: none; }
#list { position: fixed; inset: 0; background: color-mix(in srgb, var(--bg) 96%, transparent); display: none;
  overflow: auto; padding: 16px; padding-top: max(16px, env(safe-area-inset-top)); z-index: 10; }
#list.open { display: block; }
#list .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
#list ol { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
#list li button { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px;
  background: var(--panel); text-align: center; font-size: 12px; }
#list li button[aria-current="true"] { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
.thumb { width: 80px; height: 80px; border-radius: 6px; background-image: url(data:image/jpeg;base64,__THUMBS__);
  background-repeat: no-repeat; }
.fade { animation: fade .18s ease-out; }
@keyframes fade { from { opacity: .3; } to { opacity: 1; } }
@media (max-width: 760px) {
  main { grid-template-columns: 1fr; grid-template-rows: minmax(300px, 58dvh) auto; }
  .info { border-left: 0; border-top: 1px solid var(--line); }
  .swipe-hint { display: block; text-align: center; color: var(--muted); font-size: 13px; margin: -4px 0 8px; }
  .nav { width: 36px; height: 52px; font-size: 22px; }
}
</style>
</head>
<body>
<header id="bar">
  <h1>部品のプレビュー</h1>
  <span class="count" id="count">1 / __COUNT__</span>
  <button id="open-list" type="button">一覧</button>
</header>
<main>
  <section class="stage" id="stage" aria-label="部品の 3D 表示（ドラッグで回す、ピンチで拡大）">
    <canvas id="view"></canvas>
    <div class="loading" id="loading">読み込み中…</div>
    <button class="nav prev" id="prev" type="button" aria-label="前の部品">‹</button>
    <button class="nav next" id="next" type="button" aria-label="次の部品">›</button>
    <div class="tools">
      <label><input type="checkbox" id="show-anchors" checked> anchors の点</label>
      <label><input type="checkbox" id="spin" checked> 自動で回す</label>
      <span class="grid-note" id="grid-note"></span>
    </div>
    <a id="ar" rel="ar" href="#"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><span>AR で見る</span></a>
  </section>
  <section class="info" id="info" aria-live="polite">
    <div class="swipe-hint">← この枠を左右にスワイプして切り替え →</div>
    <div id="card"></div>
    <p class="hint">部品の表示: ドラッグで回す・ピンチ（ホイール）で拡大。切り替え: この枠かいちばん上の帯を左右にスワイプ、‹ › のボタン、キーボードの ← →。</p>
  </section>
</main>
<div id="list" role="dialog" aria-label="部品の一覧">
  <div class="top"><strong>部品の一覧（__COUNT__ 個）</strong><button id="close-list" type="button">閉じる</button></div>
  <ol id="list-items"></ol>
</div>
<script type="application/json" id="data">__DATA__</script>
__BLOBS__
<script>/* three.js __THREE_VERSION__ (MIT License, https://threejs.org) */
__THREE__</script>
<script>
(() => {
  const { THREE, GLTFLoader, OrbitControls, RoomEnvironment } = window.PV;
  const DATA = JSON.parse(document.getElementById("data").textContent);
  const PARTS = DATA.parts;
  const $ = (id) => document.getElementById(id);
  let current = 0;

  // ---------- 3D の表示 ----------
  const canvas = $("view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;
  controls.addEventListener("start", () => { $("spin").checked = false; controls.autoRotate = false; });
  $("spin").addEventListener("change", (e) => { controls.autoRotate = e.target.checked; });

  const holder = new THREE.Group();   // いま表示している部品・床のマス・anchors の点
  scene.add(holder);
  const loader = new GLTFLoader();
  const cache = new Map();            // id → Promise<THREE.Object3D>。表示中と前後だけを持つ

  function bytes(id) {
    const text = document.getElementById(id).textContent.trim();
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function load(i) {
    const pid = PARTS[i].id;
    if (!cache.has(pid)) {
      cache.set(pid, new Promise((resolve, reject) => {
        loader.parse(bytes(`glb-${pid}`).buffer, "", (gltf) => resolve(gltf.scene), reject);
      }));
    }
    return cache.get(pid);
  }
  function dispose(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose());
    });
  }
  function trimCache() {
    const keep = new Set([-1, 0, 1].map((d) => PARTS[(current + d + PARTS.length) % PARTS.length].id));
    for (const [pid, p] of cache) {
      if (!keep.has(pid)) { cache.delete(pid); p.then(dispose, () => {}); }
    }
  }

  function marker(color) {
    return new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
  }
  function anchorMarkers(meta, r) {
    const g = new THREE.Group();
    const a = meta.anchors || {};
    const dot = Math.max(0.012, r * 0.03);
    if (a.top !== undefined) {   // 上に置ける面: 外接箱の幅と奥行きの薄い枠
      const [w, , d] = meta.size;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, d)),
        new THREE.LineBasicMaterial({ color: 0xff8a00, depthTest: false }));
      edges.rotation.x = -Math.PI / 2;
      edges.position.y = a.top;
      g.add(edges);
      const m = marker(0xff8a00); m.scale.setScalar(dot); m.position.set(0, a.top, 0); g.add(m);
    }
    for (const [key, color] of [["seat", 0x16a34a], ["hip", 0xdb2777]]) {
      if (!a[key]) continue;
      const m = marker(color); m.scale.setScalar(dot); m.position.set(...a[key]); g.add(m);
    }
    g.renderOrder = 10;
    g.traverse((o) => { o.renderOrder = 10; });
    return g;
  }

  function frame(meta) {
    const [w, h, d] = meta.size;
    const r = Math.max(0.05, Math.hypot(w, h, d) / 2);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = Math.max(0.5, camera.aspect);
    const dist = (r / Math.sin(fov / 2)) * (aspect < 1 ? 1 / aspect : 1) * 1.05;
    const yaw = THREE.MathUtils.degToRad(25), pitch = THREE.MathUtils.degToRad(20);
    controls.target.set(0, h / 2, 0);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, h / 2 + Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.near = dist / 100; camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.minDistance = r * 0.6; controls.maxDistance = dist * 4;
    controls.update();
    return r;
  }

  async function show(i) {
    current = (i + PARTS.length) % PARTS.length;
    const meta = PARTS[current];
    renderCard(meta);
    $("loading").style.display = "grid";
    const token = current;
    let obj;
    try { obj = await load(current); } catch (e) { $("loading").textContent = "読み込めませんでした"; return; }
    if (token !== current) return;   // 読み込み中に次へ進んだ
    holder.clear();
    holder.add(obj);
    const r = frame(meta);
    // 床のマス（大きさの目安）。1 m を超える部品は 1 m、それより小さいものは 10 cm のマス
    const span = Math.max(meta.size[0], meta.size[2]);
    const cell = span > 1 ? 1 : 0.1;
    const n = Math.max(4, Math.ceil((span * 1.6) / cell / 2) * 2);
    const grid = new THREE.GridHelper(n * cell, n, 0x8a919e, 0xb8bdc6);
    grid.material.transparent = true; grid.material.opacity = 0.5;
    grid.position.y = -0.0005;
    holder.add(grid);
    $("grid-note").textContent = `床のマス ${cell === 1 ? "1 m" : "10 cm"}`;
    const marks = anchorMarkers(meta, r);
    marks.visible = $("show-anchors").checked;
    holder.add(marks);
    $("loading").style.display = "none";
    canvas.classList.remove("fade"); void canvas.offsetWidth; canvas.classList.add("fade");
    trimCache();
    load(current + 1 < PARTS.length ? current + 1 : 0);                // 次と前を先に読んでおく
    load(current > 0 ? current - 1 : PARTS.length - 1);
    updateAr(meta);
  }
  $("show-anchors").addEventListener("change", (e) => {
    holder.children.forEach((c) => { if (c.renderOrder === 10) c.visible = e.target.checked; });
  });

  function resize() {
    const box = $("stage").getBoundingClientRect();
    renderer.setSize(box.width, box.height, false);
    camera.aspect = box.width / Math.max(1, box.height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(() => { resize(); if (PARTS[current]) frame(PARTS[current]); }).observe($("stage"));
  resize();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  // ---------- 情報 ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CATEGORY = { person: "人物", animal: "動物", plant: "植物", food: "食べ物", furniture: "家具", vehicle: "乗り物",
                     building: "建物", ground: "地面", thing: "物" };
  function renderCard(meta) {
    const [w, h, d] = meta.size;
    const words = meta.words.map((x) => `<span class="chip">${esc(x.word)} <small>${x.pos === "verb" ? "動詞" : "名詞"}</small></span>`).join("");
    const a = meta.anchors;
    const anchors = a ? Object.entries(a).map(([k, v]) =>
      `<div><code>${esc(k)}</code>: <code>${esc(Array.isArray(v) ? `[${v.join(", ")}]` : v)}</code></div>`).join("") : "なし";
    $("card").innerHTML = `
      <h2>${esc(meta.label)}</h2>
      <p class="id">${esc(meta.id)}　·　版 ${esc(meta.version)}</p>
      <dl>
        <dt>カテゴリ</dt><dd>${esc(CATEGORY[meta.category] || meta.category)} <code>${esc(meta.category)}</code></dd>
        <dt>大きさ</dt><dd>幅 ${w} × 高さ ${h} × 奥行き ${d} m</dd>
        <dt>words</dt><dd>${words}</dd>
        <dt>pose</dt><dd>${meta.pose ? `<code>${esc(meta.pose)}</code>` : "なし"}</dd>
        <dt>anchors</dt><dd>${anchors}</dd>
      </dl>`;
    $("count").textContent = `${current + 1} / ${PARTS.length}`;
    document.querySelectorAll("#list-items button").forEach((b, k) => b.setAttribute("aria-current", String(k === current)));
    try { history.replaceState(null, "", `#${meta.id}`); } catch (e) { /* file:// で拒まれても続ける */ }
  }

  // ---------- AR（iPhone の Safari だけ。埋め込んだ USDZ を Blob URL で AR Quick Look に渡す） ----------
  const arLink = $("ar");
  const canAr = arLink.relList && arLink.relList.supports && arLink.relList.supports("ar");
  let arUrl = null;
  function updateAr(meta) {
    if (!canAr) return;
    if (arUrl) URL.revokeObjectURL(arUrl);
    arUrl = URL.createObjectURL(new Blob([bytes(`usdz-${meta.id}`)], { type: "model/vnd.usdz+zip" }));
    arLink.href = `${arUrl}#allowsContentScaling=0`;
    arLink.style.display = "block";
  }

  // ---------- 切り替え ----------
  const next = () => show(current + 1);
  const prev = () => show(current - 1);
  $("next").addEventListener("click", next);
  $("prev").addEventListener("click", prev);
  document.addEventListener("keydown", (e) => {
    if ($("list").classList.contains("open")) { if (e.key === "Escape") closeList(); return; }
    if (e.key === "ArrowRight") next();
    if (e.key === "ArrowLeft") prev();
  });
  // スワイプは 3D の表示の外（情報の枠と、いちばん上の帯）だけで受ける。表示の中のドラッグは回す操作にする
  function swipeArea(el) {
    let start = null;
    el.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { start = null; return; }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    el.addEventListener("touchend", (e) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x, dy = t.clientY - start.y;
      start = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? next : prev)();
    }, { passive: true });
  }
  swipeArea($("info"));
  swipeArea($("bar"));

  // ---------- 一覧 ----------
  const items = $("list-items");
  PARTS.forEach((meta, k) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const pos = DATA.thumbs[meta.id];
    const thumb = document.createElement("span");
    thumb.className = "thumb";
    if (pos) thumb.style.backgroundPosition = `-${pos[0] * DATA.thumb}px -${pos[1] * DATA.thumb}px`;
    b.append(thumb, Object.assign(document.createElement("span"), { textContent: `${k + 1}. ${meta.label}` }));
    b.addEventListener("click", () => { closeList(); show(k); });
    li.append(b);
    items.append(li);
  });
  function closeList() { $("list").classList.remove("open"); $("open-list").focus(); }
  $("open-list").addEventListener("click", () => { $("list").classList.add("open"); $("close-list").focus(); });
  $("close-list").addEventListener("click", closeList);

  const start = PARTS.findIndex((m) => `#${m.id}` === location.hash);
  show(start >= 0 ? start : 0);
})();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    try:
        import bpy  # noqa: F401  Blender の中で動いているか
    except ImportError:
        main()
    else:
        blender_main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
