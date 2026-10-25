# 作り置きの場面（`src/scenes/pool/`）

AI で作り置いた場面（配置の JSON）の置き場。1 場面 1 ファイルで、ファイルの名前は `<sceneId>.json`（`gen-` ＋ 英小文字と数字 10 文字）にし、中の `id` と同じにする。形は [`docs/design/scene-protocol.md`](../../../../docs/design/scene-protocol.md) の配置の JSON と「AI で場面を作り置く」。

- Worker に同梱する（R2 には置かない）。iOS の Mock も、ビルドのときにここの `*.json` をアプリの `pool/` に写して使う（`ios/project.yml` の `Copy scene pool`）。写しは repo に置かない。
- 人が画像（`scripts/scene/render_layout.py` で描いた PNG）で確かめたものだけを置く。
- 作るスクリプトは `scripts/scene/make_pool.py`。手順は [`backend/README.md`](../../../README.md) の「手元で作り置く」。

## `index.json`

Worker は glob できないので、どの場面があるかはこの一覧で決める。ここに無い JSON は使わない。

```json
{
  "easy": { "example": "gen-…", "scenes": ["gen-…", "gen-…"] },
  "normal": { "example": "gen-…", "scenes": ["gen-…"] },
  "hard": { "example": "gen-…", "scenes": ["gen-…"] }
}
```

- 難易度（`easy`・`normal`・`hard`）は、配置の JSON の `difficulty` と合わせる。
- `example`: 待合でホストに絵だけ見せる例。ホストが先に見るので出題しない。
- `scenes`: 出題の候補。**例は入れない**（部屋はこの一覧からそのまま選べばよい）。
- 場面を足す・外すときは、JSON と一緒にここも直す。
