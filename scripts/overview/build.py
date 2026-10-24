#!/usr/bin/env python3
"""チーム向けの説明資料（動機とアプリの全体像）を 1 つの HTML に生成する。

  入力  docs/design/ui/images/*.png   確定版の仮の画面
  出力  docs/design/overview/build/overview.html（gitignore。画像は埋め込み、外部の CDN は使わない）

中身は docs/design/ の文書（usecase.md・screen-flow.md・scene-generation.md）から書き起こしたもの。
正本が変わったら、ここの本文も合わせて直す。

使い方: python3 scripts/overview/build.py
"""

from __future__ import annotations

import base64
import html
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IMAGES = ROOT / "docs/design/ui/images"
OUT_DIR = ROOT / "docs/design/overview/build"
REPO = "https://github.com/jphacks/ng_2622/blob/main"

# 色は 2 色だけ使い、役割を固定する。
#   core: 作品の核・MUST の候補
#   open: まだ決まっていないこと（MTG で決める）
CSS = """
:root {
  --ink: #111; --sub: #555; --line: #d9d9d9; --bg: #fff; --panel: #f6f6f6;
  --core: #2f3a8f; --open: #a05a00;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN",
    "Noto Sans JP", "Yu Gothic", sans-serif;
  line-height: 1.75; font-size: 16px;
}
main { max-width: 920px; margin: 0 auto; padding: 48px 16px 96px; }
header { border-bottom: 2px solid var(--ink); padding-bottom: 24px; margin-bottom: 8px; }
.kicker { font-size: 13px; color: var(--sub); letter-spacing: .04em; margin: 0 0 8px; }
h1 { font-size: 40px; line-height: 1.2; margin: 0; letter-spacing: .01em; }
h1 .yomi { font-size: 18px; font-weight: normal; color: var(--sub); margin-left: 8px; }
.lead { font-size: 19px; margin: 16px 0 0; }
.meta { font-size: 13px; color: var(--sub); margin: 12px 0 0; }
section { padding-top: 40px; }
h2 { font-size: 24px; margin: 0 0 16px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h2 .num { color: var(--sub); font-weight: normal; margin-right: 10px; }
h3 { font-size: 17px; margin: 0 0 6px; }
p { margin: 0 0 12px; }
ul { margin: 0 0 12px; padding-left: 1.3em; }
li { margin: 2px 0; }
.small { font-size: 14px; color: var(--sub); }
.grid { display: grid; gap: 16px; }
.g3 { grid-template-columns: repeat(3, 1fr); }
.g2 { grid-template-columns: repeat(2, 1fr); }
.card { border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; background: var(--bg); }
.card .label { font-size: 13px; color: var(--sub); margin: 0 0 4px; }
.shots { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px 16px; }
.shot { margin: 0; }
.shot img { width: 100%; border: 1px solid var(--line); border-radius: 14px; display: block; }
.shot figcaption { font-size: 13px; margin-top: 6px; line-height: 1.5; }
.shot figcaption b { display: block; font-size: 12px; color: var(--sub); font-weight: normal; }
.hero { display: flex; gap: 12px; margin-top: 24px; }
.hero img { width: 32%; max-width: 200px; border: 1px solid var(--line); border-radius: 16px; }
table { border-collapse: collapse; width: 100%; font-size: 15px; margin: 4px 0 12px; }
th, td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: left; vertical-align: top; }
th { font-weight: 600; background: var(--panel); }
.why { color: var(--sub); font-size: 14px; display: block; margin-top: 2px; }
.tier { border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; margin-bottom: 14px; }
.tier h3 { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.tier.core { border: 2px solid var(--core); }
.tier.core h3 { color: var(--core); }
.tag-open {
  display: inline-block; font-size: 12px; font-weight: normal; color: var(--open);
  border: 1px solid var(--open); border-radius: 4px; padding: 0 6px; line-height: 1.6;
}
.core-text { color: var(--core); font-weight: 600; }
ol.cut { margin: 0 0 8px; }
.note { border-left: 3px solid var(--line); padding: 2px 0 2px 12px; color: var(--sub); font-size: 14px; }
a { color: var(--ink); }
footer { margin-top: 56px; border-top: 1px solid var(--line); padding-top: 16px; font-size: 13px; color: var(--sub); }
@media (max-width: 680px) {
  h1 { font-size: 30px; }
  .g3, .g2 { grid-template-columns: 1fr; }
  .shots { display: flex; overflow-x: auto; padding-bottom: 8px; }
  .shot { flex: 0 0 128px; }
}
"""


def image_uri(name: str, height: int = 900) -> str:
    """確定版の画像を縮小して data URI にする（sips が無ければ元の PNG をそのまま埋め込む）。"""
    src = IMAGES / name
    if not src.exists():
        return ""
    data_path, mime = src, "image/png"
    if shutil.which("sips"):
        out = OUT_DIR / "thumbs" / f"{src.stem}-{height}.jpg"
        if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
            out.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                ["sips", "-Z", str(height), "-s", "format", "jpeg", "-s", "formatOptions", "82", str(src), "--out", str(out)],
                check=True, capture_output=True,
            )
        data_path, mime = out, "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(data_path.read_bytes()).decode()}"


def shot(name: str, step: str, caption: str) -> str:
    return (
        f'<figure class="shot"><img src="{image_uri(name)}" alt="{html.escape(caption)}">'
        f"<figcaption><b>{html.escape(step)}</b>{html.escape(caption)}</figcaption></figure>"
    )


def doc_link(path: str, label: str) -> str:
    return f'<a href="{REPO}/{path}">{html.escape(label)}</a>'


def build() -> Path:
    hero = "".join(
        f'<img src="{image_uri(n)}" alt="{a}">'
        for n, a in (("3-lobby.png", "待合"), ("4b-play-recording.png", "録音中"), ("6-ranking.png", "結果発表"))
    )
    shots = "".join(
        shot(*s)
        for s in (
            ("1-home.png", "1", "名前を入れて、部屋を作るか入る"),
            ("3-lobby.png", "2", "待合。ホストがシーンを選んでスタート"),
            ("4a-play-intro.png", "3", "3D が自動で 1 周（約 3 秒）"),
            ("4b-play-recording.png", "4", "全員が同時に話す（最長 20 秒）"),
            ("5-waiting.png", "5", "採点を待つ。点数は発表まで伏せる"),
            ("6-ranking.png", "6", "最下位から順位を発表"),
            ("8-everyone.png", "7", "みんなの描写を読み比べる"),
            ("7-review.png", "8", "自分の点数の内訳と講評"),
        )
    )

    body = f"""
<main>
<header>
  <p class="kicker">JPHACKS 2026 ／ チーム向けの説明資料</p>
  <h1>ScenEnglish<span class="yomi">シーングリッシュ</span></h1>
  <p class="lead">同じ 3D シーンを全員が同時に見て、それぞれが英語で描写し、AI の採点で競う iPhone のゲーム。</p>
  <p class="meta">作品名は仮（Scene と English を合わせた造語）で、<span class="tag-open">MTG で決める</span>　2026-10-24 時点。内容は repo の docs/design/ から書き起こした。</p>
  <div class="hero">{hero}</div>
</header>

<section>
  <h2><span class="num">1</span>動機</h2>
  <div class="grid g3">
    <div class="card">
      <p class="label">課題</p>
      <h3>英語を話す機会が足りない</h3>
      <p>単語帳でどれだけ覚えても、実際に使う機会がない。既存の英会話アプリは決まった文（定型文）を練習するもので、面白みに欠けてモチベーションが続かない。</p>
    </div>
    <div class="card">
      <p class="label">面白さ</p>
      <h3>同じものでも言い方が違う</h3>
      <p>同じシーンを見ても、人によって見方と言い方が違う。その違いを英語で比べる。<span class="core-text">ここが作品の核</span>。</p>
    </div>
    <div class="card">
      <p class="label">学びの中身</p>
      <h3>見たものを英語で説明する力</h3>
      <p>試験や実際の会話で求められるのに、練習して点数で振り返れる場が少ない。</p>
    </div>
  </div>
  <p style="margin-top:16px">そこで、友達と同時に遊ぶゲームにして、自分の言葉で話す量を増やす。</p>
</section>

<section>
  <h2><span class="num">2</span>遊び方</h2>
  <p>各自が自分の iPhone で遊ぶ。1 人が部屋を作ってコード（または QR）を出し、他の人はそれで入る。全員で見る共有の画面は持たず、全員が同じ画面を使う。</p>
  <div class="shots">{shots}</div>
  <p class="small">画面は Codex の image gen で作った仮の画面。細部（文言や人数の表示）は実装しながら直す。</p>

  <h3 style="margin-top:20px">1 ラウンドの流れ</h3>
  <ol>
    <li>ホストが待合でシーンを選び（「おまかせ」でランダムも可）、スタートを押す。</li>
    <li>全員の画面に同じ 3D シーンが出て、自動で 1 周（360 度、約 3 秒）回る。回っている間は操作できない。</li>
    <li>全員一斉に録音が始まる。最長 20 秒で、「話し終えた」ボタンで早めに止められる。録音中はライブ字幕を出さず、音量メーターだけを出す。</li>
    <li>全員の採点がそろったら、全員の画面に一斉に結果を出す。最下位から 1 行ずつ順位を開き、最後に優勝を出す。</li>
    <li>結果の後は、全員の文字起こしを点数順に読み比べる「みんなの描写」と、自分の点数の内訳を見る「振り返り」に進める。</li>
  </ol>

  <h3 style="margin-top:20px">採点</h3>
  <table>
    <tr><th>項目</th><th>見るところ</th><th>採点するもの</th><th>重み（初期値）</th></tr>
    <tr><td>内容</td><td>場面に合っているか、何を描写できたか</td><td>Claude（文字起こしを渡す）</td><td>50%</td></tr>
    <tr><td>表現</td><td>語彙や文の組み立て</td><td>Claude</td><td>25%</td></tr>
    <tr><td>話し方</td><td>流暢さ・発音・抑揚</td><td>Azure の発音評価</td><td>25%</td></tr>
  </table>
  <p class="small">重みは最初は内容を重くし、実際に遊びながらチームで調整する。振り返りには、各項目の点数と講評の一言・模範表現を出す。</p>
</section>

<section>
  <h2><span class="num">3</span>こだわりと理由</h2>
  <table>
    <tr><th style="width:36%">こだわり</th><th>理由</th></tr>
    <tr><td><span class="core-text">全員が同時に話す</span>。順番には遊ばない</td>
        <td>順番に遊ぶと、後の人は前の人の発話を聞いて真似でき、後の人ほど有利になる。</td></tr>
    <tr><td>正解の文がない自由な描写を採点する</td>
        <td>定型文をなぞる練習ではなく、目の前のシーンを自分の言葉で説明するため。発音評価も、正解の文を渡さない形で使う。</td></tr>
    <tr><td>ライブ字幕を出さない</td>
        <td>字幕を見て「間違えたから言い直す」のは現実の会話では起きない状況で、本質的な英語学習にならない。文字起こしは結果の画面で見せる。</td></tr>
    <tr><td>順位の発表と、読み比べの画面を分ける</td>
        <td>順位の発表は短く盛り上げ、全員の描写の読み比べはその後で落ち着いて行うため。</td></tr>
  </table>
</section>

<section>
  <h2><span class="num">4</span>作る範囲の候補</h2>
  <p>Hack Day の開発時間は約 14 時間。どこまでを MUST にするかは MTG で決める。下の 3 段はその出発点で、10/21 に決めた「遅れたときに削る順番」をもとにしている。</p>

  <div class="tier core">
    <h3>MUST の候補 <span class="tag-open">MTG で調整する</span></h3>
    <ul>
      <li>3D 表示、録音、採点（Azure と Claude）、結果発表、みんなの描写</li>
      <li>全員が同時に話す（2 台の同期）。間に合わなければ、1 台でプレイし、事前に録っておいたメンバーの回答と点数を並べて比べる見せ方に切り替える。</li>
      <li>上の「こだわりと理由」</li>
    </ul>
  </div>

  <div class="tier">
    <h3>時間があれば作るもの <span class="tag-open">MTG で調整する</span></h3>
    <p>遅れたら上から順に削る。</p>
    <ol class="cut">
      <li>QR の読み取り（削ったら、部屋のコードの入力だけにする）</li>
      <li>シーンのサムネイル（削ったら、名前の一覧だけにする）</li>
      <li>結果発表のパタパタ表示（削ったら、普通の順位表にする）</li>
      <li>振り返りの画面</li>
    </ol>
  </div>

  <div class="tier">
    <h3>将来（Hack Day では作らない） <span class="tag-open">MTG で調整する</span></h3>
    <ul>
      <li>ホログラム: 真ん中に置いた iPad をホログラム表示専用にする。見え方をチームで把握できていないので、今は各自の画面で 3D を表示する形にしている。</li>
      <li>シーンの自動生成: ホストが場面を文章で指定すると、AI が新しいシーンを作る。Blender をサーバーで動かして部品を作り、Claude が配置を JSON で決める。発表では今後の展開として示す。</li>
    </ul>
  </div>
  <p class="note">本番の備えとして、採点の API が止まったときに固定の点数を返すモードと、事前に録画したデモ動画も用意する。</p>
</section>

<section>
  <h2><span class="num">5</span>作り方の概要</h2>
  <ul>
    <li>アプリ: SwiftUI のネイティブアプリ。3D の表示は RealityKit を想定している。</li>
    <li>バックエンド: TypeScript on Cloudflare Workers ＋ Durable Objects。部屋ごとに 1 つの Durable Object が参加者と進行を持つ。</li>
    <li>外部 API（Azure・Claude）はバックエンドだけが呼ぶ。iPhone は API キーを持たず、音声をアップロードするだけ。</li>
    <li>3D シーン: Blender の Python スクリプトで部品を作り、配置の JSON と合わせてアプリに同梱する。</li>
  </ul>
  <p class="small">詳しくは下の文書を参照。</p>
</section>

<section>
  <h2><span class="num">6</span>詳しく読むなら</h2>
  <table>
    <tr><th>文書</th><th>中身</th></tr>
    <tr><td>{doc_link("docs/design/usecase.md", "usecase.md")}</td><td>使い方と決めたことの全体。最初に読む</td></tr>
    <tr><td>{doc_link("docs/design/screen-flow.md", "screen-flow.md")}</td><td>画面の流れと 1 ラウンドの進み方</td></tr>
    <tr><td>{doc_link("docs/design/architecture.md", "architecture.md")}</td><td>構成図、API、回数の上限の初期値</td></tr>
    <tr><td>{doc_link("docs/design/cost-safety.md", "cost-safety.md")}</td><td>コスト破産への備え</td></tr>
    <tr><td>{doc_link("docs/design/scene-generation.md", "scene-generation.md")}</td><td>3D シーンの作り方と、自動生成の将来構成</td></tr>
    <tr><td>{doc_link("docs/adr/README.md", "docs/adr/")}</td><td>技術選定などの決定の記録</td></tr>
  </table>
</section>

<footer>
  色の使い方: <span class="core-text">青</span>は作品の核と MUST の候補、<span style="color:var(--open)">茶</span>はまだ決まっていないこと（MTG で決める）。<br>
  この資料は scripts/overview/build.py で生成している。中身を直すときは docs/design/ の文書とあわせて直す。
</footer>
</main>
"""
    page = (
        '<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>ScenEnglish の説明資料</title>\n<style>{CSS}</style>\n</head>\n<body>{body}</body>\n</html>\n"
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "overview.html"
    out.write_text(page, encoding="utf-8")
    return out


if __name__ == "__main__":
    out = build()
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")
