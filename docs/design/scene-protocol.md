# 部品と配置のプロトコル（v1）

> Status: **合意済み**（2026-10-24）。方針と理由は [`scene-generation.md`](./scene-generation.md) の「部品と配置のプロトコル」。この文書は、部品・配置の JSON・API の形を決める正本。

3D のシーンを「部品（USDZ ＋メタデータ）」と「配置の JSON」に分ける。部品は先に作って保存しておき、配置を書く側（Claude・亀井さんのエージェント・人）は、どの部品をどこに置くかと採点の情報だけを書く。アプリは配置の JSON どおりに部品を並べる。

```
配置を書く側 ──(GET /parts で部品の一覧を読む)──▶ 配置の JSON を書く ──▶ POST /scenes ──▶ sceneId
                                                                                      │
部屋（round で sceneId を配る）──▶ 各端末: GET /scenes/{sceneId}/layout ──▶ 部品を取ってきて並べる
                                    バックエンド: 同じ JSON の description と elements で採点する
```

## 座標

RealityKit に合わせる。

- 単位はメートル。Y が上。地面は y = 0。
- 場面は一辺 8 m の正方形で、中心が原点。x と z は -4〜4 に収める（今の `scripts/scene/common.py` の `SIZE = 8.0` と同じ）。
- カメラは +Z の側から場面を見る。正面を見せたい部品は、+Z を向けて置く。
- 回転は Y 軸まわりだけ。`yaw` は度で、上から見て反時計回りが正。0 のとき部品の正面は +Z を向く。

## 部品

### 部品のファイル

- USDZ 1 つ。2 MB まで。
- 原点は底面の中心（接地点）。y = 0 に置けば地面に立つ。
- 正面は +Z。Blender のスクリプトでは、正面を -Y に作って USDZ に書き出せば +Z になる（今の `person()` と同じ作り方）。
- 大きさは実物の大きさ（m）で作る。人は高さ 1.6 m 前後。
- 色は部品に焼き込む。色違いは別の部品にする（例: `ball_red`・`ball_blue`）。
- 人物は「ポーズ × 見た目」ごとに別の部品にする（例: `person_walk_man_a`、`person_sit_girl_b`）。動作（動詞）はポーズで表す。
- 地面も部品の 1 つ（例: `ground_grass`、8 m × 8 m の板）。

### 部品のメタデータ

```json
{
  "id": "apple",
  "version": 1,
  "file": "parts/apple/1.usdz",
  "category": "food",
  "words": [
    { "word": "apple", "pos": "noun" }
  ],
  "size": [0.08, 0.09, 0.08],
  "label": "リンゴ"
}
```

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `id` | 文字列 | 部品の ID。英小文字・数字・`_` だけ（`^[a-z0-9_]{1,48}$`）。名前で中身が分かるようにする |
| `version` | 整数 | 1 から。同じ版の中身は変えない。直すときは版を上げ、新しいファイルにする |
| `file` | 文字列 | R2 の中のパス。`parts/<id>/<version>.usdz` |
| `category` | 文字列 | `person`・`animal`・`plant`・`food`・`furniture`・`vehicle`・`building`・`ground`・`thing` のどれか |
| `words` | 配列 | この部品で言ってほしい英単語。`pos` は `noun`（名詞）か `verb`（動詞）。人物は動詞も入れる（例: `walk`・`man`） |
| `pose` | 文字列（任意） | 人物と動物のポーズ。`stand`・`walk`・`run`・`sit`・`kneel`・`raise_hand`・`point`・`phone` など |
| `size` | `[幅, 高さ, 奥行き]` | 外接する箱の大きさ（m）。配置を書く側が、重なりや大きさを考える手がかり |
| `label` | 文字列 | 日本語の名前（一覧で人が読む用） |
| `anchors` | 物（任意） | 置き方の手がかりの点（2026-10-24 に追加）。`top`: 上に物を置ける面の高さ（m。例: table は 0.72）。`seat`: 座る点 `[x, y, z]`（例: chair は `[0, 0.46, 0]`）。`hip`: 座るポーズの人の腰の点 `[x, y, z]`（例: `[0, 0.48, -0.2]`）。AI で場面を作るとき、座らせる・上に置く座標の計算に使う |

## 配置の JSON

```json
{
  "protocol": "scenenglish.scene/1",
  "id": "gen-7k2m9q4x3a",
  "name": "リンゴが落ちる公園",
  "difficulty": "easy",
  "description": "A sunny park. An apple is falling from a tree. A man is walking past the tree.",
  "elements": [
    { "id": "place", "label": "公園で", "points": 15, "accept": "park, garden, lawn" },
    {
      "id": "apple_fall",
      "label": "リンゴが木から落ちている",
      "points": 40,
      "accept": "an apple is falling from the tree",
      "partial": "mentions an apple or the tree, without saying it is falling"
    },
    {
      "id": "man_walk",
      "label": "男の人が歩いている",
      "points": 35,
      "accept": "a man is walking",
      "partial": "mentions a man or a person, without saying he is walking"
    }
  ],
  "extraMax": 10,
  "items": [
    { "key": "ground", "part": "ground_grass", "position": [0, 0, 0] },
    { "key": "tree", "part": "tree_apple", "position": [0, 0, -1.5] },
    {
      "key": "apple",
      "part": "apple",
      "position": [0.4, 2.2, -1.2],
      "motion": { "type": "fall", "duration": 1.2, "delay": 0.5, "loop": true }
    },
    {
      "key": "man",
      "part": "person_walk_man_a",
      "position": [2.5, 0, 0.5],
      "yaw": -90,
      "motion": { "type": "move", "to": [-2.5, 0, 0.5], "duration": 6, "loop": true }
    }
  ]
}
```

### 上の階層

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `protocol` | 文字列 | `scenenglish.scene/1` で固定。形を変えるときは数字を上げる |
| `id` | 文字列 | シーンの ID。`POST /scenes` が付けるので、書く側は省いてよい。AI が作ったシーンは `gen-` ＋ 英小文字と数字 10 文字 |
| `name` | 文字列 | 日本語の名前（待合と結果に出す） |
| `difficulty` | 文字列 | `easy`・`normal`・`hard` |
| `description` | 文字列 | 場面の説明（英語）。採点で Claude に渡す |
| `elements` | 配列 | 描写してほしい要素。形は採点（`backend/src/scoring/types.ts` の `SceneElement`）と同じ |
| `extraMax` | 整数 | 一覧に無い正しい描写に出す点の上限。`elements` の `points` の合計と足して 100 にする（今のシーンは 90 ＋ 10） |
| `items` | 配列 | 置く部品。40 個まで。上から順に置く |

### 要素（`elements[]`）

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `id` | 文字列 | シーンの中で重ならない ID |
| `label` | 文字列 | 画面に出す名前（日本語） |
| `points` | 整数 | 配点 |
| `accept` | 文字列 | 満点にする言い方（英語） |
| `partial` | 文字列（任意） | 半分の点にする言い方（英語）。無ければ部分点なし |

要素は、置いた部品の `words` と、部品どうしの関係（「犬がボールに向かって走っている」など）から作る。関係のほうに高い配点を付けると、名詞を並べるだけでなく文で描写したくなる。

### 置く部品（`items[]`）

| 項目 | 型 | 既定 | 意味 |
| --- | --- | --- | --- |
| `key` | 文字列 | 必須 | シーンの中で重ならない名前（例: `apple`・`man`） |
| `part` | 文字列 | 必須 | 部品の ID。版を固定したいときは `apple@1` と書く。書かなければその時点の最新の版 |
| `position` | `[x, y, z]` | 必須 | 部品の原点（底面の中心）を置く位置（m） |
| `yaw` | 数 | `0` | Y 軸まわりの回転（度） |
| `scale` | 数 | `1` | 一様な拡大。0.25〜4 |
| `motion` | 物（任意） | なし | 簡単な動き（下の表） |

### 動き（`motion`）

v1 の基本は止まった場面で、動作は人物のポーズで表す。そのうえで、部品ごとに簡単な動きを 1 つだけ付けられる。

| `type` | 動き | 使う項目 |
| --- | --- | --- |
| `fall` | 置いた位置から真下の地面（y = 0）まで落ちる | `duration` |
| `move` | 置いた位置から `to` までまっすぐ動く | `to`（`[x, y, z]`）、`duration` |
| `rotate` | Y 軸まわりに回り続ける | `duration`（1 回転の秒数） |
| `sway` | 左右に揺れる（木・旗・ブランコなど） | `angle`（度、既定 10）、`duration`（1 往復の秒数） |

共通の項目:

- `duration`: 秒。必須。
- `delay`: 動き始めるまでの秒数。既定 0。
- `loop`: `true` なら、終わったら初めの位置に戻って繰り返す。既定は `true`。

時刻はラウンドの `startAt`（round のメッセージ）から数える。全員の端末で、同じ動きが同じ時に起きるようにするため。

## 崩れの扱い

- バックエンドは、保存するときに何も確かめない（座標も、部品があるかも）。
- 重なり・宙に浮く・はみ出しを見つけて直すのは、配置を書くエージェントの役目。v1 では直さない。だめそうなら、① 部品の `size` から機械的に崩れを見つける、② 場面のスクリーンショットを AI に見せて直させる、の順に対処を広げる。
- アプリは、知らない部品（一覧に無い・取ってこられない）を飛ばし、残りを並べる。全部飛んだら「場面を出せません」と出す。

## API

今の `/scenes`（シーンの一覧と評価、[ADR](../adr/20261024-store-scene-reviews-in-a-global-durable-object.md)）を広げる。部品とシーンの JSON は R2 に置く。

| メソッドとパス | だれが使う | 中身 |
| --- | --- | --- |
| `GET /parts` | 配置を書く側・アプリ | 部品のメタデータの一覧（各部品の最新の版） |
| `GET /parts/{id}/{version}.usdz` | アプリ | 部品の USDZ（R2 から返す。版ごとに中身が変わらないので、長くキャッシュしてよい） |
| `PUT /parts/{id}/{version}` | 亀井さんのエージェント | 部品を保存する。本文は multipart（`meta` にメタデータの JSON、`file` に USDZ）。合言葉が要る |
| `POST /scenes` | 亀井さんのエージェント・人 | 配置の JSON を保存し、`{ "sceneId": "gen-…" }` を返す。合言葉が要る |
| `POST /scenes/generate` | アプリ（待合のホスト） | 本文は `{ "prompt": "リンゴが落ちる公園" }`。Claude が部品の一覧を見て配置の JSON を書き、保存して `{ "sceneId": "gen-…" }` を返す。合言葉は要らない（バックエンドが自分で保存する） |
| `GET /scenes/{sceneId}/layout` | アプリ | 配置の JSON |

- 合言葉: Worker の secret `SCENE_WRITE_TOKEN` に置き、`Authorization: Bearer <合言葉>` で送る。合言葉は亀井さんに直接渡し、ファイルには書かない。
- R2 の置き場所: `parts/<id>/<version>.usdz`、`parts/<id>/<version>.json`（メタデータ）、`scenes/<sceneId>.json`（配置）。
- 部屋の流れは今のまま。ホストは `start` で `sceneId` を送り、部屋は round で全員に配る。採点は、同梱のシーンなら `backend/src/scoring/scenes.json`、`gen-` のシーンなら R2 の配置の JSON の `description`・`elements`・`extraMax` を使う。
- 同梱のシーン（公園・教室・駅前など）は、焼き込んだ USDZ のまま残す。プロトコルに直すのは、確かめのための 1 つだけ。

## AI で場面を作る（`POST /scenes/generate`、2026-10-24 に決定）

ホストの一言から、今ある部品だけで配置の JSON を作る。亀井さんのスクラッチのエージェントとは別の、軽い生成。Claude の Messages API を、出力の形（JSON Schema）を決めて 1 回呼ぶ。ツールを使うループ（エージェント）にはしない。

- 書かせ方: Claude には座標を書かせず、部品どうしの関係（`on`・`under`・`next_to`・`in_front_of`・`behind` など）と大まかな場所だけを書かせる。バックエンドが部品の `size` から座標を計算し、上の「配置の JSON」にして保存する。プロトコルの形は変えない。計算した座標で場面がちゃんと組めることを、実際に描いた画像で確かめてから採用する。
- 生成の口の入力: `{ "prompt": "リンゴが落ちる公園", "difficulty": "easy" }`。`difficulty` は省けば `easy`。難しさで、置く部品の数と描写してほしい要素の数・関係の複雑さを変える（目安: easy は部品 4〜6・要素 4、normal は 6〜10・6、hard は 10〜15・8）。
- 座らせる・上に置く: 部品のメタデータの `anchors`（`top`・`seat`・`hip`）から座標を計算する。
- 呼び方: 採点（`backend/src/scoring/claude.ts`）と同じ SDK（`@anthropic-ai/sdk`）の `messages.create` を 1 回呼ぶ。429・5xx・接続の失敗の再送と、失敗の種類の切り分けを SDK に任せるため。
- モデル: まず `claude-haiku-5-5`（採点と同じ）で試し、作った場面を人が目で確かめてから、`claude-sonnet-5-5` などに変えるかを決める。モデルは環境変数で変えられるようにする。
- 履歴: 作った場面は待合の一覧に出さず、使い回さない。配置の JSON（R2 の `scenes/<sceneId>.json`）に、一言・難しさ・使ったモデル・作った日時を R2 のメタデータとして付けて残す。部品の ID と座標がそろっているので、部品と合わせれば過去の場面をそのまま再現できる。
- 不適切な一言: system に「実在の人の名前や悪口・差別・性的・暴力的な言葉は、名前・説明・要素に使わず、日常の場面に置き換える」と書いてかわす。Claude が断ったときは「作れませんでした」にする。言葉の一覧での検査はしない。
- 失敗したとき: 自動で 1 回だけやり直す。それでもだめなら、理由を付けて「作れませんでした」を返す。ホストは言い方を変えて頼み直すか、同梱のシーンを選べる。待つのは長くて 20 秒。

### Claude に書かせる形と呼び方

Claude には次の形（JSON Schema）で書かせる。部品の ID は `enum` にし、一覧に無い部品は返らないようにする。

```
{ name, description,
  items: [{ key, part,
            place: { relation: ground | on | in | under | above | next_to | in_front_of | behind | near | between | sit_on,
                     target?, target2?（between のとき）, zone?（手前・真ん中・奥 × 左・中・右の 9 区画） },
            facing?: camera | left | right | away | toward（key）,
            motion?: { type: fall | move | rotate | sway, toward?（key か区画）, path?: across | along（toward の部品を横切る・沿う）, duration } }],
  elements: [{ id, label, points, accept, partial? }] }
```

バックエンドは、これを上の「配置の JSON」に直して保存する。

- 地面に置くもの（`ground`）は、区画の中に `size` で重ならないよう並べる。
- `on` は相手の `anchors.top`（無ければ高さ）の上に置く。`sit_on` は相手の `anchors.seat` に人の `anchors.hip` を合わせる。ほかの関係は、相手の `size` に 10 cm の隙間を足した位置に置く。
- `above` は相手の真上に、触れない高さ（相手の高さ＋ 0.3 m）で置く。
- 向き（`facing`）と動きの行き先（`motion.toward`）は、相手の座標から計算する。`path: across` は相手（道路など）を短い辺の向きに横切り、`along` は長い辺に沿って動かす。
- 関係の種類は、調べた結果（[`research/scene-sentence-coverage.md`](./research/scene-sentence-coverage.md)）で多かった位置の言い方（beside・on・under・near・behind・toward・in front of・across・between・above・along）を表せるように選んだ。beside は `next_to`、toward は `motion.toward` で表す。
- 配点は合計 90 に直し、`extraMax` は 10 にする。知らない `target` は無視し、区画の真ん中に置く。

Claude の API（Messages API）に渡すもの:

| パラメーター | 値 |
| --- | --- |
| `model` | 環境変数（既定は `claude-haiku-5-5`） |
| `max_tokens` | 8000 |
| `output_config` | `{ effort: "medium", format: { type: "json_schema", schema } }` |
| `system` | 規則・関係の意味・部品の一覧（`index.json` から id・label・category・words・pose・size・anchors）・例 1〜2 個。`cache_control` でキャッシュする |
| `messages` | `[{ role: "user", content: "難しさ: easy\nお題: リンゴが落ちる公園" }]` |
| `thinking` | 指定しない（Haiku 5.5 は既定で考える） |
| `temperature` | 送らない（2026-10-21 から 400 になる） |
| SDK の設定 | `timeout` 20 秒、`maxRetries` 1 |

`stop_reason` が `end_turn` でなければ失敗とする。Haiku 5.5 には断ったとき（`refusal`）にサーバー側で別のモデルへ回す仕組みが無いので、断られたら「作れませんでした」にする。

## アプリの組み立て

1. `GET /scenes/{sceneId}/layout` で配置の JSON を取る。
2. 使う部品を、同梱 → 端末のキャッシュ → `GET /parts/{id}/{version}.usdz` の順に探す。
3. `items` を上から順に、`position`・`yaw`・`scale` で置く。
4. `motion` を、round の `startAt` を 0 秒として動かす。
5. できた場面を、今の `DioramaView` と同じく画面の大きさに合わせて縮めて出す。

最初からある部品はアプリにも同梱し、会場の電波が悪くてもデモが止まらないようにする。

## 亀井さんのエージェントがやること

1. `GET /parts` で部品の一覧を読む。
2. 足りない部品があれば作り、`PUT /parts/{id}/{version}` で保存する（上の「部品のファイル」に従う）。
3. 配置の JSON を書き、`POST /scenes` で保存して `sceneId` を受け取る。
4. 崩れを見つけて直すのは、エージェントの中で行う。

## 最初に作る部品（34 個、2026-10-24 に決定）

deep research（[`research/scene-parts-research.md`](./research/scene-parts-research.md)）の Tier 1 の 30 個に、人物の見た目違いを 4 個足す。Tier 1 は「30 部品で 8〜10 場面を作れる」ことを条件に選んだもの。

| 区分 | 部品 |
| --- | --- |
| 今のシーンからそのまま流用（形をプロトコルに合わせる） | `tree`・`bench`・`ball_red`・`bicycle`・`umbrella`・`vending_machine`、`person_stand_adult_a`・`person_walk_adult_a`・`person_run_adult_a`・`person_sit_adult_a`・`person_phone_adult_a` |
| 今のシーンから切り出して直す | `car`（雨のバス停）・`trash_bin`（教室）・`smartphone`（カフェ）・`flower`（公園）・`grass_patch`（公園）・`road_patch`（駅前）・`animal_run_dog_a`（公園の犬） |
| 新しく作る | `table`・`chair`・`box`・`apple_red`・`bag`・`book`・`bottle`・`cup`・`sofa`、ポーズの `person_read_adult_a`・`person_eat_adult_a`・`person_carry_adult_a`（`person()` の `hands` で手の位置を変える） |
| 見た目違い（足した 4 個） | `person_walk_woman_a`・`person_sit_woman_a`・`person_run_boy_a`・`person_stand_girl_a`。`adult_a` は男の人とし、man・woman・boy・girl を言い分けられるようにする |

- 確かめた目安: 名前で呼べる部品 N ≒ 32、ポーズ A = 13、前置詞 P = 8 で、描写の文は約 1 万通り。言える動詞は、ポーズの 8 種類（stand・walk・run・sit・read・eat・carry・talk on the phone）に動きの 4 種類を足して約 12。
- 調べた結果の場面のテンプレート（18 場面）は下書きとして使う。採点の配点（どれも 6 要素 × 15 点）は、関係（例: 犬がボールに向かって走る）に高く付けるよう、作るときに直す。

## Open Questions

- 最初に用意する部品の一覧は上で決めた（2026-10-24）。数の決め方の目安は次のとおり。
  - 目安: ほぼ同じ文も含めて 1000 通り以上の描写の文が作れればよい。文の数はおよそ N × P × (N − 1) ＋ A × P × N（N は名前で呼べる部品の数、P は前置詞の数、A は人物・動物のポーズの部品の数）で、部品の数の 2 乗で増える。例えば物 18・ポーズ 8・地面 4 の 30 部品で、P = 8 なら約 6,900 通り、15 部品でも約 1,600 通りになる。
  - 言える動詞の数は、ポーズの数と動きの 4 種類でしか増えない。物を足しても動詞は増えないので、部品を選ぶときはポーズ（動詞）の数を重く見る。
- `POST /scenes/generate` の 1 回の費用の上限（[`cost-safety.md`](./cost-safety.md)）。モデルは上の「AI で場面を作る」で決めた。
- 端末のキャッシュの持ち方と容量。
