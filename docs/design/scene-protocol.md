# 部品と配置のプロトコル（v1）

> Status: **合意済み**（2026-10-24、2026-10-25 に「AI で場面を作り置く」を改訂）。方針と理由は [`scene-generation.md`](./scene-generation.md) の「部品と配置のプロトコル」。この文書は、部品・配置の JSON・API の形を決める正本。

3D のシーンを「部品（USDZ ＋メタデータ）」と「配置の JSON」に分ける。部品は先に作って保存しておき、配置を書く側（Claude・亀井さんのエージェント・人）は、どの部品をどこに置くかと採点の情報だけを書く。アプリは配置の JSON どおりに部品を並べる。

```
配置を書く側 ──(GET /parts で部品の一覧を読む)──▶ 配置の JSON を書く ──▶ POST /scenes ──▶ sceneId
                                                                                      │
部屋（round で sceneId を配る）──▶ 各端末: GET /scenes/{sceneId}/layout ──▶ 部品を取ってきて並べる
                                    バックエンド: 同じ JSON の部品の情報と description で採点する
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

> 2026-11-11 に、バックエンドは下の「配置の JSON v2」（`scenenglish.scene/2`）だけを読むようにした（[ADR](../adr/20261111-score-only-with-checklist-and-drop-handmade-scenes.md)）。この節の `scenenglish.scene/1`（`difficulty` の `easy`・`normal`・`hard`、`elements`、`extraMax`）は、経緯として残している古い形で、今は作らないし読まない。`items` と `motion` の欄の意味は `/2` でも同じ。

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
| `id` | 文字列 | シーンの ID。`POST /scenes` が付けるので、書く側は省いてよい。AI が作ったシーン（作り置きの場面も）は `gen-` ＋ 英小文字と数字 10 文字 |
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

2026-10-25 に、採点を「配置の情報と採点基準の段階」で付ける形に改めた（[`usecase.md`](./usecase.md) の採点、[ADR](../adr/20261025-score-content-with-layout-and-rubric-bands.md)）。新しい採点では、要素は Claude に渡さない。配置の部品の情報と `description`（補足）を渡す。`elements`・`extraMax` は点に使わないが、形は `scenenglish.scene/1` のまま残す。

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

## 配置の JSON v2（`scenenglish.scene/2`、2026-11-10 に決定。2026-11-11 にバックエンドをこの形だけに切り替えた）

チェックリストで採点するため、形を `/2` に上げる（[ADR](../adr/20261110-adopt-scene-protocol-v2-with-checklist.md)）。生成の関数（`backend/src/scenes/generate-v2.ts`・`verify.ts`・`compose-v2.ts`・`grades.ts`・`pose-verbs.ts`）は 2026-11-11 に実装した。同じ日に、部屋での生成・`POST /scenes/generate`・作り置きの場面・採点をこの形につなぎ、`/1` と古い 1 回の生成を消した（まとめ用の branch。main に入るのは、アプリと通しで動いたとき）。`/1` と `/2` の両方を読む期間は作らない（[ADR](../adr/20261111-score-only-with-checklist-and-drop-handmade-scenes.md)）。作り置きの場面は、人が確かめた場面ができるまで仮の場面（`temp-…`）を置いている（`backend/src/scenes/pool/README.md`）。級の規則と生成の書かせ方は [ADR](../adr/20261110-write-grade-sentences-before-scene-parts.md)。

例（`eiken-pre2`、雨のバス停。部品の ID の一部は省略）:

```json
{
  "protocol": "scenenglish.scene/2",
  "id": "gen-xxxxxxxxxx",
  "name": "雨のバス停",
  "difficulty": "eiken-pre2",
  "description": "It is raining at the bus stop. A woman is holding an umbrella. A boy is running to the bus stop because he has no umbrella. A man is sitting on the bench. He is reading a book.",
  "checklist": [
    { "id": "woman_umbrella", "kind": "center", "label": "女の人が傘をさしている", "accept": "a woman is holding an umbrella", "refs": ["woman"] },
    { "id": "boy_run", "kind": "center", "label": "男の子が走っている", "accept": "a boy is running to the bus stop", "refs": ["boy"] },
    { "id": "man_sit", "kind": "center", "label": "男の人がベンチに座っている", "accept": "a man is sitting on the bench", "refs": ["man", "bench"] },
    { "id": "why_run", "kind": "reason", "label": "男の子が走っている理由", "accept": "he is running because it is raining / he has no umbrella", "refs": ["rain", "boy"] },
    { "id": "rain", "kind": "detail", "label": "雨が降っている", "accept": "it is raining", "refs": ["rain"] },
    { "id": "man_read", "kind": "detail", "label": "男の人が本を読んでいる", "accept": "he is reading a book", "refs": ["man"] }
  ],
  "items": [
    { "key": "ground", "part": "sidewalk_stone", "place": { "relation": "ground" }, "position": [0, 0, 0] },
    { "key": "rain", "part": "rain", "place": { "relation": "ground" }, "position": [0, 0, 0] },
    { "key": "bench", "part": "bench", "place": { "relation": "ground", "zone": "center" }, "position": [0, 0, 0] },
    { "key": "man", "part": "person_read_sit_…", "place": { "relation": "sit_on", "target": "bench" }, "position": [0, 0.45, 0] },
    { "key": "woman", "part": "person_umbrella_…", "place": { "relation": "next_to", "target": "bench" }, "position": [1.2, 0, 0] },
    { "key": "boy", "part": "person_run_…", "place": { "relation": "ground", "zone": "left" }, "position": [-3, 0, 1],
      "motion": { "type": "move", "toward": "bench", "duration": 5 } }
  ]
}
```

### 上の階層（`/1` からの違い）

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `protocol` | 文字列 | `scenenglish.scene/2` で固定 |
| `difficulty` | 文字列 | `eiken-3`・`eiken-pre2`・`eiken-2`。画面の名前（かんたんなど）は変えない |
| `description` | 文字列 | 級の見本の答え（3・5・6 文）。録音を待つ画面の正答例、振り返りの見本、採点の補足に使う。`checklist` の `accept` を全部含める |
| `checklist` | 配列 | 採点のチェックリスト（下）。`/1` の `elements`・`extraMax` は無くす |
| `items` | 配列 | `/1` の欄に加えて、Claude が書いた `place`・`facing` と、動きの関係（`motion.toward`・`path`）を残す。動きは 1 つの `motion` に、座標（`to`）と関係（`toward`・`path`）を並べる（下の「実装で決めたこと」） |

`id`・`name` は `/1` と同じ。

### チェックリスト（`checklist[]`）

| 項目 | 型 | 意味 |
| --- | --- | --- |
| `id` | 文字列 | 場面の中で重ならない ID |
| `kind` | `center`・`reason`・`link`・`detail` | 中心・理由・つながり（2級）・細部。重みはバックエンドがここから付ける（中心 2・理由 2・つながり 2・細部 1。[ADR](../adr/20261110-score-content-with-checklist-f1.md)） |
| `label` | 文字列 | 振り返りに出す日本語 |
| `accept` | 文字列 | 「言えた」とする英語の言い方。項目 1 つにつき事実 1 つ（center は誰が何をしているか。場所は、場所を問う detail のときだけ入れる）。` / ` で区切って別の言い方を並べられる。「一部」は採点の Claude がこれと比べて決める |
| `refs` | 文字列の配列 | 項目が指す `items` の `key`。行動する人や動物を先頭に書く。`reason`・`link` は原因と行動の 2 つ以上 |

級ごとの `kind` の数: `eiken-3` は中心 2・細部 1、`eiken-pre2` は中心 3・理由 1・細部 2、`eiken-2` は中心 4・理由 1・つながり 1・細部 2。

### 生成で確かめること（裏取り）

`backend/src/scenes/verify.ts`。落ちた理由は人が読める文で返し、作り直しの指示にそのまま足す。

英文の部分（1 回目の出力）だけで確かめること。落ちたら 2 回目を呼ばずに 1 回目から作り直す:

- `kind` ごとの数が級の形に合う（空の `checklist` もここで落ちる）。
- `id` が重ならない。`refs` が空でなく、呼び名の形（英小文字で始まり、英小文字・数字・`_`）になっている。
- `reason`・`link` の `refs` が 2 つ以上（同じ呼び名は 1 つと数える）。
- `accept`（1 つ目の言い方）が、主語と動詞のある 1 つの事実になっている。動詞の無い切れ端（"to the train"）と、前置詞・接続詞・-ing で始まるもの（"waiting with a basket"・"because …"）は落とす。主語が代名詞（he・she・it・they）の accept も落とす（`detail` も。天気の "it is raining" と there で始まる `detail` はよい）。語の一覧で粗く見るだけで、文法は確かめない。
- `center` の主語の人や動物に、その動作ができる（`accept` でいちばん先に出てくる呼び方 man・girl・old man などについて、その見た目の部品のどれかが `accept` の動詞を言える）。drink は woman・man だけ、のような「できる人」の違反を、部品を選ぶ前に落とす。一覧に無い呼び方（teacher など）は確かめない。
- 同じ事実を 2 つの項目にしていない。`detail` の `accept` が、ほかの `center`・`detail` の `accept` と同じか、その一部なら落とす。`center` どうしが同じ文でも落とす。`reason`・`link` が `center` の文を含むのと、`center` に場所を足した長い `detail`（"… on the sidewalk"）は落とさない。
- `accept` が `description` に含まれる。大文字小文字と句読点の違いは無視し、語の境界で当てる。` / ` で区切った別の言い方は、どれか 1 つが含まれればよい。

部品（2 回目の出力）と照らして確かめること:

- `refs` の `key` が全部 `items` にある。`key` が重ならない。部品が一覧にある（2 回目だけ作り直す）。
- 人と動物の数が級の範囲（1〜2・3・3〜4。動物も 1 人と数える）に入る。
- 屋内の床（`floor_` で始まる地面）の場面に `rain` が無い。
- 人が持っている物（部品の `holds`）と同じ物の部品を、別に置いていない。落とすのは、その物がどの項目の `refs` にも無いとき（2 回目だけ作り直す）と、その物を指す項目が全部、持っている人も指しているとき（1 回目から）。持っている人と関係の無い項目が指す物（ベンチの上の別の傘）と、その動作に要る物（`uses`）は落とさない。
- `reason`・`link` の `refs` に、行動する人や動物がいる。原因が見える物かどうか（因果の中身）はコードでは確かめられないので、指示と画像での確かめに任せる。
- 物を壁に掛ける関係は無いので、背景の壁（category が building）以外の部品を "on the wall" と言う項目は落とす（時計など）。
- `reason`・`link` の行動の動詞が、その人のポーズで言える。`reason` は because より前、`link` は文の全部を見る。その人は、文の先頭の呼び方（woman など）が合う `refs` の人、無ければ `refs` の先頭の人。
- 人が主語の `detail`（"the woman is drinking from a cup"）の動詞が、その人のポーズで言える（2 つ目の動作を `detail` にさせない）。段階は見ない。
- 項目の主語の人の呼び方（girl・boy・man・woman・old man・waiter など）と、`refs` の人の部品の見た目（部品の `words` の先頭）が合う（2026-11-12）。子どもと大人・男と女の取り違えを落とし、同じ枠の言い換え（tall boy と背の高い男の子、man とおじいさん、mother と woman）は通す。仕事の呼び方（waiter・clerk・doctor）は大人ならどれでもよい。
- 見本の答えの各節（because・so・so that・while・when・but で分けた所）の主語の人の動作が、その人のポーズで言える（2026-11-12）。動作は be の後の -ing、has の後の過去分詞、and でつないだ -ing（"is sitting on a sofa and reading" の reading）で、to の後（目的）は数えない。主語の呼び方が合う人のうち誰か 1 人が言えればよい。項目の言い方で確かめ済みの節は見ない。その呼び方のほかの部品で言えるなら 2 回目だけ、言える部品が無ければ 1 回目から作り直す。
- `center` の項目:
  - `refs` に人や動物がいる。
  - 同じ人が 2 つの `center` の主役（`refs` の先頭の人や動物）になっていない（1 人につき動作は 1 つ）。
  - `refs` の人や動物のポーズで言える動詞が、`accept` に語として出てくる（食い違えば 2 回目だけ作り直す）。動詞は -s・-ing・-ed・不規則な形でも当てる。見るのは動詞だけで、目的語や位置の関係は確かめない。
  - `accept` に出てきたその動詞の段階が、級の範囲（CEFR-J）に入る。段階はポーズではなく動詞ごとに見る（wipe のポーズは、wiping なら B2、cleaning なら A1）。

座標に直してから確かめること（`verifyPlaces`。部品までの裏取りを通った場面だけ）:

- `refs` に地面の部品があり、`accept` が on・across・along で場所を言う項目（next to・near などは除く）について、その人や物の座標の真下にある地面（重なっていれば小さいほう。歩道に重ねた道路など）が、`refs` の地面と同じ。違えば 2 回目だけ作り直す。

- 見本の答えの各節で人が持っていると言う物（with・holding・carrying・has の後の、部品の物の名前）が、その人の部品の持ち物（`holds`）にあるか、その物の部品がその人から 1.5 m 以内にある（2026-11-12）。
- 絵（`render_layout.py`）と同じカメラから見て:
  - 窓・扉・時計が、背景の壁の手前の面から 1.2 m 以内（奥の区画の列）にある。屋外の窓・時計は付ける壁が無いので落とす。英文で言っていれば 1 回目から、部品だけなら 2 回目だけ作り直す。
  - 項目が指す物や人の真ん中が、絵の中にある（奥の木の上の風船は上にはみ出す）。
- 人が人や家具に隠れているかは確かめない。画面での四角で覆われる割合を見積もったが、人が絵で決めた「通す」（テーブルの奥に座る人、注文を取る店員の奥の客）と「落とす」（テーブルと人の陰の女の子）を、しきい値で分けられなかったため。2 回目の指示で止める。

落ちたら、作り置きは理由を指示に足して 2 回まで作り直す（`generateVerifiedScene`）。英文を書き直さないと直らない理由は 1 回目から、部品だけの理由は同じ英文のまま 2 回目だけ、同じ英文で部品が 2 回落ちたら 1 回目から。形が違う・途中で止まった応答も同じように作り直す。断られた・API の失敗は作り直さない。部屋での生成は作り直さず、裏取りで落ちたら同じ級の作り置きの場面に切り替える。

### 実装で決めたこと（2026-11-11）

- **動き**: `items[].motion` は 1 つの欄に、計算した座標の動き（`type`・`to`・`duration` など）と、Claude が書いた動きの関係（`toward`・`path`）を並べる。1 つの部品に動きは 1 つなので、欄を分けると `type` と `duration` が二重になり食い違いうるため。アプリは座標の欄だけを読めば動く。
- **`accept` の ` / `**: 別の言い方を並べる区切り。裏取りは、どれか 1 つが `description` にあれば通す。採点の側も ` / ` を別の言い方として読む。
- **動詞の段階**: CEFR-J Wordlist v1.5 の動詞の値をそのまま使う（`pose-verbs.ts` の `VERB_LEVELS`。手で直さない。stand は A2、wipe・sweep・clap は B2）。段階には B2 も持ち、「B2 か語彙表に無い（peck・poke）＝どの級の中心の動作にも使えない」として扱う。3級では、立っている人は waiting・looking、机を拭く人は cleaning のように、同じポーズを A1 の動詞で言わせる。
- **ポーズで言える動詞**: ポーズごとの表（`POSE_VERBS`）に、姿勢の動詞を足す。腰の基準点（`anchors.hip`）を持つ人は sit、それ以外の人のうち走る・歩く・座り込む・ひざをつくポーズでない人は stand を言える（立っている人は何をしていても「立っている」と言えるため）。表に無いポーズは部品の `words` の動詞を使う。
- **助動詞**: `accept` の動詞を拾うとき、have・do は、ほかの動詞があれば数えない（"has fallen" の has を、物を持つポーズの have と取り違えないため）。
- **場面が似すぎないようにする**（`variety.ts`）: 1 回目の指示に「理由にできる見える出来事」（投げたボールと犬、眠る子と起こす人、注文を取る店員など。今の部品で描けるものだけ）を材料として並べ、指示の例は形だけを示すものとして写させない。作り置きを級ごとにまとめて作るときは、先に作った場面の要約（`summarizeScene`）を入力の `avoid` に渡して違う場面を書かせ、`overusedCauses` で同じ理由の原因が 3 場面を超えていないかを数える（裏取りではなく、場面を選ぶ段取りで使う）。
- **雨**: 屋外の場面だけ。指示では駅のホームも雨なしとし、裏取りは屋内の床のときだけ落とす。
- **級の規則**: `grades.ts` の `GRADES`（CEFR、文法の一覧、人の数、見本の文の数と語数、`checklist` の数）。1 回目の指示の表も、裏取りで数える数も、ここから作る。
- **指示の例**: `eiken-pre2` の雨のバス停の 1 つ。上の例の JSON とは、実在の部品で組めるよう少し違う（傘を持つのは女の子。`center` は動作だけ、ベンチに座っていることは `detail`）。

### Claude に書かせる形（`/2`、2 段）

```
1 回目（部品の一覧は渡さない）
  { name, sentences: [文, …], checklist: [{ id, kind, label, sentence, accept, refs }] }
     ↓ コードが保存する形に直す: description = 文をつなげたもの、accept = 番号（sentence）の文から取る
  { name, description, checklist: [{ id, kind, label, accept, refs }] }   ← refs は英小文字の短い呼び名（man・bench）
     ↓ description を 1〜3 文ずつ
部品の候補 candidates(description)   ← 今は全部の部品を返す。後でベクトル検索（種類ごとに上位 k 個の要素 → 部品）に差し替える
     ↓ コードが refs の呼び名を集める
2 回目（1 回目の出力の全部・候補の部品・呼び名の一覧を渡す）
  { items: [{ key, part, place, facing?, motion? }] }                    ← 呼び名を全部 key に使う。/1 と同じ形
```

- 1 回目は、見本の答えを文の配列（`sentences`）で先に書かせ、項目ごとに「どの文の事実か」を番号（`sentence`、1 から）で書かせる（2026-11-12）。2級は項目が 8 つ・見本が 6 文で、`accept` を `description` と違う文で書く、同じ文を 2 つの項目に使う、が多かったため。保存する形（`description`・`accept`）にはコードが直す（`toSceneSentences`）。
  - `center` と `detail` は 1 文に 1 つ（文の数 = `center` の数 + `detail` の数。3・5・6 文）。`reason`・`link` は自分の文を持たず、`center` の文に because・so で書き足して、その文の番号を持つ。
  - `reason`・`link` の `accept` は、番号の文の全部（文末の句読点を取り、先頭を小文字にする）。Claude が別の言い方を書いていれば ` / ` で後ろに足す。
  - `center`・`detail` の `accept` は、Claude が書いた言い方が番号の文にあればそれ。無ければ文から取り直す（`center` は because・so より前の節、`detail` は文の全部）。これで `accept` は必ず `description` にある。
  - 形の決まりの違反（文の数が級と違う、番号の文が無い、`center`・`detail` が同じ文を使っている）は、裏取りの理由と同じ扱いで 1 回目から作り直す。
- 作り直しのときは、落ちた理由（どの項目かを id で名指しした文）と一緒に、落ちた前の答え（1 回目からなら前の英文、2 回目だけなら前の部品）を見せ、「名指しされた所を直し、ほかは残す」と指示する。
- 1 回目に渡すのは、級の規則の表、今の部品で描ける動作の一覧（動作 | 言える動詞と段階 | できる人）、物の一覧、テーマの一覧、例 1 つ。部品の ID は見せない。user の文には級・テーマと、その級の `checklist` の数を書く。
- 1 回目の schema は `checklist` と `refs` に `minItems: 1` を付ける（structured outputs が受け付ける `minItems` は 0 と 1 だけなので、級の数までは指定できない。数は裏取りで数える）。`kind` はその級に出る種類だけの enum。
- 2 回目に渡す部品の一覧には、人と動物のポーズで言える動詞（`says`）を出し、`center` の `accept` の動詞が言える部品を選ばせる。場面・関係・向き・動きの決まりは `/1` の生成と同じ文を使い、`relate`・`seat_at`・`thrown_by`・`facing: "auto"`・`holds`・`uses` の説明を足す。
- 作り置きをまとめて作るスクリプトは `backend/scripts/make-pool-v2.ts`。場面の ID は `gen-v2-<級>-<テーマ>-<連番 2 桁>`（例: `gen-v2-pre2-bus-stop-11`。級は `eiken3`・`pre2`・`eiken2`、連番は級の中の番号）。アプリが `gen-` で始まる ID を AI で作った場面とみるので先頭は `/1` の作り置き（`gen-` ＋ 10 文字）と同じにし、続く `v2-` で `/2` と分かるようにする。
- 呼び名の一覧（`cast`）は作らない。検索の問い合わせは、検索のモデルの学習と同じ形（場面の英文 1〜3 文）にする（[ADR](../adr/20261110-write-grade-sentences-before-scene-parts.md)）。
- Award Day（2026-11-15）の当日は、部屋での生成を止める（`SCENE_GENERATION` を `off`）。

## 崩れの扱い

- バックエンドは、保存するときに何も確かめない（座標も、部品があるかも）。
- 重なり・宙に浮く・はみ出しを見つけて直すのは、配置を書くエージェントの役目。v1 では直さない。だめそうなら、① 部品の `size` から機械的に崩れを見つける、② 場面のスクリーンショットを AI に見せて直させる、の順に対処を広げる。
- アプリは、知らない部品（一覧に無い・取ってこられない）を飛ばし、残りを並べる。全部飛んだら「場面を出せません」と出す。

## API

今の `/scenes`（シーンの評価、[ADR](../adr/20261024-store-scene-reviews-in-a-global-durable-object.md)。シーンの一覧 `GET /scenes` は 2026-11-11 に消した）を広げる。部品と、`POST /scenes` で保存したシーンの JSON は R2 に置く。作り置きの場面は R2 ではなく、Worker に同梱する（下の「AI で場面を作り置く」）。

| メソッドとパス | だれが使う | 中身 |
| --- | --- | --- |
| `GET /parts` | 配置を書く側・アプリ | 部品のメタデータの一覧（各部品の最新の版） |
| `GET /parts/{id}/{version}.usdz` | アプリ | 部品の USDZ（R2 から返す。版ごとに中身が変わらないので、長くキャッシュしてよい） |
| `PUT /parts/{id}/{version}` | 亀井さんのエージェント | 部品を保存する。本文は multipart（`meta` にメタデータの JSON、`file` に USDZ）。合言葉が要る |
| `POST /scenes` | 亀井さんのエージェント・人 | 配置の JSON を保存し、`{ "sceneId": "gen-…" }` を返す。合言葉が要る。R2 と合わせて、亀井さんのエージェントが使うときに入れる |
| `POST /scenes/generate` | 作り置きのスクリプト（手元） | 本文は `{ "difficulty": "eiken-pre2", "theme": "公園" }`（`theme` は任意）。Claude が 2 段で見本の答え・チェックリスト・部品と関係を書き、裏取りを通った配置の JSON（`scenenglish.scene/2`）を、保存せずにそのまま返す。合言葉が要る。アプリは呼ばない |
| `GET /scenes/{sceneId}/layout` | アプリ | 配置の JSON（作り置きの場面は同梱の JSON から、`POST /scenes` で保存したものは R2 から返す）。部屋が作った場面は `?room=<部屋の番号>` を付けると、その部屋に置いたものを返す（2026-10-26） |

- 合言葉: Worker の secret `SCENE_WRITE_TOKEN` に置き（手元の `wrangler dev` では `.dev.vars`）、`Authorization: Bearer <合言葉>` で送る。合言葉は亀井さんに直接渡し、ファイルには書かない。
- R2 の置き場所: `parts/<id>/<version>.usdz`、`parts/<id>/<version>.json`（メタデータ）、`scenes/<sceneId>.json`（配置）。
- 部屋は round で `sceneId` を全員に配る（今のまま）。作り置きの場面では、ホストは `start` で難易度を送り、部屋が場面を選ぶ（下の「待合での出し方」）。採点は、作り置きの場面なら同梱の配置の JSON、`POST /scenes` で保存した場面なら R2 の配置の JSON を使う。
- 手作りの 6 場面（公園・教室・駅前・雨のバス停・海辺・カフェ）は、部品の配置で作り直し、作り置きの場面と同じ形で採点する（2026-10-25）。作り直すまでは使わない。外すのは、作り置きの場面と新しい採点が本番に入るのと同時にする。それまでは、焼き込んだ USDZ と今の採点のまま遊べる。

## AI で場面を作り置く（`POST /scenes/generate`、2026-10-25 に決定）

> 2026-10-24 には「待合でホストが一言（お題）を書き、その場で作る」と決めていたが、2026-10-25 に作り置きに改めた（[ADR](../adr/20261025-pre-generate-ai-scenes-and-pick-by-difficulty.md)）。一言を書いた人だけが場面の中身を知っていて、有利になるため。

今ある部品だけで配置の JSON を作る。亀井さんのスクラッチのエージェントとは別の、軽い生成。Claude の Messages API を、出力の形（JSON Schema）を決めて呼ぶ。ツールを使うループ（エージェント）にはしない。

> 2026-11-11 に、生成を 2 段（上の「Claude に書かせる形（`/2`、2 段）」）に切り替え、1 回の呼び出しで書かせる古い生成を消した。下の「難易度の中身（推測）」「実測（2026-10-25）」「書かせ方」「Claude に書かせる形と呼び方」のうち、難易度 A・B・C、`elements`、1 回の呼び出しの話は古い生成のもので、経緯として残している。部品の関係から座標を計算すること、モデルと effort、止めるスイッチは今も同じ。

### 作り置きの流れ

```
作り置きのスクリプト（手元）──POST /scenes/generate──▶ 手元の wrangler dev ──▶ Claude
        │ 配置の JSON が返る（保存はしない）
        ▼
render_layout.py で PNG に描く ──▶ 人が目で確かめる ──▶ 良いものだけ repo の JSON にして commit ──▶ Worker に同梱
```

- 場面は遊ぶ前にスクリプトでまとめて作る。待合でその場では作らない。
- 数: まず難易度ごとに 10 場面（計 30）。
- 確かめ方: `scripts/scene/render_layout.py` で PNG に描き、人が目で見る。崩れていないか、`description` の文がその絵と合っているかを見る（`description` は採点で補足として Claude に渡すため）。だめなものは捨てて作り直す。
- 置き場所: `backend/src/scenes/pool/` に 1 場面 1 ファイルの JSON（`<sceneId>.json`）で置き、Worker に同梱する。R2 には置かない。iOS の Mock も、ビルドのときにここから写して使う（置き場所は 1 か所）。
- 一覧: Worker は glob できないので、同じ所の `index.json` に難易度ごとの例（`example`、待合で見せて出題しない）と出題の候補（`scenes`、例は含めない）を書く。形は `backend/src/scenes/pool/README.md`。
- ID（案）: 今までどおり `gen-` ＋ 英小文字と数字 10 文字。生成の口が付けて返す。
- 作り置きのスクリプトも `POST /scenes/generate` を呼ぶ。Claude への指示と座標の計算を 1 箇所にまとめるため。
- 呼ぶ先は手元の `wrangler dev`。生成に使う Claude のキーは手元の `.dev.vars` だけに置き、本番では作り置きをしない。
- 履歴: 作り置きの場面は repo の JSON なので、git の履歴に残る。部品の ID と座標がそろっているので、部品と合わせれば過去の場面をそのまま再現できる。

### 生成の口

| 項目 | 中身 |
| --- | --- |
| 呼ぶ人 | 作り置きのスクリプト。アプリは呼ばない |
| 合言葉 | 要る。`Authorization: Bearer <SCENE_WRITE_TOKEN>`（下の API の節と同じ合言葉） |
| 入力 | `{ "difficulty": "eiken-pre2", "theme": "公園" }`（`difficulty` は級の値）。`theme` は任意。省けば、指示の中のテーマの一覧（公園・カフェ・店・駅・部屋など）から Claude が選ぶ |
| 出力 | 配置の JSON（`scenenglish.scene/2`）をそのまま返す。保存はしない。裏取りで落ちたら 2 回まで作り直し、それでも通らなければ 422 `generation_failed` |
| クラウドに残すとき | 返った JSON を `POST /scenes` に送る。生成の口に保存のフラグは付けない。`POST /scenes` と R2 は、亀井さんのエージェントが使うときに入れる |

### 難易度の中身（推測）

2026-11-10 に、難易度の値を `eiken-3`・`eiken-pre2`・`eiken-2` に変えると決めた（[ADR](../adr/20261110-align-scoring-with-eiken-speaking-viewpoints.md)）。画面の名前は変えず、古い値は受け付けない。2026-11-11 にバックエンドを切り替えた（[ADR](../adr/20261111-score-only-with-checklist-and-drop-handmade-scenes.md)）。下の表の A・B・C は古い 1 回の生成のもので、経緯として残している。今の級の中身は `backend/src/scenes/grades.ts` の `GRADES`。級ごとのチェックリストの数は [`usecase.md`](./usecase.md) の採点。

[`research/scene-levels-emotions.md`](./research/scene-levels-emotions.md) の A・B・C の段階に合わせる案。

| 難易度 | 段階 | 動詞 | 説明文の文の数 | 部品の数の目安 |
| --- | --- | --- | --- | --- |
| かんたん（`easy`） | A（初級） | stand・walk・run・sit・eat・read など | 4 | 4〜6 |
| ふつう（`normal`） | B（中級） | lean・reach・pick up・check watch など | 6 | 6〜10 |
| むずかしい（`hard`） | C（上級） | glance・stroll・crouch など | 8 | 10〜15 |

- 部品の数の目安は、2026-10-24 に決めた値のまま。
- 言える動詞は、部品のポーズで決まる。今の部品には中級・上級の動詞のポーズが少ないので、足りない分は関係の複雑さ（`between`・`across` など）と説明文の文の数で難しくする（推測）。

### 待合での出し方

- ホストは難易度（かんたん・ふつう・むずかしい）だけを選ぶ。どの場面かは、名前もサムネイルもスタートまで見せない。ホストも知らない。
- 部屋は、その難易度の作り置きの場面のうち、その部屋でまだ出ていないものからランダムに選ぶ。全部出たら最初に戻る。
- `start` で難易度（`difficulty`: `eiken-3`・`eiken-pre2`・`eiken-2`。2026-11-11 に切り替えた。古い値は `invalid_message`）を送り、部屋が選んだ `sceneId` を round で全員に配る。round の形は変えない。
- 部屋は出した場面を覚え（難易度ごと）、その難易度を全部出したら、その難易度の分だけ忘れて最初に戻る。
- `sceneId` と `difficulty` の両方を送ると `invalid_message`。どちらも無ければ、全部の級の作り置きの場面からおまかせで選ぶ（2026-11-11。手作りの場面を外したため。それまでは手作りの場面のおまかせだった）。`sceneId` には作り置きの場面の ID だけを送れる。
- 作り置きの場面のラウンドは、話し方は Azure のまま、内容・表現と講評をチェックリストの採点（`backend/src/scoring/checklistGrade.ts`）の 1 回の Claude 呼び出しで付ける（2026-11-11。それまでは `bands.ts` の段階の基準で、`nextStep.gain` は null だった）。結果（results）には内容の内訳が入り、`nextStep.gain` は合計の点の伸び。手作りの場面は外した。形は [`usecase.md`](./usecase.md) の「アプリへ送るもの」。
- 手作りの 6 場面の扱いは、下の API の節の最後。

### 失敗したとき

- 形が違う・途中で止まった・5xx・接続の失敗のときだけ、1 回やり直す。断られた（refusal）・4xx・タイムアウトではやり直さない。
- だめなら、理由を付けて失敗を返す。スクリプトはその場面を飛ばし、次を作る。
- 待合で待たせないので、締め切りは短くしなくてよい。各回の `timeout` は 60 秒にする（案）。

### 実測（2026-10-25）

手元の `wrangler dev`、旧形式の口（一言を渡す形）、同じ 6 つのお題（各難易度 2 つ）で 1 場面を作るのにかかった時間。出来は、描いた画像で見て同じくらいだったので、Sonnet 5.5 の low にした。

| 難易度 | Haiku 5.5・medium | Sonnet 5.5・low（採用） |
| --- | --- | --- |
| かんたん | 3〜5 秒 | 3.7 秒 |
| ふつう | 3〜8 秒 | 4.8〜5.2 秒 |
| むずかしい | 12〜14 秒 | 5.9〜6.5 秒 |

### やめたこと（2026-10-25）

作り置きにして、合言葉と手元での実行に限ったので、次は要らなくなった。

- ホストの一言（お題）の入力と、不適切な一言への対策（system でかわす決まり）
- 待合で待つ長さの上限（20 秒の締め切り）
- 1 回の生成の費用の上限
- 作った場面を R2 に保存し、一言・難しさ・モデル・日時を R2 のメタデータに残すこと

### 書かせ方

- Claude には座標を書かせず、部品どうしの関係（`on`・`under`・`next_to`・`in_front_of`・`behind` など）と大まかな場所だけを書かせる。バックエンドが部品の `size` から座標を計算し、上の「配置の JSON」にする。プロトコルの形は変えない。
- Claude は 1 回の呼び出しで、場面の説明文（`description`、言わせたい文）を先に書き、その文を描ける部品と関係を後に書く。言わせたい文から場面を組み立てるため。説明文は採点でも補足として使う。
- 座らせる・上に置く: 部品のメタデータの `anchors`（`top`・`seat`・`hip`）から座標を計算する。
- 呼び方: 採点（`backend/src/scoring/claude.ts`）と同じ SDK（`@anthropic-ai/sdk`）の `messages.create` を 1 回呼ぶ。
- モデル: `claude-sonnet-5-5` の effort `low`（2026-10-25。上の実測で Haiku 5.5 の medium より速く、出来は同じくらいだったため）。モデルと effort は環境変数（`CLAUDE_SCENE_MODEL`・`CLAUDE_SCENE_EFFORT`）で変えられる。

### Claude に書かせる形と呼び方

Claude には次の形（JSON Schema）で書かせる。`description` を `items` より前に置き、説明文を先に書かせる。`elements` は採点に使わないが、プロトコルの形を変えないため書かせる。部品の ID は `enum` にし、一覧に無い部品は返らないようにする。

```
{ name, description,
  elements: [{ id, label, points, accept, partial? }],   ← 採点には使わない
  items: [{ key, part,
            place: { relation: ground | on | in | under | above | next_to | in_front_of | behind | near | between | sit_on,
                     target?, target2?（between のとき）, zone?（手前・真ん中・奥 × 左・中・右の 9 区画） },
            facing?: camera | left | right | away | toward（key）,
            motion?: { type: fall | move | rotate | sway, toward?（key か区画）, path?: across | along（toward の部品を横切る・沿う）, duration } }] }
```

バックエンドは、これを上の「配置の JSON」に直して返す。

- 地面に置くもの（`ground`）は、区画の中に `size` で重ならないよう並べる。
- `on` は相手の `anchors.top`（無ければ高さ）の上に置く。`sit_on` は相手の `anchors.seat` に人の `anchors.hip` を合わせる。ほかの関係は、相手の `size` に 10 cm の隙間を足した位置に置く。
- `above` は相手の真上に、触れない高さ（相手の高さ＋ 0.3 m）で置く。
- 向き（`facing`）と動きの行き先（`motion.toward`）は、相手の座標から計算する。`path: across` は相手（道路など）を短い辺の向きに横切り、`along` は長い辺に沿って動かす。
- 関係の種類は、調べた結果（[`research/scene-sentence-coverage.md`](./research/scene-sentence-coverage.md)）で多かった位置の言い方（beside・on・under・near・behind・toward・in front of・across・between・above・along）を表せるように選んだ。beside は `next_to`、toward は `motion.toward` で表す。
- 配点は合計 90 に直し、`extraMax` は 10 にする。新しい採点（[`usecase.md`](./usecase.md) の採点）では使わないが、プロトコルの形を変えないため。知らない `target` は無視し、区画の真ん中に置く。

Claude の API（Messages API）に渡すもの:

| パラメーター | 値 |
| --- | --- |
| `model` | 環境変数 `CLAUDE_SCENE_MODEL`（既定は `claude-sonnet-5-5`） |
| `max_tokens` | 8000 |
| `output_config` | `{ effort: "low", format: { type: "json_schema", schema } }`。effort は環境変数 `CLAUDE_SCENE_EFFORT` で変えられる |
| `system` | 規則・関係の意味・難易度ごとの目安・テーマの一覧・部品の一覧（`index.json` から id・label・category・words・pose・size・anchors）・例 1〜2 個。`cache_control` でキャッシュする |
| `messages` | `[{ role: "user", content: "難しさ: easy\nテーマ: 公園" }]`。テーマを省いたときは「テーマ: 一覧から選ぶ」 |
| `thinking` | 指定しない |
| `temperature` | 送らない（2026-10-21 から 400 になる） |
| SDK の設定 | 各回の `timeout` は 60 秒（案）。SDK の再送は使わない（`maxRetries` 0）。やり直しは上の「失敗したとき」の決まりで口の側が行う |

`stop_reason` が `end_turn` でなければ失敗とする。断られたとき（`refusal`）は失敗を返す。

## 部屋がスタートで場面を作る（2026-10-26 に決定）

> 2026-10-25 には「待合でその場では作らない」と決めていたが、2026-10-26 に、作り置きを控えにして部屋がその場で作る形を足した（[ADR](../adr/20261026-generate-scenes-in-room-on-start.md)）。遊べる場面の幅を広げるため。

```
ホスト ──start { difficulty }──▶ 部屋（Room DO）──▶ Claude（2 段で合計 10 秒まで、やり直さない）
                                   │ room { phase: "generating" } を全員へ
                                   │ 作れた: 配置の JSON を ctx.storage に置く
                                   │ だめ: 同じ難易度の作り置きから選ぶ
                                   ▼
                          round { sceneId } を全員へ ──▶ 各アプリが GET /scenes/{sceneId}/layout?room=<部屋の番号>
```

- 作るのは、`SCENE_GENERATION` が `on` で、その部屋の生成が 20 回に満たないとき。それ以外は今までどおり作り置きから選ぶ。
- 部屋の状態は `lobby` → `generating` → `playing`。`generating` のあいだ、ホストはもう一度 `start` を送れない。
- 10 秒で間に合わない・通信の失敗・断られた・形が違う・裏取りで落ちたときは、黙って作り置きに切り替える（2026-11-11 に 2 段の生成につないだ。Claude を 2 回呼ぶ合計で 10 秒まで。作り直さない）。
- 生成中にホストが `leave` したら、生成を止めて作り置きでラウンドを始める。切断しただけなら止めない。
- 作った場面の ID は今までどおり `gen-` ＋ 10 文字。配置の JSON は部屋の `ctx.storage` に置き、部屋が消えるときに一緒に消える。R2 には置かない。採点も部屋に置いたものを使う。
- `GET /scenes/{sceneId}/layout` は、作り置きにない ID のとき、`room` で渡された部屋に置いた配置の JSON を返す。
- 待つあいだのアプリの画面は [`ui/screens/lobby.md`](./ui/screens/lobby.md)。

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
- 作り置きの場面の ID の付け方（生成の口が `gen-` ＋ 10 文字を付ける）は案。作り始めるときに決める（置き場所は `backend/src/scenes/pool/` に決めた）。
- 難易度の中身（上の表）は推測。作り置きの最初の 30 場面を目で確かめ、実際に遊んでから直す。
- 作った条件（テーマ・モデル・日時）をどこに残すか（commit のメッセージで足りるか、場面の一覧のファイルを置くか）。
- `start` で難易度を送る形（メッセージの項目名、まだ出ていない場面を部屋のどこで覚えるか）は、アプリと部屋を入れ替えるときに決める。
- 新しい採点で使わない `points`・`partial`・`extraMax` を、プロトコルから外すか（外すなら `scenenglish.scene/2` に上げる）。
- 端末のキャッシュの持ち方と容量。
