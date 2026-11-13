# 画面設計書（to-be・モック）

画面の一覧・役割・遷移を、仮の画面の画像つきの HTML 1 ファイルにまとめ、UI と画面の流れの認識合わせに使う。決定の正本は [`../usecase.md`](../usecase.md) と [`../screen-flow.md`](../screen-flow.md) で、この文書はそれを画面ごとに見える形にしたもの。

## 生成

```sh
python3 scripts/ui-spec/build.py          # docs/design/ui/build/ui-spec.html（自己完結、PNG は base64）
python3 scripts/ui-spec/build.py --pdf    # 同名の .pdf も（Google Chrome の headless 印刷）
```

依存: Python 3.11 以上、graphviz（`brew install graphviz`。遷移マップ）、`rsvg-convert`（`brew install librsvg`。画像が無い画面のプレースホルダー）。`build/` は gitignore 済み。

## 元データ

- `app.toml` — 起動時の画面と、全体の前提（文書の冒頭に出る）
- `screens/<id>.md` — 画面ごとの元データ。TOML の frontmatter（`+++ … +++`）に役割・入り口・出口・操作・データ・備考・画像のファイル名、本文の `## 課題` `## 改善案` `## 決定` に議論を書く（空なら「（未記入）」と出る）
- `images/<image>` — 固まった仮の画面。commit する
- `drafts/<image>` — 仮の画面の下書き。gitignore 済みで、`images/` に無いときに使う
- `mocks/<まとまり>.html` — 操作できる HTML のモック（自己完結。ブラウザで開くだけで見られる）。例: `mocks/play.html`（プレイの 3 画面、#9）

仮の画面は Codex の image gen で作る。固まったら `drafts/` から `images/` に移して commit する。

画面を作り直したときは、前の画像を消さずに別の名前（例: `3-lobby-v2.png`）で置き、frontmatter の `image` を差し替える。長い画面（振り返り）は、スクロール前とスクロール後の 1 画面ぶんずつの画像にし、`image` に配列で書く（例: `image = ["7-review-v5-top.png", "7-review-v5-bottom.png"]`）。HTML の画面カードでは横に並べ、遷移図のノードには 1 枚目を使う。iPhone の 1 画面ぶんの画像は縮めずに埋める。縦に長い画像は切り抜かずに枠の中で縦にスクロールさせる。横長の画像（図の部分だけを大きく描いた案など）は、iPhone の枠に入れず、カードの 2 列ぶんの幅で出す。ただし、実装の PR と同じ名前の画像（`1-home.png` など）は上書きする（前の版は git の履歴にある）。PR を入れるときに、同じ名前の画像がぶつからないようにするため。

2026-11-13 の画像: 実装済みの画面は、実際のアプリ（Mock）のスクリーンショット（`<番号>-<id>-app.png`）。確定の画面は、実装の PR の branch のアプリ（Mock）のスクリーンショット（状態バーは 9:41）。PR と同じ名前のファイル（`1-home.png` など）は、PR を入れるときにぶつからないよう、PR と同じ中身にしてある。決めるまでに Codex の image gen で描いた案（`*-proposal-v3*.png` など）は消した（git の履歴にある）。未確定の画面が出たら、Codex の案（`*-proposal.png`）を状態の札と一緒に載せる。

frontmatter の主なキー:

| キー | 意味 |
| --- | --- |
| `title` | 画面の日本語の呼称 |
| `group` | `room`（部屋）/ `play`（プレイ）/ `result`（結果）/ `record`（きろく・設定） |
| `order` | まとまりの中の並び |
| `image` | 仮の画面のファイル名（`images/` → `drafts/` の順に探す）。複数なら配列で書き、カードでは横に並べる |
| `image_labels` | 画像ごとの小さな見出し（`image` と同じ順の配列。例: 上・下にスクロール） |
| `status` | 画面の状態。`実装済み` / `確定（実装: #<PR の番号>）` / `案（…）` / `未確定（案の画像のみ）` のどれか（頭の「実装済み」「確定」「案」「未確定」で見分ける）。確定は v2 で決めた画面で、実装が PR にあるもの（この文書を main に入れてから PR を入れる）。案は、決める途中で案の画像を並べたもの。カードに札を出し、遷移図では枠の色と線で描き分ける（凡例は HTML の遷移図の上） |
| `status_note` | 状態の一言（どこまで入っているか、どの branch か） |
| `entry_points` / `exits` | `{ from|to = "<id か説明>", how = "push / 全員同時 / 自動 / 戻る", trigger = "きっかけ" }` の配列。`to` が他の画面の `id` なら遷移マップの矢印になる。`how` に「全員」を含む遷移は青の太線、「自動」は破線、「戻る」は薄い線で描く。`exits` に `status = "実装済み"` などを書くと、その矢印だけをその状態で描く。書かなければ、どちらかの端が未確定なら未確定、片方の端が案でもう片方が案か確定なら案で描き、実装済みの画面とのあいだの矢印は今のまま描く |
