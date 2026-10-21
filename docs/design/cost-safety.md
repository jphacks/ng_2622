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
- Azure for Students で S0 を作れるかは、文書では決着しない。Hack Day の前に、クレジットを持つメンバーが実際に作って確かめる。

## 対策（推測を含む）

| 対策 | 内容 | 防ぐもの |
| --- | --- | --- |
| キーをバックエンドにだけ置く | iPhone にキーも一時トークンも渡さない | キーの漏えい、窓口の悪用 |
| Claude は専用のワークスペースのキーを使う | Default でないワークスペースを作り、月の支出上限とレート上限を掛ける。自動チャージは有効にしない | 使いすぎ、ヒューマンエラー |
| 回数の上限 | 部屋・端末・ラウンドごとに採点の回数を制限する。1 回の音声は最長 20 秒に切る | DoS、バグによる連打 |
| 止めるスイッチ | 環境変数ひとつで外部 API の呼び出しを止め、固定の点数を返すモードに切り替える | 異常に気付いたときの即時停止 |
| 利用量の記録 | バックエンドで、呼び出し回数と音声の秒数を数えて出す | 異常に早く気付く |
| 秘密情報の扱い | `.env` は gitignore 済み。GitHub の push protection を有効のままにする | 公開リポジトリからの漏えい |
