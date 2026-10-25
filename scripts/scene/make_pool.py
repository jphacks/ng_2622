"""作り置きの場面の候補をまとめて作る（docs/design/scene-protocol.md の「AI で場面を作り置く」）。

手元の wrangler dev の POST /scenes/generate に難易度とテーマを付けて呼び、返った配置の JSON を
<out>/<difficulty>/<id>.json に保存する。続けて render_layout.py（Blender）で同じ場所に PNG を描き、
難易度ごとの一覧の画像（<out>/<difficulty>/contact_sheet.png、ffmpeg）と所要時間の表（<out>/times.md・times.json）を作る。
repo の pool には入れない。人が PNG を見て選んだものだけを後で入れる。

テーマは同じ難易度の中でかぶりにくいよう、THEMES を難易度ごとにずらして順に回す（--theme で固定、--no-theme で Claude に選ばせる）。
合言葉は環境変数 SCENE_WRITE_TOKEN から読み、表示しない。Python の標準ライブラリだけで動く。

使い方:
  export SCENE_WRITE_TOKEN=...   # wrangler dev に --var SCENE_WRITE_TOKEN:... で渡したのと同じ値
  python3 scripts/scene/make_pool.py --url http://localhost:8799 --out <dir> --difficulty easy normal hard --count 14
  （--jobs で同時に投げる数、--no-render で描かない、--blender で Blender の場所を変える）
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DIFFICULTIES = ("easy", "normal", "hard")
# 今の部品で作れる場所（生成の口の THEMES と同じ顔ぶれ）
THEMES = ("公園", "カフェ", "店", "駅", "台所", "教室", "部屋", "図書館", "砂浜", "道", "バス停", "校庭")
# 生成の口は 1 回 60 秒まで待ち、1 回やり直すことがある
REQUEST_TIMEOUT = 150
BLENDER_CANDIDATES = ("blender", "/Applications/Blender.app/Contents/MacOS/Blender")


def themes_for(difficulty: str, count: int, fixed: str | None, none: bool) -> list[str | None]:
    """難易度ごとに始まりをずらして THEMES を回す。"""
    if none:
        return [None] * count
    if fixed:
        return [fixed] * count
    offset = DIFFICULTIES.index(difficulty) * 4 if difficulty in DIFFICULTIES else 0
    return [THEMES[(offset + i) % len(THEMES)] for i in range(count)]


def generate(url: str, token: str, difficulty: str, theme: str | None) -> dict:
    """1 場面を作る。結果は {ok, seconds, layout | error}。例外は投げない。"""
    body: dict = {"difficulty": difficulty}
    if theme:
        body["theme"] = theme
    req = urllib.request.Request(
        f"{url.rstrip('/')}/scenes/generate",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"content-type": "application/json", "authorization": f"Bearer {token}"},
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as res:
            layout = json.load(res)
        return {"ok": True, "seconds": time.monotonic() - started, "layout": layout}
    except urllib.error.HTTPError as e:
        try:
            detail = json.load(e).get("error", {})
            error = f"{e.code} {detail.get('code', '')}: {detail.get('message', '')}"
        except (ValueError, AttributeError):
            error = f"{e.code}"
        return {"ok": False, "seconds": time.monotonic() - started, "error": error}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
        return {"ok": False, "seconds": time.monotonic() - started, "error": f"{type(e).__name__}: {e}"}


def find_blender(given: str | None) -> str | None:
    for c in ([given] if given else []) + list(BLENDER_CANDIDATES):
        path = shutil.which(c) or (c if Path(c).is_file() else None)
        if path:
            return path
    return None


def render(blender: str, jsons: list[Path], out: Path) -> None:
    script = REPO / "scripts" / "scene" / "render_layout.py"
    subprocess.run(
        [blender, "--background", "--factory-startup", "--python", str(script), "--",
         *map(str, jsons), "--out", str(out)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )


def contact_sheet(pngs: list[Path], dest: Path, columns: int = 4) -> bool:
    """PNG を縮めて格子に並べた 1 枚を作る（ffmpeg の tile）。ffmpeg が無ければ作らない。"""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or not pngs:
        return False
    rows = (len(pngs) + columns - 1) // columns
    listing = dest.with_suffix(".txt")
    listing.write_text("".join(f"file '{p.resolve()}'\n" for p in pngs))
    subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
         "-vf", f"scale=640:480,tile={columns}x{rows}:padding=6:color=white", "-frames:v", "1", str(dest)],
        check=True,
    )
    listing.unlink()
    return True


def write_times(out: Path, rows: list[dict]) -> None:
    (out / "times.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
    lines = ["| 難易度 | # | テーマ | ID | 名前 | 部品 | 秒 | 結果 |", "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        lines.append(
            f"| {r['difficulty']} | {r['n']} | {r['theme'] or '（選ばせる）'} | {r.get('id', '')} | {r.get('name', '')} | "
            f"{r.get('items', '')} | {r['seconds']:.1f} | {'ok' if r['ok'] else r['error']} |"
        )
    lines.append("")
    for d in sorted({r["difficulty"] for r in rows}, key=lambda x: DIFFICULTIES.index(x) if x in DIFFICULTIES else 9):
        ok = [r["seconds"] for r in rows if r["difficulty"] == d and r["ok"]]
        failed = sum(1 for r in rows if r["difficulty"] == d and not r["ok"])
        if ok:
            ok.sort()
            median = ok[len(ok) // 2]
            lines.append(f"- {d}: 成功 {len(ok)}・失敗 {failed}、{ok[0]:.1f}〜{ok[-1]:.1f} 秒（中央 {median:.1f} 秒）")
        else:
            lines.append(f"- {d}: 成功 0・失敗 {failed}")
    (out / "times.md").write_text("\n".join(lines) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description="作り置きの場面の候補をまとめて作り、PNG に描く")
    ap.add_argument("--url", default="http://localhost:8799", help="wrangler dev の URL")
    ap.add_argument("--out", type=Path, required=True, help="出力の場所")
    ap.add_argument("--difficulty", nargs="+", choices=DIFFICULTIES, default=list(DIFFICULTIES))
    ap.add_argument("--count", type=int, default=10, help="難易度ごとに作る数")
    ap.add_argument("--jobs", type=int, default=3, help="同時に投げる数")
    ap.add_argument("--theme", help="テーマを固定する")
    ap.add_argument("--no-theme", action="store_true", help="テーマを送らず Claude に選ばせる")
    ap.add_argument("--no-render", action="store_true", help="PNG を描かない")
    ap.add_argument("--blender", help="Blender の場所（既定は PATH か /Applications/Blender.app）")
    args = ap.parse_args()

    token = os.environ.get("SCENE_WRITE_TOKEN")
    if not token:
        print("環境変数 SCENE_WRITE_TOKEN が要る", file=sys.stderr)
        return 2
    blender = None if args.no_render else find_blender(args.blender)
    if not args.no_render and not blender:
        print("Blender が見つからない（--blender で場所を渡すか --no-render）", file=sys.stderr)
        return 2

    args.out.mkdir(parents=True, exist_ok=True)
    jobs = [
        (d, n + 1, theme)
        for d in args.difficulty
        for n, theme in enumerate(themes_for(d, args.count, args.theme, args.no_theme))
    ]
    rows: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futures = {pool.submit(generate, args.url, token, d, t): (d, n, t) for d, n, t in jobs}
        for f in concurrent.futures.as_completed(futures):
            d, n, theme = futures[f]
            result = f.result()
            row = {"difficulty": d, "n": n, "theme": theme, "ok": result["ok"], "seconds": round(result["seconds"], 2)}
            if result["ok"]:
                layout = result["layout"]
                folder = args.out / d
                folder.mkdir(exist_ok=True)
                (folder / f"{layout['id']}.json").write_text(json.dumps(layout, ensure_ascii=False, indent=2) + "\n")
                row.update(id=layout["id"], name=layout.get("name", ""), items=len(layout.get("items", [])))
                print(f"{d} #{n} {theme or '-'}: {layout['id']} {layout.get('name', '')}（{result['seconds']:.1f} 秒）")
            else:
                row["error"] = result["error"]
                print(f"{d} #{n} {theme or '-'}: 失敗 {result['error']}（{result['seconds']:.1f} 秒）", file=sys.stderr)
            rows.append(row)
    rows.sort(key=lambda r: (DIFFICULTIES.index(r["difficulty"]), r["n"]))
    write_times(args.out, rows)

    if blender:
        for d in args.difficulty:
            ids = [r["id"] for r in rows if r["difficulty"] == d and r["ok"]]
            if not ids:
                continue
            folder = args.out / d
            render(blender, [folder / f"{i}.json" for i in ids], folder)
            pngs = [folder / f"{i}.png" for i in ids if (folder / f"{i}.png").exists()]
            if contact_sheet(pngs, folder / "contact_sheet.png"):
                print(f"{d}: {len(pngs)} 枚を描き、{folder / 'contact_sheet.png'} にまとめた")
    print(f"所要時間の表: {args.out / 'times.md'}")
    return 0 if all(r["ok"] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
