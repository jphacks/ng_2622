# Architecture Decision Records (ADR)

このプロジェクトの設計やチーム運用に関する重要な意思決定を、決定のログとして残す。

## なぜ ADR を書くのか

- 意思決定の背景や動機が、決めた本人の頭の中だけに残るのを防ぐ
- 非同期のやり取りでも、前提と背景を早く共有できるようにする
- 「なぜそうしたか」を、後から誰でも振り返れるようにする

## 運用ルール

- 重要な意思決定をしたら、このディレクトリに Markdown で 1 ファイル 1 決定として書く。
- ファイル名は `YYYYMMDD-title.md`。`title` は内容が分かる kebab-case にする。
- 仕様書ではなく決定のログとして、小さく分けて書く。
- 書式は [`template.md`](./template.md) に従う。
- 過去の ADR で書き換えてよいのは `Status` だけとする。本文は書き換えず、削除もしない。
- 決定が変わったら新しい ADR を追加し、古い方の Status を `superseded`（後継 ADR へのリンク付き）か `deprecated` にする。

## セクション構成

| セクション | 内容 |
|---|---|
| Status | `proposed` / `accepted` / `rejected` / `deprecated` / `superseded` |
| Situation | 決定時のチームの状況や制約 |
| Context | 決定が必要になった動機や理由 |
| Material for decision | 決定時に参照した材料 |
| Decision | 決定内容とその理由 |
| Consequences | 決定によって生じる結果（良い面とトレードオフ） |

## 索引

| 日付 | タイトル | Status |
|---|---|---|
| 2026-10-17 | [PR 必須・squash merge・規約の自動検査によるチーム開発フロー](./20261017-adopt-team-git-workflow.md) | accepted |
