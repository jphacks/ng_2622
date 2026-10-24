# 3D の部品

シーンを組み立てるための、作り置きの部品（プロトコル v1）。仕様は `docs/design/scene-protocol.md` の「部品」と「最初に作る部品（34 個）」（PR #42）。そのあと、場面の文の調べ（`docs/design/research/scene-sentence-coverage.md`）で「足すと効く」とされた物 14 個と人物 15 体を足して、いまは 63 個。

![部品の一覧](./contact_sheet.png)

## ファイル

| パス | 中身 |
| --- | --- |
| `<id>/1.usdz` | 部品の 3D モデル（どれも約 0.2 MB 以下） |
| `<id>/1.json` | メタデータ（`id`・`version`・`file`・`category`・`words`・`pose`・`size`・`label`、一部の部品は `anchors`） |
| `index.json` | 全部品のメタデータの配列 |
| `contact_sheet.png` | 確かめの画像。USDZ を読み直して、正面（+Z）を少し右上から見たもの |

どのファイルも `scripts/scene/parts.py` が生成する。手で編集しない（`size` も作った形の外接箱から、`anchors` も形を作るときの寸法から計算している）。

## 座標と大きさ

- Y が上、単位はメートルで、実物の大きさ。正面は +Z。
- 原点は外接箱の底面の中心。y = 0 に置けば地面に立つ。
- 色は部品に焼き込んである。人や車のライト、自動販売機の窓、スマートフォンの画面は自己発光（emissive）。
- 地面の部品（`grass_patch`・`road_patch`）は薄い板で、上面はほぼ y = 0（芝の板は 2 mm、まだらの上面 2.5 mm。道路の板は 3 mm、白線の上面 3.5 mm）。上に置く物は y = 0 のままでよい（スマートフォンや本も 3 mm ほどしか埋まらない）。`grass_patch` の高さ 0.124 m は草むらの分。
- `road_patch` を `grass_patch` に重ねて置くときも y = 0 のままでよい。道路の上面が芝の板とまだらより上にあるので、ちらつかない。
- 子ども（`boy`・`girl`）は大人の 0.75 倍。持たせた物（段ボール箱など）も同じ倍率。
- 壁に付ける物（`window`・`clock`）も原点は底面の中心。壁に掛けるときは y を上げる（例: 窓は 0.9 m、時計は 1.8 m）。`window` は枠の厚さ 0.14 m で、`wall`（厚さ 0.1 m）と同じ位置に重ねると壁の両面に 2 cm ずつ出る。ガラスは壁に隠れないよう、壁の両面の外に 1 枚ずつある。
- `door` の原点は枠の底面の中心（ちょうつがいの側ではない）。扉は開かない。
- `bed` は長い向きを左右（X）に置き、頭の側は -X。長い辺が正面（+Z）で、その縁に座る。

### 座るポーズと椅子

座るポーズ（`person_sit_*`）は人だけで、椅子を含まない。座面の高さ 0.46〜0.48 m（`chair`・`sofa` は 0.46 m、`bench` は 0.48 m）に合う。

外接箱の中心を原点にしているので、座る人の腰は原点より奥（-Z）にある。椅子やベンチに座らせるには、人を椅子と同じ向きにして、人の `anchors.hip` が椅子の `anchors.seat` に重なるように置く（人の位置 = 椅子の位置 + `seat` − `hip`）。

### 置き方の手がかり（`anchors`）

座らせる・上に置く座標を計算するための点。座標は部品の中の座標（原点は外接箱の底面の中心、正面は +Z、m）。

| 部品 | `anchors` | 意味 |
| --- | --- | --- |
| `table` | `top`: 0.72 | 天板の上面の高さ |
| `box` | `top`: 0.35 | ふたの上面の高さ（テープの厚みは含めない） |
| `chair` | `seat`: [0, 0.46, 0] | クッションの上面の中心 |
| `bench` | `seat`: [0, 0.482, 0.08] | 座面の板の上面の真ん中 |
| `sofa` | `seat`: [0, 0.46, 0.1] | 2 つの座面のクッションの真ん中の上面 |
| `person_sit_adult_a` | `hip`: [0, 0.48, -0.2] | 腰の点（座面に重ねる点） |
| `person_sit_woman_a` | `hip`: [0, 0.48, -0.175] | 腰の点（座面に重ねる点） |
| `checkout_counter` | `top`: 0.9 | 天板の上面（レジは +X 側にあるので、物はそれ以外に置く） |
| `shelf` | `top`: 1.8 | いちばん上の板（天板）の上面。中の段の板の上面は下から 0.11・0.53・0.96・1.38 m |
| `plate` | `top`: 0.01 | くぼみの底の面 |
| `seat` | `seat`: [0, 0.46, 0.082] | 2 つの座面のクッションの真ん中の上面 |
| `bed` | `top`: 0.49、`seat`: [0.2, 0.49, 0.296] | 掛け布団の上面と、正面の縁から 0.2 m の座る点 |
| `person_sit_girl_a`・`person_write_girl_a` | `hip`: [0, 0.36, -0.131] | 腰の点（子ども） |
| `person_sit_boy_a`・`person_write_boy_a` | `hip`: [0, 0.36, -0.15] | 腰の点（子ども） |

`hip` の高さ 0.48 m はベンチの座面に合わせてあるので、`chair`・`sofa`・`seat`（0.46 m）に座らせると足が 2 cm 床に入る。子どもの `hip` は 0.36 m なので、どの家具に座らせても足は床から 10 cm ほど浮く。`person_write_*` の `hip` は書く人の座る点（`x` が 1 mm ずれているのは、手の位置が左右で違って外接箱の中心がずれるため）。

### 持たせた物

`person_read_adult_a` は開いた本、`person_eat_adult_a` はリンゴ、`person_carry_adult_a` は段ボール箱を持っている。持たせた物は同じ部品に含める。`person_phone_adult_a` は、胸の前に持ったスマートフォンを見ているポーズ（耳に当てて話すポーズではない）。`person_drink_*` は青いマグカップ、`person_write_*` はペンを持っている（机は含めない。手とペン先は机の高さ 0.72 m に合わせてあり、子どもは 0.75 倍で 0.54 m）。

### ポーズと見た目の組み合わせ

人物は `parts.py` の「ポーズの表」（`POSES`）と「見た目の表」（`LOOKS`。`adult_a`＝男の人・`woman_a`・`boy_a`・`girl_a`）の組み合わせから作る。作る組み合わせは `PEOPLE` に並べる（足せば部品が増える）。`common.py` の `person()` は手の位置しか変えられないので、`hold`（胸の前で両手を寄せる。持つ物は付けない）・`put`（両手を前の下へ伸ばす。体は曲げない）・`look`（右手をひさしにする。頭は向きを変えない）は手の位置だけで表している。

## 部品の一覧

大きさは `size`（幅 × 高さ × 奥行き、m）。`adult_a` は男の人。

| id | 名前 | カテゴリ | ポーズ | 語 | 大きさ（m） | 作り方 |
| --- | --- | --- | --- | --- | --- | --- |
| `tree` | 木 | plant |  | tree | 2.532 × 3.569 × 2.387 | 今のシーンから流用 |
| `flower` | 花 | plant |  | flower | 0.327 × 0.368 × 0.357 | 今のシーンから切り出し |
| `grass_patch` | 芝生（8 m 四方の地面） | ground |  | grass | 8 × 0.124 × 8 | 今のシーンから切り出し |
| `road_patch` | 道路（横断歩道つき） | ground |  | road, street, crosswalk | 8 × 0.004 × 5.5 | 今のシーンから切り出し |
| `bench` | ベンチ | furniture |  | bench | 1.6 × 0.937 × 0.596 | 今のシーンから流用 |
| `table` | テーブル | furniture |  | table | 1.2 × 0.72 × 0.75 | 新規 |
| `chair` | 椅子 | furniture |  | chair | 0.42 × 0.935 × 0.42 | 新規 |
| `sofa` | ソファ | furniture |  | sofa, couch | 1.8 × 0.85 × 0.88 | 新規 |
| `bicycle` | 自転車 | vehicle |  | bicycle, bike | 0.5 × 0.99 × 1.66 | 今のシーンから流用 |
| `car` | 車 | vehicle |  | car | 1.925 × 1.493 × 3.998 | 今のシーンから切り出し |
| `vending_machine` | 自動販売機 | thing |  | vending machine | 0.9 × 1.8 × 0.76 | 今のシーンから流用 |
| `trash_bin` | ごみ箱 | thing |  | trash can, trash bin | 0.42 × 0.467 × 0.42 | 今のシーンから切り出し |
| `ball_red` | 赤いボール | thing |  | ball | 0.24 × 0.24 × 0.24 | 今のシーンから流用 |
| `umbrella` | 傘（開いた） | thing |  | umbrella | 1.128 × 0.972 × 1.132 | 今のシーンから流用 |
| `smartphone` | スマートフォン | thing |  | smartphone, phone | 0.075 × 0.01 × 0.155 | 今のシーンから切り出し |
| `box` | 段ボール箱 | thing |  | box | 0.45 × 0.353 × 0.356 | 新規 |
| `apple_red` | 赤いリンゴ | food |  | apple | 0.079 × 0.089 × 0.079 | 新規 |
| `bag` | かばん（トートバッグ） | thing |  | bag | 0.38 × 0.409 × 0.135 | 新規 |
| `book` | 本 | thing |  | book | 0.15 × 0.03 × 0.211 | 新規 |
| `bottle` | ペットボトル | thing |  | bottle | 0.072 × 0.21 × 0.072 | 新規 |
| `cup` | コーヒーカップ | thing |  | cup, coffee | 0.141 × 0.087 × 0.14 | 新規 |
| `door` | 扉（ドア） | building |  | door | 0.94 × 2.07 × 0.148 | 新規 |
| `wall` | 壁（長さ 4 m） | building |  | wall | 4 × 2.4 × 0.1 | 新規 |
| `window` | 窓 | building |  | window | 1.28 × 1 × 0.24 | 新規 |
| `checkout_counter` | レジのカウンター | furniture |  | checkout counter, cash register, counter | 1.5 × 1.199 × 0.65 | 新規（レジはカフェのレジを流用） |
| `shelf` | 棚（商品棚・本棚） | furniture |  | shelf, bookshelf | 1.2 × 1.8 × 0.4 | 新規 |
| `basket` | 買い物かご | thing |  | basket, shopping basket | 0.497 × 0.369 × 0.347 | 新規 |
| `plate` | 皿 | thing |  | plate, dish | 0.24 × 0.025 × 0.24 | 新規 |
| `shirt` | シャツ（たたんだ） | thing |  | shirt | 0.26 × 0.058 × 0.32 | 新規 |
| `seat` | 座席（バス・電車、2 人がけ） | furniture |  | seat | 0.9 × 1.142 × 0.603 | 新規 |
| `laptop` | ノートパソコン（開いた） | thing |  | laptop, computer | 0.32 × 0.219 × 0.272 | 新規 |
| `clock` | 時計（壁掛け） | thing |  | clock | 0.34 × 0.34 × 0.061 | 今のシーンから流用（教室の時計を半分に） |
| `cart` | ショッピングカート | thing |  | cart, shopping cart | 0.58 × 1.02 × 0.898 | 新規 |
| `pan` | フライパン | thing |  | pan, frying pan | 0.472 × 0.082 × 0.26 | 新規 |
| `bed` | ベッド（1 人用） | furniture |  | bed | 2 × 0.9 × 1.037 | 新規 |
| `animal_run_dog_a` | 走る犬 | animal | run | dog, run | 0.397 × 0.861 × 1.201 | 今のシーンから切り出し |
| `person_stand_adult_a` | 男の人（立つ） | person | stand | man, stand | 0.631 × 1.695 × 0.38 | 今のシーンから流用 |
| `person_walk_adult_a` | 男の人（歩く） | person | walk | man, walk | 0.611 × 1.695 × 0.606 | 今のシーンから流用 |
| `person_run_adult_a` | 男の人（走る） | person | run | man, run | 0.568 × 1.675 × 0.836 | 今のシーンから流用 |
| `person_sit_adult_a` | 男の人（座る） | person | sit | man, sit | 0.564 × 1.375 × 0.78 | 今のシーンから流用 |
| `person_phone_adult_a` | 男の人（スマホを見る） | person | phone | man, phone, look | 0.551 × 1.695 × 0.514 | 今のシーンから流用 |
| `person_walk_woman_a` | 女の人（歩く） | person | walk | woman, walk | 0.611 × 1.695 × 0.606 | 見た目違い |
| `person_sit_woman_a` | 女の人（座る） | person | sit | woman, sit | 0.564 × 1.375 × 0.83 | 見た目違い |
| `person_run_boy_a` | 男の子（走る） | person | run | boy, run | 0.426 × 1.256 × 0.627 | 見た目違い |
| `person_stand_girl_a` | 女の子（立つ） | person | stand | girl, stand | 0.473 × 1.305 × 0.36 | 見た目違い |
| `person_read_adult_a` | 男の人（本を読む） | person | read | man, read, book | 0.562 × 1.695 × 0.618 | 新規 |
| `person_eat_adult_a` | 男の人（リンゴを食べる） | person | eat | man, eat, apple | 0.587 × 1.695 × 0.475 | 新規 |
| `person_carry_adult_a` | 男の人（箱を運ぶ） | person | carry | man, carry, box | 0.571 × 1.695 × 0.819 | 新規 |
| `person_hold_woman_a` | 女の人（両手で持つ） | person | hold | woman, hold | 0.555 × 1.695 × 0.588 | 新規（ポーズ） |
| `person_hold_girl_a` | 女の子（両手で持つ） | person | hold | girl, hold | 0.416 × 1.305 × 0.441 | 新規（ポーズ） |
| `person_put_adult_a` | 男の人（物を置く） | person | put | man, put | 0.563 × 1.695 × 0.658 | 新規（ポーズ） |
| `person_put_woman_a` | 女の人（物を置く） | person | put | woman, put | 0.563 × 1.695 × 0.708 | 新規（ポーズ） |
| `person_put_boy_a` | 男の子（物を置く） | person | put | boy, put | 0.422 × 1.271 × 0.493 | 新規（ポーズ） |
| `person_drink_woman_a` | 女の人（飲む） | person | drink | woman, drink, cup | 0.587 × 1.695 × 0.51 | 新規（ポーズ） |
| `person_drink_adult_a` | 男の人（飲む） | person | drink | man, drink, cup | 0.587 × 1.695 × 0.46 | 新規（ポーズ） |
| `person_write_boy_a` | 男の子（座って書く） | person | write | boy, write, pen | 0.42 × 1.031 × 0.585 | 新規（ポーズ） |
| `person_write_girl_a` | 女の子（座って書く） | person | write | girl, write, pen | 0.42 × 1.065 × 0.623 | 新規（ポーズ） |
| `person_look_girl_a` | 女の子（手をかざして見る） | person | look | girl, look | 0.444 × 1.305 × 0.366 | 新規（ポーズ） |
| `person_carry_boy_a` | 男の子（箱を運ぶ） | person | carry | boy, carry, box | 0.428 × 1.271 × 0.614 | 見た目違い |
| `person_carry_woman_a` | 女の人（箱を運ぶ） | person | carry | woman, carry, box | 0.571 × 1.695 × 0.819 | 見た目違い |
| `person_carry_girl_a` | 女の子（箱を運ぶ） | person | carry | girl, carry, box | 0.428 × 1.305 × 0.614 | 見た目違い |
| `person_sit_girl_a` | 女の子（座る） | person | sit | girl, sit | 0.423 × 1.065 × 0.623 | 見た目違い |
| `person_sit_boy_a` | 男の子（座る） | person | sit | boy, sit | 0.423 × 1.031 × 0.585 | 見た目違い |

## 作り直す・確かめる

形や色を変えるときは `scripts/scene/parts.py` を編集して、Blender で実行する（63 個で 10 秒ほど）。
作り直すと USDZ のバイト列は毎回少し変わる（形は同じ）。同じ版（`1`）の中身は変えない約束なので、配ったあとに形を変えるときは `VERSION` を上げる。

```sh
blender --background --factory-startup --python scripts/scene/parts.py                            # 全部品と index.json
blender --background --factory-startup --python scripts/scene/parts.py -- --only car --only tree  # 一部だけ（index.json も作り直す）
blender --background --factory-startup --python scripts/scene/parts.py -- --meta-only            # USDZ は書かず、JSON だけ作り直す
blender --background --factory-startup --python scripts/scene/check_parts.py                      # プロトコルに合っているかを確かめる
blender --background --factory-startup --python scripts/scene/check_parts.py -- --sheet           # 確かめて、contact_sheet.png も作る
python3 scripts/scene/preview_parts.py                                                            # 部品を 3D で回して見る HTML（下記）
```

`check_parts.py` は USDZ を読み直し、次を確かめる（1 つでも合わなければ終了コード 1）。

- メタデータの形（`id` の文字、`version`・`file`・`category`・`words`・`pose`・`label`）、`index.json` と各部品の JSON が同じこと、`EXPECTED` の 63 個がそろっていること
- 2 MB 以下、Y が上でメートル
- 外接箱の最小 y が 0、x と z の中心が 0（2 mm まで）。外接箱の大きさが JSON の `size` と合う（2 mm まで）
- 正面の目印が +Z 側にある（人は目が髪より前、犬は鼻と目、車はヘッドライト、自転車は前かご、自動販売機は商品の窓、窓は窓台、レジは客の側の緑の帯、シャツはえり、ノートパソコンはタッチパッド）。ベンチ・椅子・ソファ・座席は背もたれ、棚は背板、カートは取っ手が -Z 側。左右対称の物は確かめない
- `anchors` が付けるはずの部品にあり、外接箱の内側にある。座る人の `hip` を椅子・ベンチ・ソファの `seat` に合わせて置くと、脚が家具の前に出て、足が床に 3 cm より深く入らず、背中が背もたれの後ろへ抜けない（外接箱で見る）

### プレビュー（`preview_parts.py`）

`python3 scripts/scene/preview_parts.py` で、63 部品を 1 個ずつ 3D で回して見られる `assets/parts/build/preview.html`（約 14 MB、commit しない）を作る。three.js（版を固定）・各部品の GLB（Blender で USDZ から書き出す）・USDZ・一覧の画像を HTML に埋め込むので、ネットにつながなくても開ける。three.js と esbuild は初回に npm で `assets/parts/build/vendor/` に取る（`--cache` で場所を変えられる）。

- 3D の表示の中: ドラッグで回す、ピンチ（ホイール）で拡大。橙は `top`、緑は `seat`、桃色は `hip` の点。床のマスは 1 m か 10 cm
- 切り替え: 情報の枠かいちばん上の帯を左右にスワイプ、‹ › のボタン、キーボードの ← →。「一覧」から選んで飛べる
- iPhone の Safari では「AR で見る」から AR Quick Look で開ける（埋め込んだ USDZ を Blob URL で渡す。実機ではまだ確かめていない）

Blender は 4.5 LTS と 4.0 で動く。4.0 は USD の書き出しに向きの変換が無いので、`common.py` の `export_usdz` が pxr で Y を上に直す（4.5 と同じ結果になる）。
