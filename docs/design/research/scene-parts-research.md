# 英語描写ゲーム用「作り置く 3D 部品」優先順位調査

> deep research の結果（2026-10-24、@TEIKOTA が実行）。本文はほぼそのまま残し、引用の印（citeturn…）だけを外した。
> 調べた環境の中にあった CSV と Excel（部品の候補 195 行・場面のテンプレート 18 行・位置関係 28 行）は、まだこの repo に入っていない。手に入ったら同じディレクトリに置く。
> この結果から決めたことは [`../scene-protocol.md`](../scene-protocol.md) の「最初に作る部品」。

## 要約

結論から言うと、**最初の 30 部品は「物の種類を増やす」よりも、少数の基本物体＋人物ポーズ＋位置関係を作れる基準物体に集中するのが有利**です。今回の評価では、頻度・学習段階、公式の写真／イラスト描写課題への出現、絵にしやすさ、場面間の再利用性、ローポリでの制作容易性、動詞・前置詞を引き出す力を、依頼の重みに沿って合計 70 点満点で評価しました。

語彙面では、NGSL 1.2 は 2023 年 4 月公開の 2,809 語で、一般英語の平均 92% 以上をカバーする L2 学習者向けリストです。Oxford 3000 は頻度と学習者への有用性を基に選ばれ、全語が CEFR A1–B2 に対応付けされています。CEFR-J については、行単位で再現可能な Version 1.5 を主に使用しました。

日本の中学校学習指導要領は、特定の「必修単語一覧」を公式に固定する方式ではなく、中学校で扱う新語の規模を **1,600～1,800 語程度**として示し、小学校段階からの語彙を積み上げる設計です。また解説には `in front of` のような基本句も例示されています。したがって個別語の日本向け根拠には、MEXT の語数基準より **CEFR-J と英検の公式課題**を強く使いました。

写真描写については、単なる一般頻度よりも「人＋物＋動作＋位置関係」の組を重視すべきです。英検 3 級公式サンプルには `read a newspaper`、`two cups on the table` があり、準 2 級公式サンプルには「箱をトラックに積む」「花を植える」「犬を散歩させる」「壁を塗る」「自転車に乗る」「自販機の前の自転車」が直接現れます。TOEIC の公式サンプルにも `sitting at a table`、土をシャベルですくう場面、屋外の売り台・人物・商品などがあり、Cambridge B1 Preliminary の公式教材では台所での料理と居間でテレビを見る写真が使われています。

**Tier 1 は 21 個の名詞部品＋9 個の人物・動物ポーズ部品＝30 個**としました。既にある `tree`、`bench`、`ball`、`bicycle`、`umbrella`、`vending_machine`、および `stand / walk / run / sit / phone` は作り直す必要はなく、サイズ・原点・向き・接地面などを共通規格化して再利用する想定です。

Tier 1 の 30 部品は次です。

> **物体・背景 21**
> `table, chair, box, apple_red, bag, book, road_patch, ball_red, bottle, cup, bicycle, tree, car, flower, grass_patch, trash_bin, umbrella, smartphone, bench, sofa, vending_machine`
>
> **人物・動物ポーズ 9**
> `person_sit_adult_a, person_walk_adult_a, person_read_adult_a, person_stand_adult_a, person_run_adult_a, person_carry_adult_a, person_eat_adult_a, person_phone_adult_a, animal_run_dog_a`

この 30 部品だけを核に、少なくとも **公園で犬がボールを追う／公園で読書／道路横断／教室で読書／カフェで軽食／リビングで電話／自販機前の自転車／庭で箱を運ぶ／木からりんごが落ちる**の 9 場面を意味的に明確に構成できます。さらに、既存の「雨のバス停」背景を使えば **雨のバス停**を加えて 10 場面です。バス停背景なしに Tier 1 だけで構成すると、最後のものは厳密には「雨の道路脇のベンチ」としか断定できないため、この一点は区別しています。

完全な成果物は以下です。数を再検算した結果、**名詞 150、動詞・ポーズ 45、合計 195、Tier 1 = 30、Tier 2 = 70、Tier 3 = 95、場面 = 18、位置関係・構文 = 28**です（CSV と Excel。まだ repo に無い）。

- 3D 部品候補 CSV：名詞 150・動詞／ポーズ 45（`3d_parts_candidates_150nouns_45verbs.csv`）
- 場面テンプレート CSV：18 場面（`scene_templates_18.csv`）
- 位置関係・言い回し CSV：28 項目（`spatial_language_28.csv`）
- 統合 Excel：全表入り（`english_description_3d_parts_research_tables.xlsx`）

重要な不確実性が三つあります。第一に、NGSL 公式サイトは「basic statistics」に順位が含まれることを明記していますが、この調査環境では CSV 本体を取得できませんでした。したがって **`freq_rank` は推測せず空欄**にしています。第二に、英検協会が公開する「級別の公式頻出単語ランキング」は確認できず、民間の「英検頻出語」サイトは数値根拠から除外しました。第三に、公式試験サンプルは「その物・動作が実際に公式問題に出た」証拠にはなりますが、母集団全体での出題頻度を推定できるほど大量ではありません。このため `exam_evidence` は、厳密には「頻出率」ではなく **公式課題での直接出現＋写真描写課題としての適合度**です。

## 調査方法と評価設計

### 語彙リストの扱い

今回の優先順位は、単一リストをそのまま順位表にするのではなく、用途の異なる資料を重ねています。

| 資料 | 使用版 | 今回の使い方 | 注意 |
|---|---|---|---|
| NGSL | 1.2、2023 | 一般英語・日常英語としての基盤 | 正確な個別順位は取得できなかったため空欄 |
| Oxford 3000 | 現行 CEFR 版 | A1–B1 の学習段階確認 | 対象層に最も使いやすい英語圏側の基準 |
| Oxford 5000 | 現行 | 主に B2–C1 のため補助 | 今回は優先度低 |
| English Vocabulary Profile | 現行 | 語義・CEFR のクロスチェック | インタラクティブ DB のため一括行抽出はしていない |
| CEFR-J Wordlist | v1.5 | 日本人学習者向けレベル確認 | 再現可能な CSV を採用 |
| CEFR-J | v1.6 | より新しい版の存在確認 | v1.5 との差分は今回未照合 |
| MEXT 中学校学習指導要領解説 | 平成29年告示、2021年度全面実施 | 日本の学校段階・語彙規模 | 個別の必修語リストではない |
| 英検 | 現行公式サンプル | 日本人向け写真／イラスト描写の直接証拠 | 公式頻出語ランキングは不明 |

NGSL 1.2 は一般英語の日常語を狙った 2,809 語のリストで、公式サイト自身が「frequency rankings を含む統計版」を配布しています。Oxford 3000 は 20 億語超の Oxford English Corpus の頻度と学習者向けコーパスでの関連性を基にしており、A1–B2 に割り当てられています。CEFR-J v1.5 は東京外国語大学投野研究室のデータで、研究・商用利用が可能と明示され、各語に CEFR-J レベルが付与されています。

たとえば Tier 1 の `apple, ball, book, bottle, box, car, chair, table, tree, walk, run, read, eat, carry` などは、Oxford 3000 または CEFR-J で A1 を直接確認できるものです。一方、`vending machine` のような複合語は基礎語彙リストだけでは低く見積もられますが、日本の生活環境と英検公式問題との相性が非常に高いため、場面生成上は引き上げています。英検準 2 級公式サンプルでは、実際に自動販売機の前に自転車が置かれた状況が使われています。

### 写真描写試験から分かること

TOEIC Speaking では写真描写問題が独立した問題形式になっており、現在の ETS 形式では写真を準備後に短時間で口頭描写します。TOEIC Listening Part 1 も写真に対して最も適切な描写を選ぶ形式です。公式サンプルを見ると、重要なのは珍しい名詞よりも **人物の姿勢・現在の動作・物体同士の位置関係**です。たとえば `sit at a table` や `shovel soil` のように、「人＋動詞＋場所／物」が一枚で読み取れる構成になっています。

Cambridge B1 Preliminary の公式 Speaking Part 2 教材では、写真描写を広げる観点として **Place / People / Activity / Objects / Colours / Atmosphere / Time of day / Weather** が明示されています。このことからも、部品ライブラリは「物を 100 種類覚えさせる」より、`person + action + object + relation` を組み替えられる方がゲーム用途に合っています。

### スコア

依頼の重みをそのまま採用し、各要素を 1～5 としました。

| 観点 | 重み | 最大点 | 判定の中心 |
|---|---:|---:|---|
| 頻度・学習段階 | 3 | 15 | Oxford / CEFR-J / NGSL、日本向け根拠 |
| 描写試験への適合 | 2 | 10 | 英検・TOEIC・Cambridge 公式課題 |
| 絵にしやすさ | 3 | 15 | concreteness + 3D での識別性 |
| 場面の使い回し | 2 | 10 | 何テンプレートに再利用できるか |
| 作りやすさ | 2 | 10 | 指定された難易度 1–3 |
| 動詞・関係を引き出す | 2 | 10 | 動作・前置詞を自然に誘発するか |
| **合計** | **14** | **70** | |

したがって `score` の理論上の最大値は **70 点**です。CSV の最大値も 70 であることを再計算しています。

ただし、Tier は score の単純降順ではありません。**「Tier 1 の 30 個だけで 8～10 場面を成立させる」という set-cover 的制約**を score より優先して最後に調整しています。このため、例えば Tier 2 の `door` が Tier 1 の `bench` より生スコアが高い場合があります。`bench` は公園・読書・雨天場面を横断して配置関係と `sit on` を作れるため Tier 1 に残しています。

また、exact NGSL rank が取得できなかった語については順位を作りませんでした。スコア上も、確認済み A1 は高評価、未確認語は中立値として扱っており、**「空欄＝難しい語」ではありません**。この点から score は心理測定値ではなく、制作順を決めるための設計指標と考えるべきです。

## 優先部品と動詞ポーズ

### Tier 1 の 30 部品

以下が実装上の第一候補です。「既存」は依頼文で既に存在するとされたもの、人物ポーズについても依頼文の既存一覧を基準にしています。

| 優先 | `part_id` | 語 | 種類 | score /70 | 制作難度 | 実装判断 |
|---:|---|---|---|---:|---:|---|
| 1 | `table` | table | noun | 70 | 1 | 新規。`on/under/at` の基準物 |
| 2 | `chair` | chair | noun | 68 | 1 | 新規。sit / under / next to |
| 3 | `box` | box | noun | 66 | 1 | 新規。in/on/carry/put |
| 4 | `person_sit_adult_a` | sit | verb | 66 | 1 | **既存 pose** |
| 5 | `person_walk_adult_a` | walk | verb | 66 | 1 | **既存 pose**＋move |
| 6 | `apple_red` | apple | noun | 64 | 1 | 新規。eat/fall/in/on |
| 7 | `bag` | bag | noun | 64 | 1 | 新規。carry/under/beside |
| 8 | `book` | book | noun | 64 | 1 | 新規。read/on/hold |
| 9 | `road_patch` | road | noun | 64 | 1 | 新規。across/on/past |
| 10 | `ball_red` | ball | noun | 62 | 1 | **既存形状を規格化** |
| 11 | `person_read_adult_a` | read | verb | 62 | 2 | **新規 pose** |
| 12 | `person_stand_adult_a` | stand | verb | 62 | 1 | **既存 pose** |
| 13 | `bottle` | bottle | noun | 60 | 1 | 新規。hold/on/in |
| 14 | `cup` | cup | noun | 60 | 1 | 新規。drink/on/in |
| 15 | `person_run_adult_a` | run | verb | 60 | 1 | **既存 pose**＋move |
| 16 | `bicycle` | bicycle | noun | 59 | 2 | **既存を流用** |
| 17 | `tree` | tree | noun | 59 | 2 | **既存を流用** |
| 18 | `person_carry_adult_a` | carry | verb | 58 | 2 | **新規 pose**＋move |
| 19 | `car` | car | noun | 57 | 2 | 新規。既存 taxi 形状から共通化可 |
| 20 | `flower` | flower | noun | 57 | 2 | 新規。複数形を誘発 |
| 21 | `grass_patch` | grass | noun | 56 | 1 | 新規 ground |
| 22 | `person_eat_adult_a` | eat | verb | 56 | 2 | **新規 pose** |
| 23 | `person_phone_adult_a` | phone | verb | 54 | 1 | **既存 pose** |
| 24 | `trash_bin` | trash bin | noun | 54 | 1 | 新規。`in/next to` |
| 25 | `umbrella` | umbrella | noun | 53 | 2 | **既存を流用** |
| 26 | `smartphone` | phone | noun | 52 | 1 | 新規。視認性は誇張必要 |
| 27 | `animal_run_dog_a` | run | verb | 50 | 3 | 既存 dog を走行姿勢化 |
| 28 | `bench` | bench | noun | 49 | 2 | **既存を流用** |
| 29 | `sofa` | sofa | noun | 49 | 2 | 新規。living room の核 |
| 30 | `vending_machine` | vending machine | noun | 49 | 2 | **既存を流用** |

`table`、`chair`、`box` が高いのは単語頻度だけが理由ではありません。一つの単純形状から `on / under / next to / in / at` と、`sit / put / carry / eat / read / write` の多くを引き出せるからです。これは本ゲームでは「単語一個の価値」より「組合せの枝数」が重要だということです。

特に `ball` は優秀です。球という極めて安価なモデルで `kick / throw / catch / chase / run toward / under / between / near / fall / move` を引き出せます。逆に `clock` のように非常に作りやすい物でも、置くだけでは動詞が少なく、初期投資効率はやや下がります。

Brysbaert らの concreteness データでも、Tier 1 の代表物は極めて具体的です。`apple 5.00`, `ball 5.00`, `tree 5.00`, `cup 5.00`, `book 4.90`, `box 4.90`, `bicycle 4.89`, `car 4.89`, `bench 4.87` などです。これは imageability と同じ尺度ではありませんが、「静止した絵から対象語を引き出せるか」の有力な補助指標になります。Glasgow Norms は imageability と concreteness を別々の尺度として扱っており、両者を同一視すべきでないことにも注意が必要です。

### 次に作る Tier 2

Tier 2 は 70 個です。生スコア上位には `door, television, wall, clock, egg, newspaper, banana, bread, carrot, cheese, person_cook_adult_a, sandwich, water_patch, animal_walk_dog_a, window` などが来ます。

ここで特に早く追加する価値があるのは、**台所セット**の `stove, pan, sink, kitchen_counter, egg, person_cook_adult_a, person_wash_adult_a`、**道路セット**の `crosswalk, sidewalk, traffic_light`、**店セット**の `shelf, basket, shopping_cart`、**学校セット**の `blackboard, notebook, pencil` です。これらは数個まとめて入れると新しい場面が一気に解禁されます。

### 動詞をどう 3D にするか

現在進行形で言いやすく、かつ今回の制約で視覚化しやすい動詞を先にするべきです。英検・TOEIC・Cambridge の公式課題も、人が「今していること」を説明させる構造が多いです。

| 動詞 | pose | motion | 3D 表現 | 優先 |
|---|---|---|---|---|
| stand | `stand` 既存 | なし | 直立 | Tier 1 |
| walk | `walk` 既存 | `move` | 歩行姿勢＋直進 | Tier 1 |
| run | `run` 既存 | `move` | 前傾走行＋直進 | Tier 1 |
| sit | `sit` 既存 | なし | chair/bench に接地 | Tier 1 |
| read | `read` 新規 | なし | 開いた本を両手前 | Tier 1 |
| eat | `eat` 新規 | なし | 食物を口元 | Tier 1 |
| carry | `carry` 新規 | `move` | 箱等を腰～胸前 | Tier 1 |
| phone | `phone` 既存 | なし | phone を耳元 | Tier 1 |
| dog run / chase | `dog_run` 新規 | `move` | ball に向ける | Tier 1 |
| write | `write` 新規 | なし | notebook/board に手を寄せる | Tier 2 |
| drink | `drink` 新規 | なし | cup/bottle を口元 | Tier 2 |
| push | `push` 新規 | `move` | 両腕前＋cart | Tier 2 |
| pull | `pull` 新規 | `move` | suitcase を後方 | Tier 2 |
| ride | `ride_bicycle` 新規 | `move` | bicycle と座標規格化 | Tier 2 |
| cook | `cook` 新規 | なし | stove/pan とセット | Tier 2 |
| wash | `wash` 新規 | なし | sink＋対象物 | Tier 2 |
| open | `open` 新規 | door は `rotate` | 手＋扉角度 | Tier 2 |
| pick up | `pick_up` 新規 | なし | 腰を曲げ地面に手 | Tier 2 |
| put | `put` 新規 | なし | box と container の境界 | Tier 2 |
| throw | `throw` 新規 | ball は `move` 可 | 投球後姿勢＋球を離す | Tier 2 |
| catch | `catch` 新規 | なし | 両手前＋球近接 | Tier 2 |
| kick | `kick` 新規 | ball は `move` 可 | 片脚前＋球 | Tier 2 |
| jump | `jump` 新規 | なし | 人を地面から浮かせる | Tier 2 |
| fall | `fall` 新規 | `fall` | 横倒れ姿勢＋下方向 | Tier 2 |
| swim | `swim` 新規 | `move` | 水平姿勢＋水面 | Tier 2 |
| plant | `plant` 新規 | なし | kneel 流用＋flower/soil | Tier 2 |
| paint | `paint` 新規 | なし | wall＋roller | Tier 2 |
| wave | `wave` 新規 | `sway` は補助のみ | 挙手と手向きを変える | Tier 3 |
| dance | `dance` 新規 | `sway` | 専用シルエット＋小揺れ | Tier 3 |

`open` は今回の `rotate = Y 軸まわり` と非常に相性がよく、扉のヒンジ位置を原点にすれば表現可能です。一方 `wave` は手だけを骨で動かせないため、全身 `sway` だけでは「手を振る」とは認識しにくく、**専用ポーズを主情報、sway を補助情報**にするのが安全です。

`think, know, want, need, remember, believe, like` は基本的に除外すべきです。静止 3D から客観的に判別できません。`wait` も `stand` と見た目だけでは区別できず、「バス停＋時計＋立つ人」の文脈推論になります。`talk`、`look`、`watch`、`pay`、`buy` も完全には除外しませんが、静止画では別動詞との競合が大きいため Tier 1 にはしません。

45 ポーズすべてについて、`pose / motion / size_m / scenes / example_sentence` を部品候補 CSV に収録しています。

## 場面テンプレート

公式試験の傾向から、良い場面は「珍しい事件」ではなく、**一目で分かる日常場所に、動詞を一つ、位置関係を二つ程度、複数形や冠詞を一つ仕込む**構成です。Cambridge の公式指導も Place、People、Activity、Objects など複数の観点から写真を広げることを促しています。

作成した 18 テンプレートは次です。

| `scene_id` | 場面 | 難度 | 主な部品 | 狙い |
|---|---|---|---|---|
| `park_fetch` | 公園で犬がボールを追う | easy | dog-run, ball, grass, tree, bench | `is running toward`, `near`, `on` |
| `park_reading` | 公園のベンチで本を読む | easy | sit, bench, book, tree | `is sitting on`, `is reading`, `behind` |
| `street_crossing` | 道路を横切る人 | normal | walk, road, car, bicycle, bag | `is walking across`, `on`, `beside` |
| `bus_stop_rain` | 雨のバス停で待つ | normal | stand, umbrella, bench, bag, road | `under`, `next to`, `standing` |
| `classroom_reading` | 教室で本を読む | easy | sit, table, chair, book, bag | `at`, `under`, `is reading` |
| `cafe_snack` | カフェで軽食 | easy | eat, table, chair, apple, cup | `is eating`, `on`, `there are` |
| `home_living_room` | リビングで電話 | easy | phone-pose, sofa, table, book, cup | `on the phone`, `in front of` |
| `vending_blocked` | 自販機前を自転車がふさぐ | normal | vending machine, bicycles, stand | `in front of`, `there are` |
| `garden_carry` | 庭で箱を運ぶ | normal | carry, box, tree, flower, grass | `is carrying`, `toward`, `behind` |
| `apple_fall` | 木からりんごが落ちる | easy | tree, apple, stand, grass | `is falling from`, `above`, `under` |
| `kitchen_cooking` | 台所で料理 | normal | counter, stove, pan, egg, sink | `is cooking`, `on/in`, `there are` |
| `supermarket_shopping` | スーパーで買い物 | normal | shelf, basket, cart, fruit | `is pushing`, `in the basket`, `on the shelf` |
| `station_platform` | 駅のホーム | hard | train, platform, suitcase, clock | `on the platform`, `is pulling`, `next to` |
| `playground_play` | 遊び場でボール遊び | normal | swing, slide, fence, kick, ball | `is kicking`, `behind`, `on` |
| `hospital_waiting` | 病院の待合 | normal | sofa, chairs, magazine, clock | `is sitting`, `on`, `next to` |
| `beach_ball` | 海辺でボール遊び | normal | sand, water, ball, umbrella, swim | `is throwing`, `is swimming in` |
| `lost_item` | 落とし物を拾う | normal | wallet, chair, pick-up, stand | `is picking up`, `under`, `near` |
| `delivery_box` | トラックへ箱を積む | hard | truck, boxes, carry, put | `is putting ... in`, `is carrying` |

最初の 10 は Tier 1 中心です。厳密には `bus_stop_rain` の「バス停」という場所名だけは既存背景に依存します。それ以外の九つは Tier 1 の部品だけで内容を識別できます。

場面は「名詞の確認問題」にせず、同じ物体を位置だけ変えて文法を変えられるようにするのが重要です。例えば `box` は次のように同じモデルを使い回せます。

`There is a box **on** the table.`
`There is an apple **in** the box.`
`The box is **under** the table.`
`A person is **carrying** a box.`
`A person is **putting** a box **in** the truck.`

英検準 2 級公式サンプルに「箱をボトルごとトラックに積む」場面が実際にあり、こうした動作＋容器関係は日本人向け試験との適合も高いです。

各場面の `elements` は **6 要素 × 15 点 = 90 点**として作成し、全 18 行について合計が 90 になることを機械的に再検算しました。残る 10 点をアプリ側の pronunciation 等に割り当てる設計にも適合します。たとえば `park_fetch` は次の 90 点です。

| 要素 | 満点表現 | 部分点例 | 点 |
|---|---|---|---:|
| 犬の動作 | `A dog is running toward the ball.` | `A dog is running.` | 15 |
| ボール | `There is a red ball on the grass.` | `There is a ball.` | 15 |
| 木 | `There is a tree behind the dog.` | `There is a tree.` | 15 |
| ベンチ | `A bench is next to the tree.` | `There is a bench.` | 15 |
| 位置関係 | `The dog is near the ball.` | `The dog is by the ball.` | 15 |
| 全体 | `There are several things in the park.` | `It is a park.` | 15 |
| **計** | | | **90** |

重要なのは、満点文と完全一致しないと失点させないことです。たとえば `near / by / next to`、`sofa / couch`、`road / street` は視覚条件によって複数の正解があり得ます。LLM 採点では「意味要素」と「推奨表現」を分ける必要があります。

18 場面すべての部品配置、motion、target language、90 点 rubric は場面テンプレート CSV に入っています。

## 位置関係・言い回し

日本人学習者に対しては、位置関係を単なる追加要素ではなく主要なゲームメカニクスにする根拠があります。Mizumoto と Watari の Cambridge Learner Corpus を使った日本人 EFL 学習者分析では、**名詞、冠詞、前置詞**が重点的に扱うべきエラー群として特定されています。研究では、日本語に英語型の冠詞体系・名詞の可算性標示がないことも、記事・数の問題に関連付けて論じられています。

したがって「正しい文を教える」のではなく、**その文法を使わないと場面を正確に区別できない配置**にするのがこのゲームには適しています。

| target | 学習段階の目安 | 見せる部品 | 配置上のポイント |
|---|---|---|---|
| `on` | A1 | cup + table | 明確に接触させる |
| `in` | A1 | apple + box | 箱の壁を見せ、中に沈める |
| `under` | A1 | bag + chair | 真下に置き、単なる `near` を避ける |
| `next to` | A1 | chair + table | 横方向に近接 |
| `in front of` | A1–A2 | bicycle + vending machine | カメラ方向を固定 |
| `behind` | A1 | dog + fence | 一部遮蔽すると強い |
| `between` | A1 | ball + chair ×2 | 基準物は二つに限定 |
| `near` | A1 | bench + pond | `next to` より距離を取る |
| `above` | A1 | clock + door | 非接触の上下関係 |
| `below` | A1 | sign + clock | 同一縦軸に配置 |
| `over` | A1–A2 | kite + person | 上を通過／覆う関係を優先 |
| `across` | A1–A2 | walk + road | 道路に対して直角に `move` |
| `along` | A1–A2 | walk + sidewalk | 道路と平行に `move` |
| `past` | A2 | walk + tree | landmark を通り越す進路 |
| `toward` | A2–B1 | dog-run + ball | 身体向きと move ベクトルを一致 |
| `around` | A1 | cones ×3–4 + box | 中心物を囲む |
| `inside` | A1–A2 | object + open box/building | 壁を cutaway にしないと不可視 |
| `outside` | A1–A2 | person + cafe/house | 出入口を見せ境界を明確化 |
| `at` | A1 | person + bus stop/table | `in/on` より意味が広いので採点寛容に |
| `by / beside` | A1–A2 | lamp + sofa | 初級では `next to` と同義許容可 |
| `there is` | A1 | cup ×1 | countable singular を一個だけ |
| `there are` | A1 | flowers ×3 | 目で数えられる複数 |
| `a/an + singular` | A1 | apple ×1 | 一個だけを新情報として置く |
| `the + identifiable noun` | A1–A2 | 唯一の vending machine | referent を一意にする |
| plural `-s` | A1 | cups ×2 / apples ×3 | 一個一個が分離して見えること |
| `be + V-ing` | A1 | walk/read/eat pose | 動作途中のシルエットを使う |
| adjective + noun | A1–A2 | red ball / blue ball | 色が識別に必要な配置にする |
| coordinated actions | A2–B1 | reader + running dog | 二つの独立した動作を同時配置 |

`in front of` は MEXT の中学校解説でも基本的な句の例として扱われています。`across` や `along` のような語は、静止画だけより `move` を使った方が格段に判別しやすくなります。CEFR-J v1.5 でも `across` の前置詞用法は A2、`around` の前置詞用法は A1 といったレベル差があります。

特に実装価値が高いのは、以下の対立を同じ部品で作ることです。

- **`on` vs `in`**: 同じ apple と box/table を使い、「机の上」「箱の中」を変える。
- **`under` vs `next to`**: 同じ bag と chair で位置だけ変える。
- **`across` vs `along`**: 同じ walk pose と road を使い、移動ベクトルだけ 90°変える。
- **`there is` vs `there are`**: 同じ flower を 1 個／3 個にする。
- **`a` vs `the`**: 複数の同種物の中から一つを特徴付ける、または場面唯一の物を再参照する。

この方式なら、3D 部品を増やさなくても問題数を大幅に増やせます。また日本人学習者が間違えやすい冠詞・数・前置詞を、説明文による文法問題ではなく「目の前の違いを英語で区別する」タスクにできます。日本人学習者の冠詞・前置詞・名詞数の問題を重点対象とすることには learner-corpus 上の根拠があります。

一方、**現在進行形そのものについて、日本人学習者に特有の誤りが冠詞・名詞数・前置詞と同程度に強いという根拠は今回の調査では確認できませんでした**。ここは「日本人が特に苦手だから」ではなく、TOEIC・英検・Cambridge の写真描写形式と、3D の動作表現に極めて適しているため優先する、というのが正確です。

28 項目の完全版は位置関係・言い回し CSV に収録しています。

## 絵にしやすさ、実装上の注意、CC0 素材

### concreteness と picturability

Brysbaert, Warriner & Kuperman の 2014 年研究は、約 4 万の英語の語・表現について concreteness rating を提供しており、具体物の選定には非常に有用です。一方、Glasgow Norms は concreteness と imageability を別々に測定しています。したがって本表の `imageability` 列には、**Brysbaert の値を使った場合は必ず `concreteness` と明記**し、「imageability 値」と偽っていません。

今回直接照合できた代表値は次の通りです。

| 語 | Brysbaert concreteness |
|---|---:|
| apple | 5.00 |
| ball | 5.00 |
| cup | 5.00 |
| flower | 5.00 |
| tree | 5.00 |
| umbrella | 5.00 |
| bottle | 4.91 |
| book | 4.90 |
| box | 4.90 |
| sofa | 4.90 |
| table | 4.90 |
| bicycle | 4.89 |
| car | 4.89 |
| bench | 4.87 |
| road | 4.75 |
| chair | 4.58 |

原データの数値は二次的な raw-data mirror でも照合しました。数値のない行は推測で埋めず空欄です。

ただし、「concreteness が高ければゲームで一意に分かる」とは限りません。以下は採点側で同義語・近義語を許容すべきです。

| 3D の曖昧さ | 推奨 |
|---|---|
| `cup` / `mug` | 取っ手付きなら両方許容 |
| `road` / `street` | 視覚だけで厳密に区別しない |
| `sofa` / `couch` | 完全同義扱いでよい |
| `shop` / `store` | AmE/BrE を許容 |
| `trash can` / `garbage can` / `bin` | 同義語集合にする |
| `bicycle` / `bike` | 同義扱い |
| `truck` / `lorry` | AmE/BrE を許容 |
| `sidewalk` / `pavement` | 地域差を考慮 |
| `crosswalk` / `pedestrian crossing` / `zebra crossing` | 同義群にする |
| `bag` / `backpack` | 形が明確な場合だけ区別 |
| `book` / `notebook` | 表紙・リング等の特徴を誇張 |
| `sleep` / `lie` | 低ポリ人物では厳密区別しすぎない |
| `look at` / `watch` | 顔向きだけでは採点を厳密にしない |

### 実寸とゲーム上の見やすさ

`size_m` は **実物サイズの設計目安であり、資料から得た統計値ではありません**。ユーザー指定に従って実寸基準にしています。

ただし 8 m 四方の画面では、`coin`、`key`、`ticket`、`pencil`、`phone`、`remote control` のような数 cm の物体は、実寸のままではゲームプレイ上の重要情報として小さすぎます。推奨は、

1. 保存データ上の `size_m` は実寸のままにする。
2. ゲーム用 variant にだけ 1.5～3 倍程度の視覚的誇張を許す。
3. 色・厚み・輪郭でも強調する。
4. 重要な小物を画面端や大型物の陰に置かない。

という分離です。

8 m の制約では逆に `bus`、`train car`、`airplane` が大きすぎます。例えば実寸級のバスや車両を中央に置けばジオラマの大半を占有します。そのため `train_car` は「一部だけ見える背景物」、bus は画面外へ見切れる、airplane は縮小背景専用、とする方が自然です。CSV の `notes` にこの制約を記録しています。

### 作りやすさ

難度 1 の代表は `ball, apple, box, table, road_patch, grass_patch, bottle, trash_bin, clock, plate, bowl` です。基本的な球、直方体、円柱を数個組み合わせれば認識できます。

難度 2 は `bench, bicycle, sofa, umbrella, vending machine, car, sink, stove, shopping cart, swing` などです。10～30 前後の単純形状でデフォルメすれば成立します。

難度 3 は `dog, cat, rabbit, horse` などの動物です。語の imageability 自体は高いのですが、犬と猫をローポリの箱・円柱だけで即座に区別させるには耳・鼻・尾・脚比率など、制作側の造形能力が必要です。したがって「学習教材として良い語」と「手続き生成しやすい語」は別です。

### CC0 を使う価値があるもの

動物については外部 CC0 の利用が合理的です。

- **Kenney – Cube Pets** は dog/cat 等を含む 3D ペット素材で、公式ページ上で **Creative Commons CC0** とされています。商用アプリにも使いやすい候補です。URL: `https://kenney.nl/assets/cube-pets`
- **Quaternius** は低ポリ 3D モデル群を CC0 で提供しており、公式サイトには動物・家具など多数のパックがあります。`Ultimate Animated Animal Pack` には複数の動物とアニメーション、FBX/OBJ/glTF/Blend 等が用意されています。URL: `https://quaternius.com/`、`https://quaternius.com/packs/ultimateanimatedanimals.html`
- **Poly Pizza** は大量の low-poly モデルを集約していますが、**サイト全体が CC0 ではありません**。公式 API では license filter があり、`1 = CC0`、別値が CC-BY とされています。したがって Poly Pizza を使う場合は「Poly Pizza だから可」ではなく、**各モデルのライセンスを CC0 に限定して保存時に記録**すべきです。URL: `https://poly.pizza/`、`https://poly.pizza/docs/api/v1.1`

特に犬・猫は、Blender Python で一から有機的な頭部を生成するより、CC0 のシンプルなベースメッシュを使い、皆さんの共通スケールと色に変換する方が制作効率が高い可能性があります。

今回の Tier 1・2 からは、依頼どおり武器、アルコール、宗教物、政治的・国家的シンボルのような文化的・安全上不要な物を外しています。

## 成果物の仕様と限界

部品候補 CSV は、指定された 21 列をすべて持っています。

`tier, part_id, word, pos, synonyms, label_ja, category, pose, motion, size_m, cefr, freq_rank, exam_evidence, imageability, build_difficulty, variants, scenes, elicits, example_sentence, score, notes`

内訳は以下の通りです。

| Tier | noun | verb / pose | 計 |
|---|---:|---:|---:|
| 1 | 21 | 9 | 30 |
| 2 | 54 | 16 | 70 |
| 3 | 75 | 20 | 95 |
| **計** | **150** | **45** | **195** |

`part_id` は全行について `[a-z0-9_]+` に収まることを検証しています。

場面 CSV は指定された 7 列、

`scene_id, name_ja, difficulty, parts, motions, target_language, elements`

を持ち、18 行です。`elements` は各行 6 要素で、全行 90 点になることを再計算済みです。

位置関係 CSV は 28 項目です。

完全な三表を一つのファイルで確認する場合は統合 Excel が最も扱いやすい形式です。

今回、推測を避けるため意図的に空欄にした情報もあります。

**NGSL の個別順位**は不明です。公式には順位入り CSV が存在しますが、この調査環境から CSV 本体を取得できませんでした。したがって `NGSL 412` のような値は一切捏造していません。

**EVP の全候補語への個別レベル付け**もしていません。English Vocabulary Profile は語義単位の CEFR 情報として有用ですが、今回の一括データセットに機械的に取り込める一次配布ファイルを確認できなかったため、クロスチェック用途に限定しました。

**CEFR-J** は v1.5 を実データとして使用しました。より新しい v1.6 の案内は確認していますが、今回 v1.5→v1.6 の 195 語すべての差分照合は行っていません。したがって CSV には明示的に `CEFR-J 1.5` と書いています。

**英検の「頻出語」**について、英検協会の公式ランキングは確認できませんでした。そこで「英検 3 級で頻出」などと第三者サイトの集計を事実扱いすることは避け、公式サンプルに実際に出たものだけを `exam_evidence` に入れています。

この保守的な扱いのため、現状の表は「不明な数値を埋めて見栄えをよくしたランキング」ではなく、**制作判断に使える確実な証拠と、設計上の推定を明示的に分離した候補表**です。

## 出典一覧

| 番号 | 出典 | 年・版 | 用途・URL |
|---|---|---|---|
| S1 | Browne, C., Culligan, B., Phillips, J., **New General Service List** | NGSL 1.2, 2023 | 2,809 語、一般英語カバレッジ、統計版の存在。`https://www.newgeneralservicelist.com/new-general-service-list` |
| S2 | Oxford University Press, **The Oxford 3000 and the Oxford 5000** | 現行版 | 選定基準、CEFR。`https://www.oxfordlearnersdictionaries.com/about/wordlists/oxford3000-5000` |
| S3 | Oxford University Press, **The Oxford 3000 by CEFR level** | 現行 PDF | 個別語の A1–B2 照合。`https://www.oxfordlearnersdictionaries.com/external/pdf/wordlists/oxford-3000-5000/The_Oxford_3000_by_CEFR_level.pdf` |
| S4 | English Profile / Cambridge, **English Vocabulary Profile** | 現行 | 語・語義の CEFR クロスチェック。`https://englishprofile.org/?menu=english-vocabulary-profile` |
| S5 | Tono, Y. / CEFR-J Project, **CEFR-J Vocabulary Profile / Wordlist** | v1.5 | 日本人学習者向け CEFR レベル。`https://github.com/openlanguageprofiles/olp-en-cefrj` |
| S6 | CEFR-J v1.5 raw CSV | v1.5 | 行単位の再現可能データ。`https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv` |
| S7 | 投野由紀夫 / TUFS, **CEFR-J Wordlist / RLD** | v1.6 案内、2022 | より新しい版の存在確認。`https://www.tufs.ac.jp/ts/personal/corpuskun/wiki/index.php?CEFR-J+RLD=` |
| S8 | 文部科学省, **中学校学習指導要領（平成29年告示）解説 外国語編** | 2017、2021年度全面実施 | 中学校語彙規模、基本句。MEXT 公式 PDF。 |
| S9 | 日本英語検定協会, **英検3級 試験内容・過去問／サンプル** | 現行公式ページ、サンプル PDF ©2013 | 中学卒業程度、面接・イラスト課題。`https://www.eiken.or.jp/eiken/exam/grade_3/` |
| S10 | 日本英語検定協会, **英検準2級 試験内容・サンプル** | 現行公式ページ | 高校中級程度、行動・状況描写。`https://www.eiken.or.jp/eiken/exam/grade_p2/` |
| S11 | ETS / IIBC, **TOEIC Speaking Test: Content and Format / 出題形式** | 現行 | 写真描写の形式・採点観点。ETS / IIBC 公式。 |
| S12 | ETS, **TOEIC official sample tests – Listening Part 1 / Speaking** | 現行公式サンプル | table、shovel、market、人物・物・動作例。 |
| S13 | Cambridge University Press & Assessment, **B1 Preliminary for Schools Speaking Part 2 – Teacher’s Notes / Sample Tasks** | 現行公式教材 | Place/People/Activity/Objects 等、台所・居間の写真。 |
| S14 | Brysbaert, M., Warriner, A. B., & Kuperman, V., **Concreteness ratings for 40 thousand generally known English word lemmas** | 2014, *Behavior Research Methods* 46 | concreteness の一次研究。DOI `https://doi.org/10.3758/s13428-013-0403-5` |
| S15 | Brysbaert et al. rating data raw mirror | 2014 data | 個別値の再照合用の二次配布。`https://raw.githubusercontent.com/ArtsEngine/concreteness/master/Concreteness_ratings_Brysbaert_et_al_BRM.txt` |
| S16 | Scott, G. G., Keitel, A., Becirspahic, M., Yao, B., & Sereno, S. C., **The Glasgow Norms: Ratings of 5,500 words on nine scales** | 2019 | imageability と concreteness を別尺度として確認。 |
| S17 | Mizumoto, A. & Watari, Y., **Identifying Key Grammatical Errors of Japanese English as a Foreign Language Learners in a Learner Corpus: Toward Focused Grammar Instruction with Data-Driven Learning** | preprint、公開年は今回の取得資料から不明 | 日本人学習者の noun/article/preposition エラー。`https://osf.io/preprints/osf/8n9q4` |
| S18 | Kenney, **Cube Pets** | 現行 | CC0 3D 動物素材。`https://kenney.nl/assets/cube-pets` |
| S19 | Quaternius, **Free Low Poly 3D Models / Ultimate Animated Animal Pack** | 現行 | CC0 の low-poly 3D 素材。`https://quaternius.com/`、`https://quaternius.com/packs/ultimateanimatedanimals.html` |
| S20 | Poly Pizza, **3D model library / API documentation** | 現行 | モデル単位の CC0 判定。`https://poly.pizza/`、`https://poly.pizza/docs/api/v1.1` |

**アクセス日：2026-10-24。**

今回の調査で最も強い結論は、「初期ライブラリを名詞頻度だけで作らない」ことです。写真描写では `table` の価値は `table` という一語ではなく、`on the table / under the table / at the table / sitting at the table / putting something on the table / there are two cups on the table` まで含めた**関係のハブ**としての価値にあります。英検・TOEIC・Cambridge の公式課題と、日本人学習者の冠詞・数・前置詞エラー研究を合わせると、**「単純で具体的な物体を、動作と位置が明瞭になるよう再配置する」ことが、部品制作量に対して最も高い学習・ゲーム上のリターンを得やすい設計**と判断できます。
