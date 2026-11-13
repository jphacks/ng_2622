# 2026/11/13 タイトル画面の 3D は、サーバーが期間つきで決め、アプリは id で取り直して期限で消す

## Status
- accepted

## Situation
- Award Day（2026-11-15）の前。タイトル画面（ホーム）の 3D を、企業の 3D 広告の見本（JPHACKS が提供した場合に見立てたハッカソンの会場、`assets/title/hackathon.usdz`）に替えて見せたい。実際の提供ではないので、字は「広告の見本：JPHACKS」にする。
- 当日は TestFlight の版（staging のバックエンドにつなぐ）を使う。主はデモの端末（内部テストで入れたチームの端末）で、来場者の自分の端末は、外部テスト（公開リンク）の Beta App Review が通った場合だけ。App Store の利用者は本番につなぎ、公園（作り置きの場面）を見る。
- 先にビルド設定 `TITLE_DIORAMA` で会場を出す形を作った（PR の 9cef030 まで）。出すものを変えるたびにビルドと配布が要る。
- README の「5. 収益モデル」は、タイトル画面の 3D を企業のロゴや象徴する物にし、月額のスポンサー枠として売る想定。利用者を追跡しない前提。

## Context
- 出すものと期間を、アプリの更新なしに変えたい（issue #124）。「11/15 だけ JPHACKS」「この期間はこの会社」のように。
- 期限を過ぎた広告が、オフラインの端末に残り続けるのは困る（契約の期間を過ぎて出し続けない）。
- 起動の最初の描画を通信で待たせたくない。見ている途中で 3D が入れ替わるのも避けたい。
- 締め切り（2026-11-14 12:00、日本時間）までに入らなければ、ビルド設定の版で出す。だから、ビルド設定の版を壊さずに足す。

## Material for decision
- issue #124 と、2026-11-13 の認識合わせのコメント（リーダーと合意）: <https://github.com/jphacks/ng_2622/issues/124#issuecomment-6850121891>
- iOS のビルド構成の決め方: [20261024-build-ios-app-with-xcodegen-and-build-configs](./20261024-build-ios-app-with-xcodegen-and-build-configs.md)、[20261101-ship-ios-app-from-a-dedicated-store-config](./20261101-ship-ios-app-from-a-dedicated-store-config.md)
- 外部のものはバックエンドを通す決め: [20261021-adopt-swiftui-app-and-cloudflare-workers-backend](./20261021-adopt-swiftui-app-and-cloudflare-workers-backend.md)
- 3D の置き場の比べ（1 本 2.4 MB）:

| 案 | 良い点 | だめな点 |
| --- | --- | --- |
| Worker の本体に入れる | 置き場が 1 つ | Worker の大きさの上限に当たりやすい。部品を配るときに伸ばせない |
| R2 | 大きなファイルを多く置ける。デプロイなしで差し替えられる | バケツと権限を足す。repo と中身がずれうる。プレビューで分けにくい |
| Workers の静的アセット（採用） | Worker と一緒にデプロイされ、repo の中身とずれない。プレビューも同じ設定で付く | 差し替えにデプロイが要る（予定の JSON もデプロイで変えるので同じ） |

- 予定の置き場の比べ: repo の JSON（採用。PR で記録とレビューが残る）と KV（デプロイなしで変えられるが、記録が残らない）。デプロイなしで変えたくなったら KV にする。
- 「新しいか」の比べ方: 日時（端末の時計のずれに左右される。前の内容に戻したときに変わったと分からない）と、id（採用。HTTP の ETag と同じ考え）。

## Decision
- バックエンドに `GET /title` を置く。返すのは `{ title: { id, caption, model, sha256, expiresAt } }` か `{ title: null }`。
  - 出すものは、repo の予定（`backend/src/title/schedule.json`。id・ファイル・caption・startsAt・expiresAt・sha256）と、環境の変数 `TITLE_CAMPAIGN`（予定の id、カンマ区切り）の両方で決める。本番は空で、何も出さない。staging だけ、デプロイのときに `--var TITLE_CAMPAIGN:jphacks-2026` を付ける。
  - 期間の判定はサーバーの時刻で行う（両端を含む）。`expiresAt` は秒までの UTC で返す。JPHACKS は 2026-11-15T14:59:59Z（日本時間 23:59:59）まで。
  - id は予定の id と、3D のファイルの sha256 の先頭 8 文字をつなぐ（例 `jphacks-2026-ecc5df64`）。ファイルを作り直せば id も変わり、アプリが取り直す。予定に書いた sha256 と実物が同じかは、バックエンドの unit test で確かめる。
  - `Cache-Control: no-store` で返し、途中で覚えさせない。
- 3D のファイルは、repo の `assets/title/*.usdz` を Workers の静的アセットとして、Worker と一緒にデプロイし、`/title/<file>` で配る。配るファイルは `assets/.assetsignore` で `title/*.usdz` だけに絞る。R2 は使わない。
- iOS は Live のときだけ、起動時と前に戻ったときに、期限の内でも毎回 `GET /title` を呼んで id を比べる（間引かない）。
  - 覚えている id と違えば、裏で 3D を取り、sha256 が合えば端末に保存して、id・caption・expiresAt と一緒に覚える。合わなければ捨てる。古いファイルは消す。
  - 置き場は Caches にする。取り直せるもので（Apple の指針）、部品のキャッシュ（`PartLibrary`）と同じ。OS に消されても、次に確かめたときに取り直す。
  - アプリに同梱した 3D（`assets/title` の写し）と sha256 が同じなら、通信で取らずに写す（会場の回線で 2.4 MB を取り直さない）。
  - `{ title: null }` なら、覚えているものを消して公園に戻す。
  - `expiresAt` を過ぎたら、サーバーにつながらなくても端末の時刻で消して公園に戻す。
  - 出すのは次にホームを開いたときから（見ている途中では入れ替えない）。起動の最初の描画は通信を待たない。
  - 読めない・壊れているときは公園に戻す。
  - 送る情報は無い（表示した回数も数えない）。
- ビルド設定 `TITLE_DIORAMA` は Mock だけで効かせ、同梱の 3D を出す。Live ではサーバーを優先する。
- 本番の App Store の利用者と TestFlight の利用者を見分ける仕組みは作らない（つなぐバックエンドで分ける）。

## Consequences
- 良い面: 出すものと期間を、アプリの更新なしに、PR とデプロイで変えられる。予定と 3D が repo に残り、レビューできる。
- 良い面: 期限が端末にも渡るので、オフラインのまま期限を過ぎても広告が出続けない。
- 良い面: 静的アセットの置き場は、部品の配信（`/parts/<id>/<version>.usdz`。`PartLibrary` がそこから取る作り）にも、`.assetsignore` で戻せば使える。
- トレードオフ: 出すものの切り替えにデプロイが要る。staging と本番で出すものを分けるのは、デプロイのときの変数に頼る（付け忘れると出ない・付け間違えると出る）。
- トレードオフ: 期間の始まりはサーバーが返し始めた後、次にアプリを開いたときからになり、時刻ぴったりには切り替わらない。
- トレードオフ: 起動のたびに `GET /title` を 1 回呼ぶ。応答は小さく、3D は id が変わったときだけ取る。
- 扱わないこと（issue #124 のまま）: 表示回数の計測、広告主向けの管理画面、遊ぶ場面の部品の配信。
