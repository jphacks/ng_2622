# コスト破産への備え

> Status: **合意済み**（2026-10-21）。具体策は [`architecture.md`](./architecture.md) の「コスト破産への備え」と「上限の初期値」。

DoS、不正アクセス、API キーの漏えい、バグやヒューマンエラーによる大量のリクエストで、外部 API の費用が膨らむのを防ぐ。

## 分かったこと（公式ドキュメント、2026-10-21 に確認）

### Azure（Azure for Students、オファー MS-AZR-0170P）

- 支出上限がある。クレジットを使い切るか 12 か月が過ぎると、サブスクリプションとサービスが無効になる。従量課金への自動切り替えは無く、課金も続かない。
  - 出典: https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/azurestudents-subscription-disabled 、https://azure.microsoft.com/en-us/support/legal/offer-details/
- GitHub Student Developer Pack 経由のクレジットが同じオファーかは、公式文書では確認できなかった。
- Speech の有料プラン（S0）を Azure for Students で作れるかは、公式文書では確認できなかった。Students には作れるリージョンを絞るポリシーがあり、Speech の作成に失敗した例が Microsoft Q&A にある（非公式回答、2025-08-29）。
- 予算（Cost Management の Budgets）は、Azure for Students では使えない見込みが高い（Cost Management の対応表で「サポートされないオファー」）。そもそも予算は通知するだけで、利用は止まらない。評価は 24 時間ごとで即時でもない。
- Speech の同時接続数や呼び出し回数を、自分で下げる設定は見つからなかった。S0 の既定は同時 100。

### Claude API（Console）

- 前払いのクレジットを使い切ると、API の呼び出しは失敗する。自動チャージ（auto-reload）は Billing ページで自分で有効にする設定で、既定がオフかは明記されていない。
  - 出典: https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage
- 組織の月の支出上限を設定できる（Billing → Spend limits）。上限に達すると HTTP 400 が返る。
- API キーはワークスペース単位で作れ、ワークスペースごとに支出上限とレート上限（毎分のリクエスト数・トークン数）を掛けられる。ただし Default Workspace には支出上限を掛けられず、ワークスペースを作れるのは組織の admin だけ。
  - 出典: https://platform.claude.com/docs/en/manage-claude/workspaces 、https://platform.claude.com/docs/en/api/rate-limits

### API キーを公開リポジトリに push したとき

- Anthropic のキー: GitHub が検出して Anthropic に通知し、Anthropic が自動で失効させる。2026-10-13 からは push 自体が既定でブロックされる。
- Azure の Speech のキー: GitHub の secret scanning と push protection の対象。ただし Microsoft が自動で失効させるかは確認できなかった。漏れたら自分でキーを作り直す前提にする。
  - 出典: https://docs.github.com/en/code-security/secret-scanning/introduction/supported-secret-scanning-patterns

## ここから言えること

- **お金が青天井に出ていく危険は、両方とも小さい。** Azure for Students はクレジットを使い切ると止まり、Claude も前払いのクレジットが尽きると止まる（自動チャージを有効にしない限り）。
- **本当の危険は「クレジットを使い切られて、本番のデモが動かなくなる」こと。** 審査で最も重視されるのはデモが動くことなので、使い切られないための回数の上限は要る。
- Azure for Students で S0 を作れるかは、文書では決着しない。Hack Day の前に、クレジットを持つ @kameiryohei が実際に作って確かめる。

## 対策（推測を含む）

| 対策 | 内容 | 防ぐもの |
| --- | --- | --- |
| キーをバックエンドにだけ置く | iPhone にキーも一時トークンも渡さない | キーの漏えい、窓口の悪用 |
| Claude は専用のワークスペースのキーを使う | Default でないワークスペースを作り、月の支出上限とレート上限を掛ける。自動チャージは有効にしない | 使いすぎ、ヒューマンエラー |
| 回数の上限 | 部屋・端末・ラウンドごとに採点の回数を制限する。1 回の音声は最長 20 秒に切る | DoS、バグによる連打 |
| 止めるスイッチ | 環境変数ひとつで外部 API の呼び出しを止め、固定の点数を返すモードに切り替える | 異常に気付いたときの即時停止 |
| 利用量の記録 | バックエンドで、呼び出し回数と音声の秒数を数えて出す | 異常に早く気付く |
| 秘密情報の扱い | `.env` は gitignore 済み。GitHub の push protection を有効のままにする | 公開リポジトリからの漏えい |
| 場面の生成を手元に限る | `POST /scenes/generate` は合言葉が要り、アプリは呼ばない。作り置きは手元の `wrangler dev` で行う（2026-10-25、[`scene-protocol.md`](./scene-protocol.md)）。このため 1 回の生成の費用の上限は設けない | 生成の口の悪用、待合での生成の連打 |
| 部屋の生成に上限とスイッチを付ける | 部屋はスタートのたびに場面を作る（2026-10-26、[ADR](../adr/20261026-generate-scenes-in-room-on-start.md)）。1 部屋 20 回まで、1 回 10 秒まででやり直さない。`SCENE_GENERATION` を `off` にすると生成をやめ、作り置きから選ぶ。アプリは生成の口を呼ばず、合言葉も持たない | 待合での生成の連打、Claude のクレジットの使い切り |
| 苦手の分析に上限とスイッチを付ける | `POST /weak-points`（2026-11-13、[`weak-point-analysis.md`](./weak-point-analysis.md)）は認証が無いので、本文の大きさ（64 KB）・IP ごとの 1 時間の回数（普段 10 回）・全体の 1 日の回数（普段 200 回 ≈ 10 USD。Claude を呼んだ回数で、呼び直しも 1 回）を、全体で 1 つの Durable Object `UsageCounter` で数え、超えたら 429 で Claude を呼ばない。`WEAK_POINT_ANALYSIS` を `on` 以外にすると 503 で止まる（PR のプレビューは `off`）。値は `wrangler.jsonc` の `vars`。Award Day の当日の値（IP ごと 60 回・1 日 500 回 ≈ 25 USD）への切り替えと戻し方は [`backend/README.md`](../../backend/README.md) の「苦手の分析の上限を当日の値にする」 | 口の直接の連打、来場者の多い会場での使い切り |
| 苦手の場面と部品に上限とスイッチを付ける | `POST /weak-scenes`（2026-11-14、[`part-generation.md`](./part-generation.md)）も認証が無いので、苦手の分析と同じ形で守る。本文の大きさ（8 KB）、IP ごとの 1 時間の回数、全体の 1 日の回数を `UsageCounter` で数え、超えたら 429 で Claude を呼ばない。`WEAK_SCENE_GENERATION` を `on` 以外にすると 503 で止まる（PR のプレビューは `off`）。新しい部品は 1 場面 4 個まで（費用のヒューズ）、失敗した部品の作り直しは 1 回まで、1 回の生成は 90 秒まで。回数は、普段は IP ごとの 1 時間 5 回・全体の 1 日 40 回（`WEAK_SCENE_IP_PER_HOUR`・`WEAK_SCENE_DAILY_LIMIT`。受け付けた 1 回で 1 つ数える。1 回約 0.2〜0.4 USD の見込みなので、1 日約 8〜16 USD）。Award Day の当日（11/15）は IP ごとの 1 時間 60 回・全体の 1 日 200 回（約 40〜80 USD）にする。会場の Wi-Fi では、デモの端末が同じ IP になるため。当日の値は当日の vars の PR で入れる（2026-11-14、リーダー）。部屋の生成のスイッチ（`SCENE_GENERATION`）とは別にし、当日は部屋の生成を止めたまま、苦手の場面だけを動かす | 口の直接の連打、部品を作る費用の膨らみ |
