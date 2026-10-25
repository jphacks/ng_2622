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
| 2026-10-17 | [PR 必須・squash merge・規約の自動検査によるチーム開発フロー](./20261017-adopt-team-git-workflow.md) | accepted（admin の bypass を認めない条項のみ同日に部分 supersede） |
| 2026-10-17 | [admin に PR の merge 時だけ ruleset の bypass を認める](./20261017-allow-admin-bypass-on-pr-merge.md) | accepted |
| 2026-10-21 | [iOS は SwiftUI、バックエンドは Cloudflare Workers の TypeScript にし、外部 API はバックエンドだけが呼ぶ](./20261021-adopt-swiftui-app-and-cloudflare-workers-backend.md) | accepted |
| 2026-10-21 | [話し方と文字起こしは Azure の発音評価、内容・表現と講評は Claude で採点する](./20261021-score-speech-with-azure-and-claude.md) | accepted（内容・表現の点の付け方のみ 2026-10-25 に部分 supersede） |
| 2026-10-21 | [仕様の正本を repo の docs/design/ に置く](./20261021-keep-product-specs-in-docs-design.md) | accepted |
| 2026-10-23 | [TypeScript は Biome で整形し、commit 時に自動でかける](./20261023-format-with-biome.md) | accepted |
| 2026-10-24 | [JavaScript の道具は repo 全体で pnpm で入れる](./20261024-use-pnpm-for-javascript-tools.md) | accepted |
| 2026-10-24 | [iOS アプリは xcodegen で作り、仮のデータと本物の API は scheme ごとのビルド構成で切り替える](./20261024-build-ios-app-with-xcodegen-and-build-configs.md) | accepted |
| 2026-10-24 | [シーンの評価は全体で 1 つの Durable Object（SQLite）に保存する](./20261024-store-scene-reviews-in-a-global-durable-object.md) | accepted |
| 2026-10-24 | [シーンは作り置いた部品を配置の JSON で並べて作る](./20261024-compose-scenes-from-stored-parts.md) | accepted（AI の場面を待合でその場で作る前提のみ 2026-10-25 に部分 supersede） |
| 2026-10-25 | [AI の場面は遊ぶ前に作り置き、待合では難易度だけを選ぶ](./20261025-pre-generate-ai-scenes-and-pick-by-difficulty.md) | accepted |
| 2026-10-25 | [内容と表現の点は、場面の配置の情報を渡し、採点基準の段階で付ける](./20261025-score-content-with-layout-and-rubric-bands.md) | accepted |
| 2026-10-25 | [採点の基準は、配置の JSON と部品のメタデータから作る](./20261025-grade-from-layout-and-part-metadata.md) | superseded |
