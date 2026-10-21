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

仮の画面は Codex の image gen で作る。固まったら `drafts/` から `images/` に移して commit する。

frontmatter の主なキー:

| キー | 意味 |
| --- | --- |
| `title` | 画面の日本語の呼称 |
| `group` | `room`（部屋）/ `play`（プレイ）/ `result`（結果） |
| `order` | まとまりの中の並び |
| `image` | 仮の画面のファイル名（`images/` → `drafts/` の順に探す） |
| `entry_points` / `exits` | `{ from|to = "<id か説明>", how = "push / 全員同時 / 自動 / 戻る", trigger = "きっかけ" }` の配列。`to` が他の画面の `id` なら遷移マップの矢印になる。`how` に「全員」を含む遷移は青の太線、「自動」は破線、「戻る」は薄い線で描く |
