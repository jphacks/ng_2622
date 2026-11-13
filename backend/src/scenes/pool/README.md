# 作り置きの場面（`src/scenes/pool/`）

AI で作り置いた場面（配置の JSON、`scenenglish.scene/2`）の置き場。1 場面 1 ファイルで、ファイルの名前は `<sceneId>.json` にし、中の `id` と同じにする。形は [`docs/design/scene-protocol.md`](../../../../docs/design/scene-protocol.md) の「配置の JSON v2」と「AI で場面を作り置く」。

- Worker に同梱する（R2 には置かない）。iOS の Mock も、ビルドのときにここの `*.json` をアプリの `pool/` に写して使う（`ios/project.yml` の `Copy scene pool`）。写しは repo に置かない。
- 人が画像（`scripts/scene/render_layout.py` で描いた PNG）で確かめたものだけを置く。
- 作る手順は [`backend/README.md`](../../../README.md) の「`/2` の作り置きをまとめて作る」（`scripts/make-pool-v2.ts`）。

## 今ある場面（2026-11-11）

2 段の生成（`generate-v2.ts`）で作った候補から、Award Day に出す 30 場面（級ごとに例 1 つ・出題 9 つ）を人が絵で選んだ。ID は `gen-v2-<級>-<テーマ>-<連番>`（例 `gen-v2-pre2-bus-stop-11`）。

- 11/11 のレビューで指摘のあった 15 場面は、関係（`place`・`facing`）と一部の英文を手で直してから、座標を計算し直した。指摘と直し方は [`docs/design/research/pool-v2-review-1111.md`](../../../../docs/design/research/pool-v2-review-1111.md)。
- 11/13 に、理由（`kind: "reason"`）の 20 項目を「間に別の出来事を補わずに、絵から原因が読み取れるか」を目安に見直し、6 項目を直した（`label`・`accept`・`refs` と、description のその文。配置は変えていない）。
  - 飛躍していた 5 項目: 同じ所にあるだけの物や前提（座っている・電車が来ている・ろうそくがある・自転車が横にある）を理由にしていたもの、理由が行動と合っていなかったもの（`gen-v2-eiken2-cafe-02`・`gen-v2-pre2-playground-24`・`gen-v2-pre2-living-room-07`・`gen-v2-pre2-train-station-16`・`gen-v2-pre2-library-20`）。
  - `gen-v2-pre2-cafe-02` は飛躍ではないが、今見えている様子（テーブルにこぼれたジュースがある）で言い直した。
  - 願望・必要は、状況から一目で分かるときだけ原因として認める（11/13 の決定。空のテーブルに座った客とメモを持った店員 → 注文したい、券売機の前の人と電車 → 切符が要る）。気持ちや予定を作り話で足すのは今までどおり不可。生成の指示（`generate-v2.ts`）と材料（`variety.ts` の `REASON_SEEDS`）は、まだ「願望は原因にしない」古い決まりのままで、別の PR で直す。
  - 見落とし: `gen-v2-pre2-beach-09` は、女の子が砂の城から離れて手前を向いていて、「男の子が砂の城を作っているから水を運ぶ」のつながりが絵で見えない。配置を直す必要があるので今回は直さず、issue で扱う。
- 人のポーズの部品（転んだ人・助け起こす人・座る人）を作り直したので、30 場面とも今の部品の寸法で座標を計算し直し（`composeLayoutV2`）、裏取り（`verifyScene`）を通して、絵で確かめた。
- 保存してある座標は、そのときの計算の結果で、今の `composeLayoutV2` で計算し直した値とは 8 場面で合わない（その後、人どうしの間合いを体の大きさで決めるように直したため）。7 場面は絵で見分けがつかない差で、`gen-v2-eiken2-living-room-07` は計算し直すとケーキを切る人がテーブルの手前に回って崩れる。なので、30 場面は保存した座標のまま使い、計算し直さない。置き方を部品の情報で決める直し（issue #105）で扱う。
- 例（`example`）は、待合で級の見本として見せるので、人の動作がはっきり見え、準2級と2級は理由も絵で分かる場面にした（`eiken-3` は公園の犬と男の子、`eiken-pre2` は投げたボールを犬が追う公園、`eiken-2` は 4 人が別々の動作をする台所）。

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
