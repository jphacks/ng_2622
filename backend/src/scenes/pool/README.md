# 作り置きの場面（`src/scenes/pool/`）

AI で作り置いた場面（配置の JSON、`scenenglish.scene/2`）の置き場。1 場面 1 ファイルで、ファイルの名前は `<sceneId>.json` にし、中の `id` と同じにする。形は [`docs/design/scene-protocol.md`](../../../../docs/design/scene-protocol.md) の「配置の JSON v2」と「AI で場面を作り置く」。

- Worker に同梱する（R2 には置かない）。iOS の Mock も、ビルドのときにここの `*.json` をアプリの `pool/` に写して使う（`ios/project.yml` の `Copy scene pool`）。写しは repo に置かない。
- 人が画像（`scripts/scene/render_layout.py` で描いた PNG）で確かめたものだけを置く。ID は `gen-` ＋ 英小文字と数字 10 文字。
- 作る手順は [`backend/README.md`](../../../README.md) の「作り置きの場面を作る」。

## 今あるのは仮の場面（`temp-…`）

採点と場面の形を切り替えたときに、古い形（`scenenglish.scene/1`）の 30 場面を消した。今ある 6 個（級ごとに例 1 つ・出題 1 つ）は、切り替えを通しで動かすための**仮の場面**で、ID を `temp-` で始めている。

- 関係（`place` など）とチェックリストを手で書き、生成と同じ裏取り（`verifyScene`）と座標の計算（`composeLayoutV2`）を通して作った。画像では確かめていない。
- 人が確かめた場面（`gen-…`）ができたら、`temp-…` の JSON を消し、`index.json` と `../pool.ts` の import を差し替える。

## `index.json`

Worker は glob できないので、どの場面があるかはこの一覧で決める。ここに無い JSON は使わない。

```json
{
  "eiken-3": { "example": "gen-…", "scenes": ["gen-…", "gen-…"] },
  "eiken-pre2": { "example": "gen-…", "scenes": ["gen-…"] },
  "eiken-2": { "example": "gen-…", "scenes": ["gen-…"] }
}
```

- キーは級の値（`eiken-3`・`eiken-pre2`・`eiken-2`。`src/scenes/types.ts` の `GRADE_IDS`）で、配置の JSON の `difficulty` と合わせる。
- `example`: 待合でホストに絵だけ見せる例。ホストが先に見るので出題しない。
- `scenes`: 出題の候補。**例は入れない**（部屋はこの一覧からそのまま選べばよい）。
- 場面を足す・外すときは、JSON と一緒にここと `../pool.ts` も直す（`test/pool.test.ts` が食い違いを見つける）。
