# 2026/10/24 シーンの評価は全体で 1 つの Durable Object（SQLite）に保存する

## Status
- accepted

## Situation
- バックエンドは Cloudflare Workers ＋ Durable Objects の無料プランで動かしている。部屋の Durable Object は、部屋が閉じたらデータを消す。
- 今後、ユーザーがプロンプトからシーンを作って共有し、評価やコメントを付け合う機能（mod のような拡張）を足す予定がある。

## Context
- シーンごとの★とコメントを、部屋をまたいで残す保存先が要る。今後のユーザー作成シーン・コメント・ランキングも同じ場所に足せるようにしたい。

## Material for decision
- Durable Objects は無料プランでも SQLite の保存方式なら使え、`ctx.storage.sql` で SQL を書ける（architecture.md「Workers の無料プランで足りるか」）。
- D1 はデータベースを作って ID を wrangler.jsonc に書き、PR ごとのプレビューとデプロイにも設定を足す必要がある。

## Decision
- `SceneReviews` という Durable Object を 1 つ（`getByName("global")`）置き、SQLite の表 `reviews(scene_id, reviewer_id, name, rating, comment, updated_at)` に保存する。
- 同じ端末（`reviewer_id`）が同じシーンを評価し直したら上書きする。アカウントは作らない。
- 新しいサービスの準備（D1 の作成など）が要らず、migration の tag を 1 つ足すだけでデプロイとプレビューに載るため。SQL で平均や件数も出せる。

## Consequences
- 良い面: 準備なしで本番とプレビューの両方で動く。ユーザー作成シーンも `scene_id` で同じ表に入る。
- トレードオフ: 1 つのインスタンスに全部の読み書きが集まる。ハッカソンの規模では問題ないが、大きく伸びたら D1 へ移す。
- `reviewer_id` は端末が作る ID なので、なりすましや重複投稿は防げない。コメントの不適切な内容への対策（審査・通報）もまだ無い。
