# 2026/10/21 仕様の正本を repo の docs/design/ に置く

## Status
- accepted

## Situation
- メンバーの 1 人が、作品の要件定義書を Google Docs に暫定版として書いていた。
- 仕様の認識合わせ（grill）を進めるうちに、遊び方（順番に遊ぶ → 全員が同時に遊ぶ）など、暫定版と大きく違う決定が積み重なった。

## Context
- 仕様が Google Docs と repo の 2 か所にあると、どちらが新しいか分からなくなり、メンバーが古い仕様で作業してしまう。
- 決定の経緯を、コードと同じ場所で PR を通して見直せるようにしたい。

## Material for decision
- [`docs/design/usecase.md`](../design/usecase.md) ほか、grill で書いた `docs/design/` の文書
- 画面設計書の生成の仕組み（[`docs/design/ui/README.md`](../design/ui/README.md)、`scripts/ui-spec/build.py`）

## Decision
- 仕様の正本は repo の `docs/design/` の Markdown にする。Google Docs の暫定の要件定義書は参照しない。
- 画面設計書（HTML）は `docs/design/ui/` の元データからスクリプトで生成し、生成物は commit しない。仮の画面の下書きは `docs/design/ui/drafts/`（gitignore）に置き、固まったものだけ `docs/design/ui/images/` に入れて commit する。

## Consequences
- 仕様の変更は PR を通り、レビューと履歴が残る。
- 公開リポジトリなので、仕様に秘密情報や、非公開にしたい情報を書かない。
- Google Docs の暫定版を読んで作業を始めたメンバーには、正本が変わったことを伝える必要がある。
