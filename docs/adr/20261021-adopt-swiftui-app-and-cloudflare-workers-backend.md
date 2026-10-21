# 2026/10/21 iOS は SwiftUI、バックエンドは Cloudflare Workers の TypeScript にし、外部 API はバックエンドだけが呼ぶ

## Status
- accepted

## Situation
- JPHACKS 2026 の作品（チーム 5 人）。名古屋会場は B 日程で、Hack Day は 2026-10-24・25、開発時間は約 14 時間。
- 作品は、各自の iPhone で同じ 3D シーンを同時に見て英語で描写し、AI の採点で競うもの（[`docs/design/usecase.md`](../design/usecase.md)）。
- Mac を持つのは 5 人のうち 2 人（@TEIKOTA・@kameiryohei）で、iOS の開発経験があるのは 1 人（@TEIKOTA）。
- リポジトリは公開（MIT ライセンス）で、外部 API（Azure・Claude）のキーを扱う。

## Context
- [`AGENTS.md`](../../AGENTS.md) で技術スタックは未定としていた。画面の流れが固まり、作り始める前に決める必要があった。
- 外部 API の費用が、DoS・キーの漏えい・バグによる大量のリクエストで膨らむ「コスト破産」を防ぎたい。
- 2 台の iPhone で同時に遊ぶため、部屋の同期（一斉スタート、結果の一斉発表）が要る。

## Material for decision
- [`docs/design/architecture.md`](../design/architecture.md)（構成、API、上限の初期値、Workers の無料プランの制限）
- [`docs/design/cost-safety.md`](../design/cost-safety.md)（Azure for Students と Claude のクレジットの上限と挙動）
- Cloudflare の公式ドキュメント（Durable Objects の料金、Workers の制限。2026-10-21 に確認）
- Azure の Speech to text REST API for short audio の公式ドキュメント（発音評価は 30 秒まで、正解文は「必須」と記載）
- チームの別作品 ThatsFight（`TEIKOTA/ThatsFight`）の部屋のサーバー（`server/rooms.ts`）と ADR「出題と採点を単一 Node サーバーに集約」

## Decision
- iOS のアプリは SwiftUI のネイティブアプリにする。3D は RealityKit、モデルは USDZ を既定にする。配布は個人の有料 Apple Developer アカウントで行う。
- バックエンドは TypeScript で書き、Cloudflare Workers ＋ Durable Objects で動かす。部屋ごとの状態と WebSocket は Durable Objects に持たせ、ThatsFight の部屋の考え方（部屋の ID、端末ごとの合言葉、切断からの復帰）を移植する。
  - 理由: 回数の上限や DDoS の防御を Cloudflare に寄せられ、常に立てておくサーバーが要らない。無料プランで足りる見込み。
- 外部 API（Azure の発音評価と Claude）は、すべてバックエンドが呼ぶ。iPhone は録音した音声を送るだけにし、キーも一時トークンも渡さない。
  - 理由: 回数の上限や止めるスイッチを 1 か所で効かせられ、全員の採点がそろったかもバックエンドが判断できる。
- Azure は REST（短い音声用）で呼ぶ。Workers では Speech SDK が動く保証が無いため。
- 本物のアプリからの呼び出しかを確かめる仕組み（Apple の App Attest など）は入れず、回数の上限・止めるスイッチ・Cloudflare の IP ごとの回数制限で守る。Azure も Claude もクレジットが尽きると止まり、青天井の課金にはならないため。

## Consequences
- キーが端末に渡らず、コスト破産への対策をバックエンドにまとめられる。
- iOS の作業は Mac を持つ 2 人に寄る。Mac の無い人は、バックエンド・採点の中身・3D の素材・発表資料を担う。
- ThatsFight の Node のサーバーのコードは、そのままは使えず Durable Objects 向けに書き直す。
- REST の発音評価で空の正解文が通らなければ、「文字起こし → その文を正解文にして発音評価」の 2 段になり、Azure の音声の時間が 2 回分になって待ち時間も少し延びる。
- Workers の無料プランの CPU 時間（1 リクエスト 10 ms）を超えたら、有料プラン（月 5 USD〜）にする。
- Android の人は遊べない。
