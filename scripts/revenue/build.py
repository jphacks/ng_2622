"""収益モデルの試算を 1 つの HTML に生成する。

  出力  docs/design/research/revenue-model.html（commit する。グラフは PNG で埋め込み、外部の CDN は使わない）

前提の数字はこのファイルの先頭にまとめてある。変えたら再実行し、docs/design/research/revenue-model.md の数字も合わせて直す。

使い方: uv run --with matplotlib python3 scripts/revenue/build.py  （要 matplotlib）
"""

import base64
import io
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import TwoSlopeNorm, LinearSegmentedColormap

plt.rcParams["font.family"] = ["Hiragino Sans", "Noto Sans JP", "sans-serif"]
plt.rcParams["axes.spines.top"] = False
plt.rcParams["axes.spines.right"] = False

OUT = Path(__file__).resolve().parents[2] / "docs/design/research/revenue-model.html"

# ---- 前提（出典は HTML の末尾） ----
FX = 158  # 円 / USD（2026-10-07 の相場。scene-generation-cost.md と同じ）
AZURE_USD_PER_HOUR = 1.30  # 音声認識 1.00 + 抑揚 0.30（docs/design/azure-pronunciation-assessment.md）
AUDIO_SEC = 20  # 1 ラウンドの録音の上限。平均はもっと短いので多めに見積もる
CLAUDE_SCORE_USD = 0.0005  # Haiku 5.5 の採点 1 回（architecture.md の 300 回 ≈ 0.15 USD）
SCENE_GEN_USD = 0.0098  # Sonnet 5.5 low で 1 場面、ふつうの平均の実測（docs/design/research/scene-generation-cost.md）
PLAYERS_PER_ROOM = 3  # 1 部屋の平均人数（上限 5）
R2_READ_USD = 0.36 / 1e6  # Class B 1 回

APPLE_FEE = 0.15  # Small Business Program
PRICE_JPY = 980  # プレミアムの月額（仮）
FIXED_JPY = 12980 / 12 + 5 * FX  # Apple Developer 年会費の月割り + Workers 有料プラン

FREE_ROUNDS = 40  # 無料の人の月のラウンド数（仮）
PREM_ROUNDS = 120  # プレミアムの人の月のラウンド数（仮）
PREM_GEN = 30  # プレミアムの人が月に作る苦手の場面の数（上限にする想定）
CONVERSION = 0.03  # 無料 → 有料（RevenueCat: freemium の中央値 2.1%、語学は 2〜5%）
AD_IMPS = 8  # 無料の人がタイトル画面を見る回数 / 月
AD_CPM_JPY = 1500  # 1,000 回表示あたり（ゲーム内の 3D 広告で 8〜15 USD）
AD_FILL = 0.5  # 枠が売れている割合


def yen(usd):
    return usd * FX


AZURE_ROUND = yen(AZURE_USD_PER_HOUR / 3600 * AUDIO_SEC)
CLAUDE_ROUND = yen(CLAUDE_SCORE_USD)
SCENE_GEN = yen(SCENE_GEN_USD)
SCENE_POOL = yen(R2_READ_USD)
AD_PER_FREE = AD_IMPS * AD_CPM_JPY / 1000 * AD_FILL
PREM_NET = PRICE_JPY * (1 - APPLE_FEE)


def free_cost(rounds, speech=True):
    return rounds * ((AZURE_ROUND if speech else 0) + CLAUDE_ROUND + SCENE_POOL)


def prem_cost(rounds=PREM_ROUNDS, gen=PREM_GEN):
    return rounds * (AZURE_ROUND + CLAUDE_ROUND) + gen * SCENE_GEN


def profit(mau, conv=CONVERSION, free_rounds=FREE_ROUNDS, speech=True):
    free = mau * (1 - conv) * (AD_PER_FREE - free_cost(free_rounds, speech))
    prem = mau * conv * (PREM_NET - prem_cost())
    return free + prem - FIXED_JPY


def breakeven_conv(free_rounds=FREE_ROUNDS, speech=True):
    loss = free_cost(free_rounds, speech) - AD_PER_FREE
    gain = PREM_NET - prem_cost()
    return loss / (loss + gain) if loss > 0 else 0.0


def breakeven_rounds(conv):
    gain = conv * (PREM_NET - prem_cost()) / (1 - conv)
    return (gain + AD_PER_FREE) / (AZURE_ROUND + CLAUDE_ROUND + SCENE_POOL)


INK = "#0b0b0b"
INK2 = "#52514e"
GRID = "#e4e3df"
BLUE = "#2a78d6"
ORANGE = "#eb6834"


def png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=160, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def style(ax):
    ax.tick_params(colors=INK2, labelsize=9)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def chart_cost():
    items = [
        ("話し方の採点（Azure・20 秒）", AZURE_ROUND),
        ("内容・表現の採点（Claude Haiku）", CLAUDE_ROUND),
        ("場面：作り置きを R2 から", SCENE_POOL),
        (f"場面：その場で生成（{PLAYERS_PER_ROOM} 人で割る）", SCENE_GEN / PLAYERS_PER_ROOM),
    ]
    fig, ax = plt.subplots(figsize=(7.2, 2.6))
    labels = [k for k, _ in items][::-1]
    vals = [v for _, v in items][::-1]
    bars = ax.barh(labels, vals, color=BLUE, height=0.55)
    for b, v in zip(bars, vals):
        txt = f"{v:.2f} 円" if v >= 0.01 else "≈ 0 円"
        ax.text(b.get_width() + 0.04, b.get_y() + b.get_height() / 2, txt, va="center", fontsize=9, color=INK)
    ax.set_xlim(0, max(vals) * 1.3)
    ax.set_xlabel("1 人 1 ラウンドあたりの費用（円）", color=INK2, fontsize=9)
    style(ax)
    return png(fig)


def chart_profit():
    maus = list(range(0, 100001, 2000))
    fig, ax = plt.subplots(figsize=(7.2, 3.4))
    a = [profit(m) / 1e4 for m in maus]
    b = [profit(m, speech=False) / 1e4 for m in maus]
    ax.plot(maus, a, color=ORANGE, linewidth=2)
    ax.plot(maus, b, color=BLUE, linewidth=2)
    ax.axhline(0, color=INK2, linewidth=0.8)
    ax.text(maus[-1], a[-1], " 無料も全部採点", color=INK, fontsize=9, va="center")
    ax.text(maus[-1], b[-1], " 無料は話し方の点なし", color=INK, fontsize=9, va="center")
    ax.set_xlabel("月のアクティブ利用者数（MAU）", color=INK2, fontsize=9)
    ax.set_ylabel("月の利益（万円）", color=INK2, fontsize=9)
    ax.xaxis.set_major_formatter(lambda x, _: f"{int(x/1000)}k" if x else "0")
    style(ax)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.legend(["無料も全部採点", "無料は話し方の点なし"], frameon=False, fontsize=9, loc="lower left")
    return png(fig)


def chart_heat():
    rounds = list(range(0, 81, 5))
    convs = [c / 100 for c in range(1, 11)]
    z = [[profit(1000, c, r) / 1000 for r in rounds] for c in convs]
    flat = [v for row in z for v in row]
    cmap = LinearSegmentedColormap.from_list("div", ["#c0392b", "#e9e8e4", "#2a78d6"])
    norm = TwoSlopeNorm(vmin=min(flat), vcenter=0, vmax=max(max(flat), 1))
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    im = ax.imshow(z, origin="lower", aspect="auto", cmap=cmap, norm=norm,
                   extent=[rounds[0] - 2.5, rounds[-1] + 2.5, 0.5, 10.5])
    be = [breakeven_conv(r) * 100 for r in rounds]
    ax.plot(rounds, be, color=INK, linewidth=1.5, linestyle="--")
    ax.set_ylim(0.5, 10.5)
    ax.set_xlim(rounds[0] - 2.5, rounds[-1] + 2.5)
    ax.text(22, breakeven_conv(36) * 100 + 0.6, "損益の分かれ目（左上が黒字）", rotation=24, fontsize=9, color=INK)
    ax.axhspan(2, 5, fill=False, edgecolor=INK2, linewidth=0.8, linestyle=":")
    ax.text(44, 2.25, "語学アプリの課金率の相場 2〜5%", fontsize=8, color=INK)
    ax.set_xlabel("無料の人の月のラウンド数", color=INK2, fontsize=9)
    ax.set_ylabel("無料 → 有料の割合（%）", color=INK2, fontsize=9)
    cb = fig.colorbar(im, ax=ax, fraction=0.04)
    cb.set_label("1,000 MAU あたりの月の利益（千円）", fontsize=8, color=INK2)
    cb.ax.tick_params(labelsize=8, colors=INK2)
    ax.tick_params(colors=INK2, labelsize=9)
    return png(fig)


def main():
    c1, c2, c3 = chart_cost(), chart_profit(), chart_heat()
    pc = prem_cost()
    be_a = breakeven_conv() * 100
    fa, fb = free_cost(FREE_ROUNDS), free_cost(FREE_ROUNDS, speech=False)
    p10a, p10b = profit(10000), profit(10000, speech=False)
    pool_year = PREM_ROUNDS * 12
    html = TEMPLATE.format(
        c1=c1, c2=c2, c3=c3, FX=FX, SG3=SCENE_GEN / PLAYERS_PER_ROOM, PPR=PLAYERS_PER_ROOM, AZ=AZURE_ROUND, CL=CLAUDE_ROUND, SG=SCENE_GEN,
        FR=FREE_ROUNDS, PR=PREM_ROUNDS, PG=PREM_GEN, CONV=CONVERSION * 100,
        PRICE=PRICE_JPY, NET=PREM_NET, PC=pc, PM=PREM_NET - pc, AD=AD_PER_FREE,
        FA=fa, FB=fb, BE=be_a, P10A=p10a / 1e4, P10B=p10b / 1e4, FIX=FIXED_JPY,
        POOL=pool_year, POOLC=pool_year * SCENE_GEN, POOLB=pool_year * SCENE_GEN / 2,
        R2=breakeven_rounds(0.02), R3=breakeven_rounds(0.03), R5=breakeven_rounds(0.05), C10=breakeven_conv(10) * 100,
        IMPS=AD_IMPS, CPM=AD_CPM_JPY, FILL=AD_FILL * 100,
    )
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"free cost A={fa:.1f} B={fb:.1f} ad={AD_PER_FREE:.1f} prem cost={pc:.0f} margin={PREM_NET-pc:.0f} breakeven={be_a:.1f}%")
    print(f"profit@10k MAU A={p10a:,.0f} B={p10b:,.0f}")


TEMPLATE = """<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>収益モデルの試算</title>
<style>
:root {{ --bg:#fcfcfb; --card:#ffffff; --ink:#0b0b0b; --ink2:#52514e; --line:#e4e3df; --accent:#2a78d6; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#1a1a19; --card:#232322; --ink:#f0efec; --ink2:#c3c2b7; --line:#3a3a38; --accent:#3987e5; }} }}
:root[data-theme="dark"] {{ --bg:#1a1a19; --card:#232322; --ink:#f0efec; --ink2:#c3c2b7; --line:#3a3a38; --accent:#3987e5; }}
body {{ margin:0; background:var(--bg); color:var(--ink); font:15px/1.75 "Hiragino Sans","Noto Sans JP",sans-serif; }}
main {{ max-width:820px; margin:0 auto; padding:24px 16px 64px; }}
h1 {{ font-size:1.5rem; margin:.2em 0 .1em; }} h2 {{ font-size:1.15rem; margin-top:2.2em; border-bottom:1px solid var(--line); padding-bottom:.2em; }}
.lead {{ color:var(--ink2); }}
.box {{ background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 18px; margin:14px 0; }}
.box.key {{ border-left:4px solid var(--accent); }}
figure {{ margin:16px 0; background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px; }}
figure img {{ width:100%; height:auto; display:block; }} figcaption {{ color:#52514e; font-size:.85rem; margin-top:6px; }}
table {{ border-collapse:collapse; width:100%; font-size:.9rem; }} th,td {{ border-bottom:1px solid var(--line); padding:6px 8px; text-align:left; vertical-align:top; }}
th {{ color:var(--ink2); font-weight:600; }} td.n {{ text-align:right; white-space:nowrap; }}
.wrap {{ overflow-x:auto; }} code {{ font-size:.85em; }} a {{ color:var(--accent); }}
</style></head><body><main>
<h1>収益モデルの試算</h1>
<p class="lead">サブスク（苦手の場面を AI で作れる）＋作り置きの場面の使い回し＋タイトル画面の企業の 3D 広告、で採算が取れるかを、公開されている料金と業界の数字で見積もった。数字は前提を置いた試算で、実測ではない。</p>

<div class="box key"><b>結論</b>
<ol>
<li><b>場面の生成は安い。費用の中心は採点（Azure の発音評価）。</b>場面の生成は 1 回約 {SG:.1f} 円（実測）で、部屋の {PPR} 人で使うので 1 人 1 ラウンドあたり約 {SG3:.1f} 円。話し方の採点は 1 人 1 ラウンドで約 {AZ:.2f} 円かかる。作り置きを R2 から取ればほぼ 0 円になるが、効くのは費用より<b>待ち時間（3.6〜6.1 秒）をなくす</b>ほう。</li>
<li><b>無料の人にも話し方の採点を出すと赤字になりやすい。</b>月 {FR} ラウンドで 1 人約 {FA:.0f} 円かかる。タイトル画面の広告の収入は約 {AD:.0f} 円。黒字にするには課金率が約 {BE:.1f}% 要る。語学アプリの相場は 2〜5%。</li>
<li><b>無料では内容・表現の点だけを出し（文字起こしは端末で行い、Claude Haiku で採点）、話し方の点はプレミアムに回せば、少ない人数でも黒字になる。</b>無料の人 1 人の費用は約 {FB:.0f} 円に下がる。1 万 MAU・課金率 {CONV:.0f}% のとき、月の利益は無料も全部採点する場合が約 {P10A:.1f} 万円、話し方の点をプレミアムに回す場合が約 {P10B:.1f} 万円。</li>
<li>プレミアム（月 {PRICE} 円）の人 1 人あたりの粗利は約 {PM:.0f} 円。苦手の場面を作れる数に上限を付けておけば、使いすぎても赤字にならない。</li>
</ol></div>

<h2>1. 1 ラウンドあたりの費用</h2>
<figure><img alt="1 人 1 ラウンドあたりの費用の棒グラフ。話し方の採点が最も大きい" src="data:image/png;base64,{c1}">
<figcaption>為替は 1 USD = {FX} 円（2026-10-07）。話し方は録音の上限 20 秒で数えた（実際の平均はもっと短い）。</figcaption></figure>
<div class="box"><b>手計算</b>
<ul>
<li>Azure：1.30 USD/時 ÷ 3600 × 20 秒 = 0.0072 USD ≈ <b>{AZ:.2f} 円</b></li>
<li>場面の生成（Sonnet 5.5、effort low、ふつう）：指示文 10,050 トークンはキャッシュ読み 0.20 USD/100 万 → 0.0020 USD。出力 約 770 トークン × 10 USD/100 万 → 0.0077 USD。合わせて 0.0098 USD ≈ <b>{SG:.2f} 円</b>（60 回の実測の平均）。キャッシュが切れていると約 5 円。作り置きを Batch API で夜に作れば半額。</li>
<li>被らない作り置きの数：月 {PR} ラウンド遊ぶ人でも、1 年で {POOL:,} 場面あれば被らない。作る費用は約 {POOLC:,.0f} 円（Batch なら約 {POOLB:,.0f} 円）。R2 には 1 場面 2〜4 KB なので、無料枠の 10 GB に収まる。</li>
</ul></div>

<h2>2. 利用者数と月の利益（作り置きを使う前提）</h2>
<figure><img alt="MAU に対する月の利益の折れ線。無料も全部採点すると人数が増えるほど赤字が広がり、話し方の点をプレミアムに回すと黒字が伸びる" src="data:image/png;base64,{c2}">
<figcaption>課金率 {CONV:.0f}%、無料の人は月 {FR} ラウンド、プレミアムの人は月 {PR} ラウンド・苦手の場面 {PG} 個。固定費は月約 {FIX:,.0f} 円（Apple Developer の月割り＋Workers の有料プラン）。人件費は入れていない。</figcaption></figure>

<h2>3. 無料も全部採点するときの損益の分かれ目</h2>
<figure><img alt="無料の人の月のラウンド数と課金率の組み合わせごとの利益のヒートマップ。相場の課金率 2〜5% では、無料の人が月 {R2:.0f}〜{R5:.0f} ラウンドを超えると赤字" src="data:image/png;base64,{c3}">
<figcaption>点線の枠が語学アプリの課金率の相場。破線より上が黒字。無料の人がよく遊ぶほど、必要な課金率が上がる。</figcaption></figure>
<p>無料の人にも話し方の採点を出したいなら、「無料は 1 日 N ラウンドまで」と回数で絞るのが次の案になる。課金率 3% なら無料の人が月 {R3:.0f} ラウンド、5% なら月 {R5:.0f} ラウンドまでが黒字の範囲。月 10 ラウンドに絞れば、課金率 {C10:.1f}% で黒字になる。</p>

<h2>4. 1 人あたりの収支</h2>
<div class="wrap"><table>
<tr><th>区分</th><th>月の収入</th><th>月の費用</th><th>内訳</th></tr>
<tr><td>無料（全部採点）</td><td class="n">{AD:.0f} 円</td><td class="n">{FA:.0f} 円</td><td>広告 {IMPS} 回 × {CPM} 円/1,000 回 × 売れている割合 {FILL:.0f}%。費用は {FR} ラウンド × (Azure＋Claude)</td></tr>
<tr><td>無料（話し方の点なし）</td><td class="n">{AD:.0f} 円</td><td class="n">{FB:.0f} 円</td><td>文字起こしは端末（SpeechAnalyzer）、採点は Claude Haiku だけ</td></tr>
<tr><td>プレミアム</td><td class="n">{NET:.0f} 円</td><td class="n">{PC:.0f} 円</td><td>{PRICE} 円 − Apple の手数料 15%。費用は {PR} ラウンドの採点＋苦手の場面 {PG} 個の生成</td></tr>
</table></div>

<h2>5. 案ごとの気づき</h2>
<ul>
<li><b>作り置きを R2 から被りなく取る</b>：費用はほぼ 0 円で、待ち時間が無くなるので筋が良い。生成の費用はもともと小さいので、主な効き目は待ち時間。人ごとに「出した場面」を覚えておけば被らない（Durable Object か D1 に場面の ID を記録する）。心配なのは費用ではなく品質。今は人が画像で確かめているので、使い回す前に自動で確かめる仕組み（形が崩れていないか、採点の説明と配置が合うか）が要る。</li>
<li><b>プレミアムは苦手の場面を作れる</b>：場面の生成は安いので、値段の根拠は生成の費用ではなく「苦手が分かって、その練習が出る」学びの価値になる。プレミアムの人が作った場面を作り置きに足していけば、無料の人の場面も増える。月に作れる数の上限（例: {PG} 個）を付けると原価が読める。</li>
<li><b>パーティーゲームなので「ホストだけ課金」もあり</b>：Jackbox のように、ホストがプレミアムならその部屋の全員が新しい場面で遊べる、という形にすると、無料の友達に価値が見えて課金のきっかけになる。</li>
<li><b>タイトル画面の企業の 3D</b>：ゲーム内に溶け込む 3D 広告（intrinsic ads）は、売るときの単価が 1,000 回表示あたり 8〜15 USD 程度（広告会社の資料で、中立の数字ではない）。ただ、利用者が数万人いないと広告主は付きにくい。最初は表示回数で売るより、月額のスポンサー枠として直接売るほうが現実的。英語教育・留学・旅行の会社なら世界観にも合う。3D の部品を作る手間がかかるので、制作費も取れる。追跡しない広告なら、iOS の追跡の許可（ATT）を求めずに済む。</li>
<li><b>価格</b>：比較の相手は Speak（月 3,800 円／年 19,800 円）と ELSA（月 900 円前後）。RevenueCat の教育カテゴリの価格の中央値は月 9.99 USD、年 44.99 USD で、年額プランが売上の中心。月 {PRICE} 円・年 6,800 円くらいが置きやすい。</li>
<li><b>注意</b>：今の Azure は Azure for Students のクレジット。商用で使うなら従量課金の契約に変える前提で、Students を商用に使えるかは確認が要る。</li>
</ul>

<h2>前提と出典</h2>
<div class="wrap"><table>
<tr><th>項目</th><th>値</th><th>出典</th></tr>
<tr><td>場面の生成 1 回</td><td>0.0098 USD（ふつうの平均）</td><td>リポジトリの docs/design/research/scene-generation-cost.md（60 回の実測）</td></tr>
<tr><td>Azure 音声認識＋抑揚</td><td>1.30 USD/時</td><td>リポジトリの docs/design/azure-pronunciation-assessment.md（料金ページと Retail Prices API）。<a href="https://www.developersdigest.tech/models/speech/azure">Developers Digest</a> も 1.00＋0.30 USD</td></tr>
<tr><td>Claude Sonnet 5.5 / Haiku 5.5</td><td>入力 2 / 0.10、出力 10 / 0.50 USD（100 万トークン）。Sonnet のキャッシュ読みは 0.20</td><td>Claude API の料金表（2026-10 時点）</td></tr>
<tr><td>Cloudflare R2</td><td>無料枠 10 GB・読み 1,000 万回/月、読み 0.36 USD/100 万回、転送無料</td><td><a href="https://developers.cloudflare.com/r2/pricing/">Cloudflare R2 pricing</a></td></tr>
<tr><td>Apple の手数料</td><td>15%（年間の売上 100 万 USD まで）</td><td><a href="https://9to5mac.com/2020/11/18/app-store-small-business-program/">9to5Mac</a>、<a href="https://www.revenuecat.com/blog/engineering/small-business-program">RevenueCat</a></td></tr>
<tr><td>課金率</td><td>freemium の中央値 2.1%、語学は 2〜5%</td><td><a href="https://www.saastr.com/the-top-10-learnings-from-revenuecats-state-of-subscription-apps/">SaaStr（RevenueCat 2026 の要約）</a>、<a href="https://appsops.store/blog/language-learning-app-subscription-pricing-2026">appsops</a></td></tr>
<tr><td>教育アプリの価格</td><td>中央値 月 9.99 USD・年 44.99 USD、年額が 59〜66%</td><td><a href="https://www.revenuecat.com/state-of-subscription-apps-2026-education">RevenueCat SOSA 2026 Education</a></td></tr>
<tr><td>競合の価格</td><td>Speak 月 3,800 円／年 19,800 円、ELSA 月 900 円</td><td><a href="https://motteku.jp/?p=32163">motteku</a>、<a href="https://bloomeria.jp/blog/english-app-pricing-comparison">Bloomeria</a></td></tr>
<tr><td>3D のゲーム内広告</td><td>1,000 回表示あたり 8〜15 USD</td><td><a href="https://rapidfire.com/blog/in-game-advertising-pricing-and-costs">RapidFire</a>、<a href="https://www.anzu.io/blog/what-is-intrinsic-in-game-advertising">Anzu</a>（どちらも広告会社）</td></tr>
<tr><td>仮置き</td><td>1 部屋 3 人、ラウンド数、広告の表示回数・売れている割合</td><td>推測。<code>scripts/revenue/build.py</code> の先頭を変えて再実行する</td></tr>
</table></div>
</main></body></html>
"""

if __name__ == "__main__":
    main()
