#!/usr/bin/env python3
"""画面設計書（to-be・モック）を自己完結の HTML 1 ファイルに生成する。

入力:
  <src>/app.toml            アプリ全体（起動時の画面と、全体の前提）
  <src>/screens/<id>.md     画面ごとの元データ（TOML frontmatter + Markdown 本文）
  <src>/images/<image>      固まった仮の画面（commit する）
  <src>/drafts/<image>      仮の画面の下書き（gitignore。images に無いときに使う）
  画像がどちらにも無い画面はプレースホルダーで出す。

出力:
  <out>  外部依存なし（PNG は base64 埋め込み、遷移図は inline SVG）。
         --pdf を付けると同名の .pdf も Google Chrome の headless 印刷で作る。

依存: Python 3.11+（tomllib）、graphviz の dot（遷移図。無ければ図を省略して警告）、
      rsvg-convert（未作成のプレースホルダー。無ければ CSS の枠で代用）、Google Chrome（--pdf）。
使い方: python3 scripts/ui-spec/build.py [--src docs/design/ui] [--out docs/design/ui/build/ui-spec.html] [--pdf]
参考: WordinCard の scripts/ui-spec/build.py（as-is の画面設計書）を to-be のモック用に縮めたもの。
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import html
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

GROUP_ORDER = [
    ("room", "部屋"),
    ("play", "プレイ"),
    ("result", "結果"),
    ("record", "きろく・設定"),
]
# 画面の状態（frontmatter の status）。頭の語で種類を見分ける（例: 「案（直し待ち）」は「案」）。
# 札の色と、遷移図の枠・矢印の描き方
STATUS = {
    "実装済み": dict(cls="done", node=None, edge=None),
    "確定": dict(cls="fixed", node='color="#64748b", style="rounded", penwidth=2.5', edge=None),
    "案": dict(cls="pending", node='color="#E8771E", style="rounded,dashed", penwidth=3', edge='color="#E8771E", fontcolor="#c2410c", style=dashed, penwidth=1.6'),
    "未確定": dict(cls="open", node='color="#9ca3af", style="rounded,dotted", penwidth=3', edge='color="#9ca3af", fontcolor="#6b7280", style=dotted, penwidth=1.6'),
}


def status_kind(status: str) -> str | None:
    """status の頭の語から、STATUS の種類を返す（無ければ None）。"""
    return next((k for k in STATUS if status.startswith(k)), None)


def status_tag(status: str) -> str:
    """遷移図のノードに添える短い状態（例: 確定 #116、案、未確定）。"""
    kind = status_kind(status)
    prs = re.findall(r"#\d+", status)
    # 幅に収めるため、2 つ目からは # を省く（例: 案 #114・116）
    return f'{kind} #{"・".join(p.lstrip("#") for p in prs)}' if kind and prs else (kind or status)


DISCUSSION_SECTIONS = ["課題", "改善案", "決定"]
IMAGE_STATE = {"final": "確定", "draft": "下書き", "none": "未作成"}


# ---------- 入力 ----------

def read_screen(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^\+\+\+\n(.*?)\n\+\+\+\n?(.*)$", text, re.S)
    if not m:
        sys.exit(f"{path}: frontmatter（+++ … +++）がありません")
    meta = tomllib.loads(m.group(1))
    meta.setdefault("id", path.stem)
    meta["body_sections"] = split_sections(m.group(2))
    return meta


def split_sections(body: str) -> dict[str, str]:
    """`## 見出し` ごとに本文を分ける。見出し前の本文は "" キーに入れる。"""
    sections: dict[str, str] = {}
    current = ""
    buf: list[str] = []
    for line in body.splitlines():
        h = re.match(r"^##\s+(.+?)\s*$", line)
        if h:
            sections[current] = "\n".join(buf).strip()
            current, buf = h.group(1), []
        else:
            buf.append(line)
    sections[current] = "\n".join(buf).strip()
    return sections


def md_to_html(md: str) -> str:
    """最小の Markdown 変換（段落・箇条書き・`code`・**強調**・[リンク](先)）。"""
    out: list[str] = []
    para: list[str] = []
    in_list = False

    def link(m: re.Match) -> str:
        text, url = m.group(1), m.group(2)
        # 同じフォルダの画面（./<id>.md）は下の画面カードへ、http は外へ。ほかは文字だけ残す
        card = re.fullmatch(r"\./([\w-]+)\.md", url)
        href = f"#{card.group(1)}" if card else url if url.startswith("http") else None
        return f'<a href="{href}">{text}</a>' if href else text

    def inline(s: str) -> str:
        s = html.escape(s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, s)
        return s

    def flush():
        nonlocal para
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para = []

    for line in md.splitlines():
        if re.match(r"^\s*[-*]\s+", line):
            flush()
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append("<li>" + inline(re.sub(r"^\s*[-*]\s+", "", line)) + "</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        if not line.strip():
            flush()
        else:
            para.append(line.strip())
    flush()
    if in_list:
        out.append("</ul>")
    return "\n".join(out)


# ---------- 画像 ----------

def data_uri(path: Path) -> str:
    mime = "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def thumb(path: Path, height: int, fmt: str) -> Path:
    """埋め込み用に縮小した画像を build/ に作る（macOS の sips が無ければ元の画像を返す）。"""
    if not shutil.which("sips") or path.parent == PLACEHOLDER_DIR:
        return path
    out = PLACEHOLDER_DIR.parent / "thumbs" / f"{path.stem}-{height}.{'jpg' if fmt == 'jpeg' else 'png'}"
    if out.exists() and out.stat().st_mtime >= path.stat().st_mtime:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    # 元が height 以下なら縮めない（形式だけ変える）。iPhone の 1 画面ぶんの画像を荒くしないため
    cmd = ["sips", "-s", "format", fmt] if max(pixel_size(path)) <= height else ["sips", "-Z", str(height), "-s", "format", fmt]
    if fmt == "jpeg":
        cmd += ["-s", "formatOptions", "82"]
    subprocess.run(cmd + [str(path), "--out", str(out)], check=True, capture_output=True)
    return out


PLACEHOLDER_DIR: Path = Path("docs/design/ui/build/placeholders")  # build() が out に合わせて差し替える


def placeholder_png(sid: str, title: str) -> Path | None:
    """未作成の画面用に、スマホ形のダミー PNG を作る（rsvg-convert が無ければ None）。"""
    if not shutil.which("rsvg-convert"):
        return None
    out = PLACEHOLDER_DIR / f"{sid}.png"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    bg, fg, bar = "#f1f5f9", "#475569", "#e2e8f0"
    w, h = 402, 874
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<rect x="1" y="1" width="{w-2}" height="{h-2}" rx="48" fill="{bg}" stroke="#94a3b8" stroke-width="2"/>
<rect x="24" y="90" width="{w-48}" height="44" rx="10" fill="{bar}"/>
<rect x="24" y="160" width="{w-48}" height="{h-320}" rx="18" fill="{bar}" opacity="0.6"/>
<rect x="24" y="{h-110}" width="{w-48}" height="70" rx="14" fill="{bar}"/>
<text x="{w/2}" y="{h/2-10}" text-anchor="middle" font-family="Hiragino Sans, sans-serif" font-size="30" font-weight="600" fill="{fg}">{html.escape(title)}</text>
<text x="{w/2}" y="{h/2+36}" text-anchor="middle" font-family="Helvetica, sans-serif" font-size="18" fill="{fg}">（未作成）</text>
</svg>"""
    subprocess.run(["rsvg-convert", "-o", str(out)], input=svg.encode(), check=True)
    return out


def image_names(s: dict) -> list[str]:
    """frontmatter の image（文字列か、複数の画像の配列）をファイル名の一覧にする。"""
    img = s.get("image", f"{s['id']}.png")
    return [img] if isinstance(img, str) else list(img)


def image_paths(src: Path, s: dict) -> list[tuple[Path, str]]:
    """画面の画像と状態（final / draft）の一覧。見つからない画像は飛ばす。"""
    found = []
    for name in image_names(s):
        for state, folder in (("final", "images"), ("draft", "drafts")):
            p = src / folder / name
            if p.exists():
                found.append((p, state))
                break
    return found


def image_path(src: Path, s: dict) -> tuple[Path | None, str]:
    """画面の 1 枚目の画像と状態（final / draft / none）を返す。遷移図のノードと状態の札に使う。"""
    found = image_paths(src, s)
    if found:
        return found[0]
    return placeholder_png(s["id"], s["title"]), "none"


def pixel_size(path: Path) -> tuple[int, int]:
    """画像の横と縦の画素数（macOS の sips で読む。読めなければ iPhone の 1 画面ぶんとみなす）。"""
    if shutil.which("sips"):
        out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)], capture_output=True, text=True).stdout
        size = dict(re.findall(r"pixel(Width|Height):\s*(\d+)", out))
        if size.get("Width") and size.get("Height"):
            return int(size["Width"]), int(size["Height"])
    return 1206, 2622


def aspect(path: Path) -> float:
    """画像の縦 ÷ 横。"""
    w, h = pixel_size(path)
    return h / w


# 画面カードに埋める画像の長辺の上限。iPhone の 1 画面ぶん（長辺 2622 など）は縮めない
CARD_MAX = 2800


def frame_html(p: Path, alt: str, label: str = "") -> str:
    # 縦に長い画像は切り抜かず、枠の中で縦にスクロールさせる
    tall = aspect(p) > 19.5 / 9 * 1.05
    frame = (f'<div class="frame{" tall" if tall else ""}">'
             f'<img src="{data_uri(thumb(p, CARD_MAX, "jpeg"))}" alt="{alt}"></div>')
    return f'<div class="frame-item">{frame}<div class="frame-label">{html.escape(label)}</div></div>' if label else frame


def image_html(src: Path, s: dict) -> str:
    found = image_paths(src, s)
    p, state = image_path(src, s)
    label = IMAGE_STATE[state]
    if found:
        # 画像が複数（長い画面を上下に分けたものなど）なら、縮めずに横に並べる
        alt = html.escape(s["title"])
        labels = list(s.get("image_labels", [])) + [""] * len(found)
        frames = "".join(frame_html(q, f"{alt}（{i + 1}/{len(found)}）", labels[i]) for i, (q, _) in enumerate(found))
        multi = len(found) > 1
        tall = any(aspect(q) > 19.5 / 9 * 1.05 for q, _ in found)
        hint = f"（{len(found)} 枚）" if multi else ("（縦にスクロール）" if tall else "")
        return (f'<figure class="shot {state}{" multi" if multi else ""}"><div class="frames">{frames}</div>'
                f"<figcaption>{label}{hint}</figcaption></figure>")
    if p:  # 未作成の画面のダミー画像
        return (f'<figure class="shot {state}"><div class="frames">{frame_html(p, html.escape(s["title"]))}</div>'
                f"<figcaption>{label}</figcaption></figure>")
    return (f'<figure class="shot none"><div class="placeholder"><span>{html.escape(s["title"])}<br>'
            f'<small>{html.escape(s["id"])}（未作成）</small></span></div>'
            f"<figcaption>{label}</figcaption></figure>")


# ---------- 遷移図 ----------

def short(label: str, n: int = 14) -> str:
    label = re.sub(r"[（(].*?[）)]", "", label).strip()
    return label if len(label) <= n else label[: n - 1] + "…"


def flow_svg(screens: list[dict], app: dict, src: Path) -> str:
    """画面（仮の画面）をノード、遷移をエッジにした遷移マップ。"""
    if not shutil.which("dot"):
        print("warning: dot が無いので遷移図を省略します", file=sys.stderr)
        return '<p class="muted">（graphviz が無いため遷移図は省略）</p>'
    ids = {s["id"] for s in screens}
    lines = [
        "digraph G {",
        'graph [rankdir=LR, fontname="Helvetica", bgcolor="transparent", nodesep=0.35, ranksep=0.9, splines=true, newrank=true];',
        'node [shape=box, style="rounded,filled", fillcolor="#ffffff", color="#9ca3af", fontname="Hiragino Sans", fontsize=12, fixedsize=true, width=1.5, height=3.6, labelloc=b, penwidth=1.2];',
        'edge [color="#64748b", fontname="Hiragino Sans", fontsize=8, fontcolor="#475569", arrowsize=0.6, penwidth=1.0];',
    ]
    for key, label in GROUP_ORDER:
        members = [s for s in screens if s.get("group") == key]
        if not members:
            continue
        lines.append(f'subgraph cluster_{key} {{ label="{label}"; color="#cbd5e1"; fontcolor="#64748b"; fontsize=12; style="rounded,dashed"; margin=14;')
        for s in members:
            shot, _ = image_path(src, s)
            st = STATUS[status_kind(s.get("status", "")) or "実装済み"]
            if shot:
                shot = thumb(shot, 400, "png")
                frame = st["node"] or 'style="rounded", color="transparent"'
                # 長い名前は、枠からはみ出さないよう括弧の中を外す（カードには元の名前を出す）
                title = s["title"] if len(s["title"]) <= 11 else re.sub(r"（.*?）", "", s["title"])
                label = title if not st["node"] else f'{title}\\n{status_tag(s["status"])}'
                lines.append(
                    f'"{s["id"]}" [shape=box, {frame}, label="{label}", image="{shot.resolve()}", '
                    f'imagescale=true, imagepos="tc", labelloc=b, fixedsize=true, width=1.6, height={4.15 if st["node"] else 3.85}, URL="#{s["id"]}"];')
            else:
                lines.append(f'"{s["id"]}" [label="{s["title"]}", fillcolor="#f1f5f9", style="rounded,filled,dashed", URL="#{s["id"]}"];')
        lines.append("}")
    lines.append('"_launch" [label="起動", shape=circle, fixedsize=true, width=0.55, height=0.55, fillcolor="#111827", fontcolor="white", labelloc=c];')
    for e in app.get("entry", []):
        if e.get("to") in ids:
            lines.append(f'"_launch" -> "{e["to"]}" [label="{short(e.get("trigger", ""))}", style=dashed];')
    seen = set()
    by_status = {s["id"]: s.get("status", "") for s in screens}
    for s in screens:
        for ex in s.get("exits", []):
            to = ex.get("to")
            if to in ids and to != s["id"] and (s["id"], to) not in seen:
                seen.add((s["id"], to))
                how = ex.get("how", "")
                # 全員の画面が同時に移る遷移は色を変え、操作なしで進む遷移は破線にする
                attrs = ['color="#4f46e5"', 'fontcolor="#4f46e5"', "penwidth=1.6"] if "全員" in how else []
                if how == "自動":
                    attrs.append("style=dashed")
                if how == "戻る":
                    attrs.append('color="#cbd5e1"')
                # 案・未確定の遷移は、色と線で見分ける。exits の status が無ければ、どちらかの端が未確定なら未確定、
                # 片方の端が案で、もう片方が案か確定なら案（実装済みの画面とのあいだの遷移は今のまま）
                ends = {status_kind(by_status.get(s["id"], "")), status_kind(by_status.get(to, ""))}
                est = status_kind(ex["status"]) if ex.get("status") else ("未確定" if "未確定" in ends else "案" if "案" in ends and ends <= {"案", "確定"} else None)
                if est and STATUS[est]["edge"]:
                    attrs = [STATUS[est]["edge"]]
                lines.append(f'"{s["id"]}" -> "{to}" [label="{short(ex.get("trigger", ""))}"{", " + ", ".join(attrs) if attrs else ""}];')
    lines.append("}")
    dot_src = "\n".join(lines)
    (PLACEHOLDER_DIR.parent / "flow.dot").write_text(dot_src, encoding="utf-8")
    svg = subprocess.run(["dot", "-Tsvg"], input=dot_src, capture_output=True, text=True, check=True).stdout

    def embed(m: re.Match) -> str:
        return f'xlink:href="{data_uri(Path(m.group(1)))}"'
    svg = re.sub(r'xlink:href="([^"]+\.png)"', embed, svg)
    svg = svg[svg.index("<svg"):]
    return svg.replace("<svg ", '<svg class="flow" ', 1)


# ---------- HTML ----------

CSS = """
:root { --bg:#ffffff; --fg:#111827; --muted:#6b7280; --line:#e5e7eb; --card:#f9fafb; --accent:#2563eb;
        --final:#dcfce7; --final-fg:#166534; --draft:#fef3c7; --draft-fg:#92400e; --none:#fee2e2; --none-fg:#991b1b; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0f172a; --fg:#e5e7eb; --muted:#9ca3af; --line:#334155; --card:#1e293b; --accent:#60a5fa;
        --final:#14532d; --final-fg:#bbf7d0; --draft:#78350f; --draft-fg:#fde68a; --none:#7f1d1d; --none-fg:#fecaca; } }
:root[data-theme="dark"] { --bg:#0f172a; --fg:#e5e7eb; --muted:#9ca3af; --line:#334155; --card:#1e293b; --accent:#60a5fa;
        --final:#14532d; --final-fg:#bbf7d0; --draft:#78350f; --draft-fg:#fde68a; --none:#7f1d1d; --none-fg:#fecaca; }
* { box-sizing: border-box; }
body { margin:0; padding:0 16px 48px; background:var(--bg); color:var(--fg); font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif; line-height:1.6; }
main { max-width: none; margin: 0 auto; }
.flow-wrap { overflow-x:auto; margin:12px -16px; padding:0 16px; background:#ffffff; border-radius:12px; }
h1 { font-size:1.6rem; margin:24px 0 4px; } h2 { font-size:1.25rem; margin:40px 0 12px; border-bottom:1px solid var(--line); padding-bottom:6px; }
h3 { font-size:1.1rem; margin:0; } h4 { font-size:0.9rem; margin:14px 0 4px; color:var(--muted); font-weight:600; letter-spacing:.02em; }
.muted { color:var(--muted); } .meta { color:var(--muted); font-size:.85rem; margin-bottom:24px; }
table { border-collapse:collapse; width:100%; font-size:.9rem; } th,td { border-bottom:1px solid var(--line); padding:6px 8px; text-align:left; vertical-align:top; }
th { color:var(--muted); font-weight:600; font-size:.8rem; }
.badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:.75rem; font-weight:600; margin-right:4px; white-space:nowrap; }
.badge.st-done { background:#e0e7ff; color:#3730a3; }
.badge.st-fixed { background:#f1f5f9; color:#334155; border:1px solid #64748b; }
.badge.st-pending { background:#fff7ed; color:#c2410c; border:1px dashed #E8771E; }
.badge.st-open { background:#f9fafb; color:#6b7280; border:1px dotted #9ca3af; }
.status-note { font-size:.85rem; color:#4b5563; background:#f8fafc; border-left:3px solid #c7d2fe; padding:2px 8px; margin:4px 0; }
.frame-item { display:flex; flex-direction:column; gap:3px; } .frame-label { font-size:.72rem; color:var(--muted); text-align:center; line-height:1.3; }
.badge.final { background:var(--final); color:var(--final-fg); } .badge.draft { background:var(--draft); color:var(--draft-fg); } .badge.none { background:var(--none); color:var(--none-fg); }
section.screen { border:1px solid var(--line); border-radius:12px; padding:12px; margin:12px 0; background:var(--card); page-break-inside:avoid; display:grid; grid-template-columns: minmax(0,1fr); gap:12px; }
@media (min-width: 640px) { section.screen { grid-template-columns: 220px minmax(0,1fr); } }
section.screen header { display:flex; flex-wrap:wrap; gap:6px 10px; align-items:baseline; margin-bottom:4px; }
section.screen header code { font-size:.75rem; color:var(--muted); }
.role { margin:4px 0; } .links { margin:4px 0 8px; font-size:.88rem; } .links .k { color:var(--muted); font-size:.75rem; margin-right:4px; }
.links a { color:var(--accent); text-decoration:none; }
details { font-size:.88rem; } summary { cursor:pointer; color:var(--muted); margin:4px 0; }
details dl { margin:4px 0 0; } details dt { font-size:.78rem; color:var(--muted); font-weight:600; margin-top:8px; } details dd { margin:2px 0 0; }
details ul { margin:2px 0 0; padding-left:18px; }
.overview { margin-top:32px; } .overview summary { color:var(--fg); }
ul.notes { padding-left:20px; } ul.notes li { margin:2px 0; }
.shot { margin:0; }
.shot .frame, .placeholder { width:100%; max-width:220px; aspect-ratio: 9/19.5; border-radius:16px; border:1px solid var(--line); background:#fff; display:block; overflow:hidden; }
.shot .frame.tall { overflow-y:auto; overscroll-behavior:contain; }
.shot.multi .frames { display:grid; grid-template-columns:repeat(2, 220px); gap:8px; }
@media (min-width: 640px) { section.screen.multi { grid-template-columns: 448px minmax(0,1fr); } }
@media (max-width: 639px) { .shot.multi .frames { grid-template-columns:repeat(2, minmax(0,1fr)); } }
.shot .frame img { width:100%; height:auto; display:block; }
.placeholder { display:flex; align-items:center; justify-content:center; text-align:center; color:#6b7280; background:repeating-linear-gradient(45deg,#f3f4f6 0 10px,#e5e7eb 10px 20px); font-size:.8rem; padding:8px; }
figcaption { text-align:center; font-size:.75rem; color:var(--muted); margin-top:4px; }
.discussion { margin-top:6px; display:grid; gap:8px; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); }
.discussion > div { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; min-height:64px; font-size:.9rem; overflow-wrap:anywhere; }
.discussion .empty { color:var(--muted); font-style:italic; }
svg.flow { max-width:none; height:auto; display:block; margin:12px auto; }
code { font-family: ui-monospace, Menlo, monospace; font-size:.85em; }
.legend { font-size:.85rem; } .legend span { margin-right:14px; white-space:nowrap; }
@media print { .shot .frame.tall { aspect-ratio:auto; overflow:visible; } body { padding:0; } section.screen { break-inside:avoid; } h2 { break-before:page; } }
"""


def li_list(items: list[str]) -> str:
    if not items:
        return '<span class="muted">—</span>'
    return "<ul>" + "".join(f"<li>{html.escape(i)}</li>" for i in items) + "</ul>"


def edge_list(edges: list[dict], key: str, by_id: dict[str, dict]) -> str:
    if not edges:
        return '<span class="muted">—</span>'
    items = []
    for e in edges:
        other = e.get(key, "")
        name = by_id[other]["title"] if other in by_id else other
        link = f'<a href="#{html.escape(other)}">{html.escape(name)}</a>' if other in by_id else html.escape(name)
        extra = " ".join(x for x in [e.get("how", ""), e.get("trigger", "")] if x)
        items.append(f"<li>{link}" + (f' <span class="muted">（{html.escape(extra)}）</span>' if extra else "") + "</li>")
    return "<ul>" + "".join(items) + "</ul>"


def status_badge(s: dict) -> str:
    st = s.get("status", "")
    kind = status_kind(st)
    return f'<span class="badge st-{STATUS[kind]["cls"]}">状態: {html.escape(st)}</span>' if kind else ""


def screen_section(s: dict, src: Path, by_id: dict[str, dict]) -> str:
    _, state = image_path(src, s)
    multi = len(image_paths(src, s)) > 1
    body = s["body_sections"]
    filled = [n for n in DISCUSSION_SECTIONS if body.get(n)]
    discussion = "".join(
        f"<div><h4>{name}</h4>" + (md_to_html(body[name]) if body.get(name) else '<p class="empty">（未記入）</p>') + "</div>"
        for name in DISCUSSION_SECTIONS
    )

    def names(edges, key):
        out = []
        for e in edges:
            other = e.get(key, "")
            if other in by_id:
                out.append(f'<a href="#{html.escape(other)}">{html.escape(by_id[other]["title"])}</a>')
            elif other:
                out.append(html.escape(short(other, 18) or other.strip("()（）")))
        return "、".join(dict.fromkeys(out)) or '<span class="muted">—</span>'
    return f"""
<section class="screen{' multi' if multi else ''}" id="{html.escape(s['id'])}">
  {image_html(src, s)}
  <div class="card-text">
    <header><h3>{html.escape(s['title'])}</h3>
      {status_badge(s)}<span class="badge {state}">画像: {IMAGE_STATE[state]}</span>
      <code>{html.escape(s['id'])}</code></header>
    <p class="role">{html.escape(s.get('role', ''))}</p>
    {f'<p class="status-note">{html.escape(s["status_note"])}</p>' if s.get("status_note") else ""}
    <p class="links"><span class="k">← 来る</span> {names(s.get('entry_points', []), 'from')}<br><span class="k">→ 行く</span> {names(s.get('exits', []), 'to')}</p>
    <details><summary>詳細（操作・データ・備考）</summary>
      <dl>
        <dt>主な操作</dt><dd>{li_list(s.get('main_actions', []))}</dd>
        <dt>表示するデータ</dt><dd>{li_list(s.get('data_shown', []))}</dd>
        <dt>入り口</dt><dd>{edge_list(s.get('entry_points', []), 'from', by_id)}</dd>
        <dt>出口</dt><dd>{edge_list(s.get('exits', []), 'to', by_id)}</dd>
        {f"<dt>備考</dt><dd>{html.escape(s['note'])}</dd>" if s.get('note') else ''}
      </dl>
    </details>
    <details{' open' if filled else ''}><summary>課題・改善案・決定{'（記入あり）' if filled else ''}</summary><div class="discussion">{discussion}</div></details>
  </div>
</section>"""


def build(src: Path, out: Path, pdf: bool) -> None:
    global PLACEHOLDER_DIR
    PLACEHOLDER_DIR = out.parent / "placeholders"
    out.parent.mkdir(parents=True, exist_ok=True)
    app = tomllib.loads((src / "app.toml").read_text(encoding="utf-8")) if (src / "app.toml").exists() else {}
    screens = [read_screen(p) for p in sorted((src / "screens").glob("*.md"))]
    order = {k: i for i, (k, _) in enumerate(GROUP_ORDER)}
    screens.sort(key=lambda s: (order.get(s.get("group"), 99), s.get("order", 50), s["id"]))
    by_id = {s["id"]: s for s in screens}
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=src).stdout.strip() or "?"
    today = dt.date.today().isoformat()
    states = [image_path(src, s)[1] for s in screens]
    counts = " / ".join(f"{IMAGE_STATE[k]} {states.count(k)}" for k in IMAGE_STATE if states.count(k))
    title = app.get("title", "画面設計書")

    rows = "".join(
        f'<tr><td>{html.escape(dict(GROUP_ORDER).get(s.get("group",""), s.get("group","")))}</td>'
        f'<td><a href="#{html.escape(s["id"])}">{html.escape(s["title"])}</a><br><code>{html.escape(s["id"])}</code></td>'
        f'<td>{html.escape(s.get("role",""))}</td>'
        f'<td>{status_badge(s)}</td>'
        f'<td><span class="badge {st}">{IMAGE_STATE[st]}</span></td></tr>'
        for s, st in zip(screens, states)
    )
    notes = "".join(f"<li>{html.escape(n)}</li>" for n in app.get("entry_notes", []))
    sections = "".join(screen_section(s, src, by_id) for s in screens)
    doc = f"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title><style>{CSS}</style></head>
<body><main>
<h1>{html.escape(title)}</h1>
<p class="meta">生成: {today} / 対象 commit: <code>{html.escape(commit)}</code> / 画面 {len(screens)}（画像: {counts}）。元データは <code>docs/design/ui/screens/</code>、再生成は <code>scripts/ui-spec/build.py</code>。決定の正本は <code>docs/design/usecase.md</code> と <code>docs/design/screen-flow.md</code>。</p>

<h2 id="premise">0. 前提</h2>
<ul class="notes">{notes}</ul>

<h2 id="flow">1. 画面遷移マップ</h2>
<p class="legend muted"><span>青の太線: 全員の画面が同時に移る</span><span>灰色の破線: 操作なしで自動に進む</span><span>薄い線: 戻る</span><span>点線の大きな枠: 機能のまとまり</span></p>
<p class="legend muted"><span>画面の枠なし: 実装済み</span><span style="color:#334155">灰色の枠: 確定（実装は PR にある。PR の番号つき）</span><span style="color:#c2410c">オレンジの破線の枠と矢印: 案（直し待ち）</span><span>灰色の点線の枠と矢印: 未確定（案の画像のみ）</span></p>
<p class="muted">ノードをクリックすると下の画面カードへ飛ぶ。画像は、実装済み・確定の画面は実際のアプリ（Mock）のスクリーンショット（確定の画面は、その PR の branch のアプリ）。案（直し待ち）の画面は、今の実装のスクリーンショットと、Codex の image gen で作った直す案（*-proposal-v3*。実装の見た目ではない）を並べる。未確定の画面は Codex の案だけ。</p>
<div class="flow-wrap">{flow_svg(screens, app, src)}</div>

<h2 id="screens">2. 画面カード</h2>
<p class="muted">仮の画面と 1 行の役割、つながる画面。操作・データ・備考と「課題・改善案・決定」は折りたたみ。</p>
{sections}

<details class="overview"><summary><strong>付録. 画面一覧表</strong>（{len(screens)} 画面）</summary>
<table><thead><tr><th>まとまり</th><th>画面</th><th>役割</th><th>状態</th><th>画像</th></tr></thead><tbody>{rows}</tbody></table>
</details>
</main></body></html>
"""
    out.write_text(doc, encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size // 1024} KB, {len(screens)} screens, images: {counts})")
    if pdf:
        chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        pdf_path = out.with_suffix(".pdf")
        subprocess.run([chrome, "--headless", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}", out.resolve().as_uri()],
                       check=True, capture_output=True)
        print(f"wrote {pdf_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=Path("docs/design/ui"))
    ap.add_argument("--out", type=Path, default=Path("docs/design/ui/build/ui-spec.html"))
    ap.add_argument("--pdf", action="store_true")
    a = ap.parse_args()
    build(a.src, a.out, a.pdf)
