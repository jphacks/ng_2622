# 「瞬間英作文」型の場面描写コーパスから検証する 3D 部品の過不足

> deep research の結果（2026-10-24、@TEIKOTA が実行）。本文はほぼそのまま残し、引用の印（citeturn…）だけを外した。
> 調べた環境の中にあった CSV（例文 300・語の頻度・足すと効く部品 30・場面 30・ポーズ）は、まだこの repo に入っていない。手に入ったら同じディレクトリに置く。
> 前の調査は [`scene-parts-research.md`](./scene-parts-research.md)。この調査は、その結果で決めた 34 部品（[`../scene-protocol.md`](../scene-protocol.md)「最初に作る部品」）を、逆の向き（学習者が言う文から）で確かめたもの。
> 調べた時点では部品の色が分からなかったので、色は判定に入れていない（実際の色は `assets/parts/index.json` と一覧の画像にある）。

## 要約

今回の逆向き検証では、まず公式の試験形式・教材・学習指導資料から「画像を見て短い英語を作るとき、何を言わせる設計が自然か」を抽出し、その枠組みに沿って**30場面 × 10文 = 300文**を新規作成した。そのうえで、名詞・可視動詞・前置詞・形容詞・数詞を見出し語化し、各文を3D部品へ写像し、提示された現行34部品だけで成立するかを機械的に再計算した。

瞬間英作文について、2026年1月21日発売のベレ出版改訂版は、中学英語の文型を使い、日本語から即座に英語を声に出す練習を中心に置いている。これは今回の「3〜5秒で言える、短い場面描写文」という設計と直接整合する。英検3級の二次試験は、公式に「イラスト中の人物の行動や物の状況」を描写する問題を2問含み、出題場面も家庭・学校・地域の店舗や公共施設、買い物・スポーツ・食事・天気・道案内など身近な領域である。準2級でもイラスト中の人物の行動・状況説明が課される。TOEIC Speaking は現在も写真描写2問を設け、写真をできるだけ具体的に口頭説明させる形式であり、TOEIC Listening Part 1 も写真に最も合う英文を選ぶ「写真→短文」の課題になっている。Cambridge B1 Preliminary Speaking Part 2 は「日常的な状況」のカラー写真を約1分描写し、人・活動・場所などを述べる課題である。

一方、**Cambridge A2 Key は現在、単独の写真描写課題ではない**。Speaking Part 2 は複数の視覚刺激を使って好き嫌いと理由を話し合う形式である。このため、A2 Key は「視覚刺激から短い発話を引き出す」参考には使ったが、B1 Preliminary や TOEIC Speaking と同列の写真描写データとしては扱っていない。

作成した300文はすべて新規文で、**重複文は0、30場面すべて10文ずつ、英文長は6〜9語**だった。文型タグは重複を許して数えると、`position` 238文、`article` 188文、`progressive` 147文、`plural` 82文、`adjective` 63文、`comparison` 30文、`there_are` 29文、`there_is` 4文、`two_actions` 4文となった。冠詞・複数形・位置表現の少なくとも一つを練習する文は**286/300 = 95.3%**で、指定された30%以上を大きく満たす。

現行34部品で必要な「物・人物・可視ポーズ」が全部そろう文は、後述する色の扱いを除いた構造判定で**124/300 = 41.3%**だった。色については、現行IDのうち明示的に色が判明するのが `apple_red` と `ball_red` だけで、`bag`、`cup`、`umbrella` 等の焼き込み色が不明である。したがって「青い傘を現行 `umbrella` が満たす」などとは推測していない。参考として、**明示された色IDしか色一致と認めない保守的な色判定では111/300 = 37.0%**まで下がる。以下の主分析・貪欲法は、色が不明という入力情報上の問題をランキングに混ぜないため、41.3%の「構造カバレッジ」を用いた。

貪欲法で1部品ずつ追加すると、上位10個は `door`, `checkout_counter`, `wall`, `basket`, `plate`, `shelf`, `window`, `shirt`, `seat`, `person_drink_woman` となった。この10個だけで構造カバレッジは**41.3% → 56.3%**、30個まで追加すると**72.0%**になる。重要なのは、最初に不足しているのが珍しい物ではなく、**door / wall / counter / shelf / plate / seat のような「室内を成立させる基本部品」**だという点である。

動詞については、既存ポーズ群はかなりよいが、**hold 13文・13場面、put 9文・8場面、drink 5文・4場面、look 4文・4場面、write 3文・2場面**が新ポーズ側の主要な穴だった。一方 `cook`, `kick`, `climb`, `sleep`, `throw` は今回の300文では各1文程度であり、優先度は低い。さらに `carry` 自体は既存ポーズなのに `person_carry_boy` などの**人物属性×ポーズの組み合わせ不足**で失点するケースが多い。したがって、Blender生成側では「ポーズの座標テンプレート」と「男・女・少年・少女等の外見」をできるだけ別管理し、オフラインで組み合わせ部品を生成する方が効率がよい。

3Dで意味そのものを確定しにくい `(d)` を含む文は**6/300 = 2.0%**に抑えられた。該当した主要語は `grow`, `talk`, `wait` である。たとえば立っている2人を「waiting」と断定することや、口の表情がないローポリ人物を「talking」と断定することは困難なので、これらは満点要素にせず、人物・位置関係などを採点対象にする方が安全である。

成果物の CSV（`examples_300.csv`・`vocab_frequency.csv`・`greedy_additions_30.csv`・`scenes_30.csv`・`pose_analysis.csv`）は、まだ repo に無い。

## 根拠資料と場面・文型の設計

### 瞬間英作文から採った設計原則

森沢洋介『どんどん話すための瞬間英作文トレーニング』の2026年改訂版は、「難しい英文を作る」のではなく、既知の中学英文型を日本語から素早く英語化し、口頭で反射的に使えるようにする練習として公式出版社が位置付けている。続編も「日本語の問題文を見て、すぐ英語にして声に出す」という方法を明記している。

したがって今回のコーパスでは、長い写真説明ではなく、たとえば

> A dog is running toward a red ball.
> There are three bottles on the table.
> The bag is under the chair.

のように、**一息で生成でき、中学文法の一項目を即時に取り出せる文**を中心にした。これらは今回新しく作った文で、教材本文からの転記ではない。

### 試験から採った描写対象

英検3級は「人物の行動」と「物の状況」を直接問うため、人物＋現在進行形、物＋位置関係を最重要パターンとした。また英検公式の「主な場面・題材」は家庭・学校・地域の店舗や公共施設を挙げ、話題には買い物、スポーツ、食事、天気、道案内などが含まれる。準2級でも、学校、家庭、職場、店舗・公共施設などの日常領域と、人物の行動・状況説明が中心になる。

TOEIC Speaking は写真を説明する課題そのもので、現行形式では写真描写2問、準備45秒、発話30秒である。評価には発音等に加えて文法・語彙・まとまりも入る。TOEIC Listening Part 1 は6問の写真問題で、写真について読み上げられる4つの短文から最も適切なものを選ぶ。したがって発話試験ではないものの、「写真中の可視事実を短い一文へ写像する」資料として有用である。

Cambridge B1 Preliminary はさらに直接的で、Speaking Part 2 で日常的な状況の写真を約1分説明し、公式教材は特に **people / activities / place** を見るよう促している。B1向け教員資料でも、写真から場所、人、活動、物、色、天候などを拾う練習が使われている。

このため300文では、主に次の情報を混ぜた。

| 描写対象 | コーパスでの実装 |
|---|---|
| 人 | man, woman, boy, girl, teacher, nurse, server など |
| 行動 | walking, running, sitting, carrying, holding, putting など |
| 物 | bag, table, bottle, box, ball, bicycle など |
| 場所・関係 | under, beside, near, behind, in front of など |
| 数 | two〜seven、There are ... |
| 外観 | red, blue, small, big, tall など |
| 比較 | bigger/taller/smaller ... than ... |
| 同時動作 | while を使う短い2動作文 |

中学校学習指導要領解説では、現在・過去の進行形、`There + be`、前置詞などが中学校の言語材料として扱われ、具体的な位置や動作を表す文が例示されている。比較表現も中学校段階の文法項目に含まれる。したがって、今回の `progressive`、`there_is / there_are`、`position`、`comparison` の混在は、試験対策だけでなく中学英文法の復習としても妥当である。

東京書籍の令和3年度版 NEW HORIZON の公式公開資料では、2年 Unit 0 に `There is` 構文を扱う資料があり、Preview や Let’s 系活動についても目的・場面・状況の中で表現を使う設計が説明されている。また2021〜2022年に公開された同教科書完全準拠ワークシートも確認できる。ただし、**2021年度以降の全検定教科書について「絵を見て進行形を言う活動」をページ単位で全数比較するところまでは、公開範囲ではできなかった**。この部分は今回の根拠の弱い箇所である。

### 選んだ30場面

公式資料には「全試験を横断した場面頻度順位」は存在しないため、以下の**順序そのものは推測**である。選定は、英検の家庭・学校・店舗・公共施設、Cambridge B1 の everyday situations、TOEIC の一般的な写真描写に現れやすい「人＋物＋明確な行動」、そして部品の使い回しやすさを組み合わせた。

| scene_id | 場面 | 現行34で成立する文 |
|---|---|---:|
| `park_fetch` | 公園で犬がボールを追う | **10 / 10** |
| `classroom` | 教室で授業中 | 2 / 10 |
| `kitchen` | 台所で料理 | 3 / 10 |
| `living_room` | リビングで家族がくつろぐ | 6 / 10 |
| `cafe` | カフェで飲食 | 4 / 10 |
| `station_platform` | 駅のホーム | 3 / 10 |
| `rainy_bus_stop` | 雨のバス停 | 5 / 10 |
| `street_crossing` | 横断歩道のある道路 | 5 / 10 |
| `supermarket` | スーパーで買い物 | 2 / 10 |
| `playground` | 公園の遊び場 | 3 / 10 |
| `hospital_waiting` | 病院の待合室 | 4 / 10 |
| `beach` | 海辺 | 5 / 10 |
| `garden` | 庭で植物の世話 | **8 / 10** |
| `library` | 図書館 | 3 / 10 |
| `bedroom_cleanup` | 部屋の片付け | 2 / 10 |
| `morning_ready` | 朝の身支度 | 4 / 10 |
| `breakfast` | 朝食の食卓 | 5 / 10 |
| `office_meeting` | オフィスの打ち合わせ | 2 / 10 |
| `convenience_store` | コンビニ | **0 / 10** |
| `market` | 屋外の市場 | 4 / 10 |
| `bike_parking` | 自転車置き場 | 6 / 10 |
| `schoolyard` | 校庭でスポーツ | 4 / 10 |
| `train_car` | 電車の車内 | 2 / 10 |
| `bus_interior` | バスの車内 | 2 / 10 |
| `laundry` | 洗濯物を片付ける部屋 | 2 / 10 |
| `restaurant` | レストラン | 4 / 10 |
| `pet_home` | 家でペットと遊ぶ | 6 / 10 |
| `balcony` | ベランダで植物と洗濯物 | 4 / 10 |
| `public_square` | 駅前広場 | **9 / 10** |
| `delivery` | 建物前で荷物の受け渡し | 5 / 10 |

この結果自体が現行34部品の性格をよく示している。**公園・駅前・庭など、既存の tree / bench / ball / dog / bicycle / car / road / flower 系が効く屋外場面には強い。一方、スーパー、教室、車内、片付けなど「室内設備」を要する場面に弱い。**

## コーパスの作り方と数値検証

300文はすべて今回の分析用に新規作成した。公式教材・試験からは、著作権上、個々の答案文をコピーせず、「人物の動作を言う」「物の位置を言う」「数を言う」などの課題構造だけを利用した。TOEIC Speaking と Cambridge B1 が写真全体を詳しく描写することを要求し、英検が人物動作と物の状況を明示的に分けて問うことが、この設計の中心的根拠である。

### 文型配分

タグは一文に複数付くため、合計は300を超える。

| pattern | 文数 | 全300文に対する割合 |
|---|---:|---:|
| `position` | 238 | 79.3% |
| `article` | 188 | 62.7% |
| `progressive` | 147 | 49.0% |
| `plural` | 82 | 27.3% |
| `adjective` | 63 | 21.0% |
| `comparison` | 30 | 10.0% |
| `there_are` | 29 | 9.7% |
| `there_is` | 4 | 1.3% |
| `two_actions` | 4 | 1.3% |

`article | plural | position` のどれかを含む文は**286文、95.3%**だった。したがって、冠詞・単複・前置詞を意識させるという目的は十分満たしている。

ただし、`There is` が4文、`There are` が29文と不均衡である。これは複数形を積極的に入れる設計の副作用であり、**文法ドリルとして There is / are 自体を均等に練習させたい場合は、次版のコーパスで There is を10〜15文ほど増やす余地がある**。これは今回の部品不足分析とは独立した教材設計上の改善点である。

全英文の語数を再計算すると、最小6語、最大9語であり、指定された6〜14語以内に**300/300文すべて収まった**。英語文の完全一致重複も**0件**だった。

例：

```csv
id,scene_id,scene_ja,sentence_en,sentence_ja,pattern,nouns,verbs,preps,adjectives,not_3d_words,parts_needed,buildable_with_34
1,park_fetch,公園で犬がボールを追う,A dog is running toward a red ball.,犬が赤いボールに向かって走っています。,progressive|position|article|adjective,dog|ball,run,toward,red,,animal_run_dog|ball_red,true
```

### 見出し語化と複合語の数え方

`sentence_count` は「その語が1回以上出る文数」、`scene_count` は「その語が1回以上出る場面数」であり、一文内に同じ語が2回あっても1回として数えた。

複数形は単数見出しに統合し、たとえば `bags → bag`, `chairs → chair`, `children → child` とした。動詞は `running → run`, `sitting → sit`, `carrying → carry` のように見出し化し、助動詞・コピュラの `be` 自体は可視動詞として数えていない。

また、3D部品として一体化しやすいものは複合語として扱った。主なものは `trash_bin`, `vending_machine`, `traffic_light`, `watering_can`, `bus_stop`, `checkout_counter`, `market_stall`, `station_clock` である。`watering can` の `watering` を動詞 `water` と誤計数しないよう、複合語を先に処理した後で動詞解析している。

`stand` には人物が立つ用法と「a bottle is standing」のような物体の直立状態が混ざるため、語頻度表では `stand` 全体を28文と数える一方、人物ポーズ分析では**animate subject の場合だけを再抽出し19文**とした。この区別はポーズの優先順位を誤らないために重要である。

## 語頻度と3D表現可能性

### 名詞

今回の300文は「部品の使い回し」を意識しているため、既存部品が上位にかなり現れる。

| lemma | 文数 | 場面数 | 現行34との関係 |
|---|---:|---:|---|
| woman | 47 | 24 | woman系既存あり |
| bag | 38 | 26 | あり |
| man | 37 | 22 | man系既存あり |
| table | 35 | 15 | あり |
| bottle | 32 | 25 | あり |
| boy | 31 | 19 | boy系既存あり |
| girl | 23 | 17 | girl系既存あり |
| box | 21 | 7 | あり |
| bench | 20 | 7 | あり |
| ball | 17 | 8 | `ball_red` |
| apple | 16 | 8 | `apple_red` |
| bicycle | 16 | 6 | あり |
| book | 15 | 7 | あり |
| car | 14 | 9 | あり |
| cup | 13 | 6 | あり |

ここで特に注目すべきなのは **bag 38文・26場面、bottle 32文・25場面**である。前回の34部品にこれらを含めた判断は、逆方向のコーパス検証でも強く支持された。bag は `under / beside / on`、carry、put などを同時に誘発でき、bottle も table / bench / seat 周辺の位置関係を作りやすいためである。

### 動詞

語としての頻度上位は次のようになった。

| lemma | 文数 | 場面数 | 3D分類 | 現行ポーズ/部品 |
|---|---:|---:|---|---|
| stand | 28 | 22 | b ※物体用法も含む | あり |
| sit | 16 | 15 | b | あり |
| carry | 15 | 15 | b | あり |
| **hold** | **13** | **13** | b | **不足** |
| **put** | **9** | **8** | b | **不足** |
| run | 9 | 6 | b | あり |
| walk | 8 | 8 | b | あり |
| hang | 6 | 6 | c | 配置・sway等 |
| move | 5 | 5 | c | `move` |
| point | 5 | 5 | b | ポーズ型は既存、34外 |
| read | 5 | 5 | b | あり |
| **drink** | **5** | **4** | b | **不足** |
| eat | 5 | 3 | b | あり |
| **look** | **4** | **4** | b | **不足** |
| talk | 3 | 3 | d | 見た目だけでは弱い |
| **write** | **3** | **2** | b | **不足** |
| check | 2 | 2 | b | `phone` で代用可能 |
| raise_hand | 2 | 2 | b | ポーズ型は既存、34外 |
| use | 2 | 2 | b | smartphoneなら `phone` で代用 |
| wait | 2 | 2 | d | 見た目だけでは確定不能 |

`hold` が最重要の新ポーズ候補である。食事、買い物、庭、駅、家庭など**13場面すべて別場面**で現れたため、特定シーン専用ではない。

一方、`check a smartphone` や `use a smartphone` は、新しい身体形状を作る必要は薄い。今回の写像では既存の `phone` ポーズを利用可能とした。これは語と部品を1対1にしない方がよい典型例である。

### 位置関係

位置表現は、今回のアプリ形式と非常に相性がよかった。

| lemma / phrase | 文数 | 場面数 |
|---|---:|---:|
| beside | 46 | 29 |
| on | 38 | 26 |
| than | 30 | 30 |
| under | 23 | 22 |
| near | 22 | 20 |
| behind | 15 | 15 |
| toward | 14 | 12 |
| at | 12 | 10 |
| in front of | 11 | 11 |
| in | 9 | 8 |
| from | 8 | 8 |
| next to | 8 | 8 |
| across | 6 | 6 |
| between | 6 | 6 |
| into | 6 | 5 |
| above | 5 | 5 |
| along | 5 | 5 |

MEXTの中学校学習指導要領解説でも前置詞は中学校で扱う言語材料に明示され、場所を具体的に表す用法が例示されている。写真・イラスト試験側でも「物の状況」「人・活動・場所」を述べさせるため、位置関係は語彙学習と画像描写の双方に直接つながる。

したがって、3Dシーン生成側では `under / beside / behind / in front of / between / toward` を**偶然生じる配置ではなく、意図的な target relation としてJSONに持たせる**価値が高い。特に `beside` は29/30場面、`under` は22場面に現れ、部品をほぼ増やさず学習内容を増やせる。

### 3Dで表しにくい語

今回 `(d)` とした意味を含む文は次の6文、**2.0%**だった。

| 語 | 文数 | 問題 |
|---|---:|---|
| talk | 3 | 無表情・無口形状の人物では会話か単なる対面か確定しにくい |
| wait | 2 | stand/sit と「待っている」の意味を視覚だけで区別できない |
| grow | 1 | 一瞬の静止形状から成長中とは分からない |

したがって、これらの文を完全に禁止する必要はないが、`talk / wait / grow` そのものを「描写してほしい必須要素」にするのは避けるべきである。たとえば

> Two people are waiting near the door.

という場面なら、AI採点では `two people`, `near`, `door` を内容点にし、`waiting` はボーナス扱いにする方が視覚的な正解条件と一致する。

## 現行34部品のカバレッジと追加優先順位

### 判定方法

現行34は次のIDへ正規化して計算した。

物21個はユーザー提示のIDをそのまま使用した。人物は `person_sit_man`, `person_walk_man`, `person_read_man`, `person_stand_man`, `person_run_man`, `person_carry_man`, `person_eat_man`, `person_phone_man`, `person_walk_woman`, `person_sit_woman`, `person_run_boy`, `person_stand_girl`, `animal_run_dog` として正規化した。

各文について、

1. 物体名詞を必要部品に写像する。
2. 人物＋可視動詞は一つのポーズ部品へ写像する。
3. `(c)` の前置詞・配置・`move/fall` 等は部品を消費しない。
4. `(d)` は `not_3d_words` に残すが、部品不足とは別問題として扱う。
5. 全 `parts_needed` が現行34集合の部分集合なら `buildable_with_34=true`。

という判定をした。

結果は**124/300 = 41.33%**、false は176文だった。

色については前述のとおり、`bag` の実際の焼き込み色などが不明なので、主判定では「bagという物体を持っているか」を見る。これは**色・サイズvariantを除く構造的な上限値**であり、厳密な最終アセットカバレッジと同一ではない。明示された `apple_red` / `ball_red` 以外の色一致を保守的に認めない簡易感度分析では37.0%となるため、実際の値は34部品の現在の色仕様を入手して再計算する必要がある。

### 貪欲法による追加部品

毎ステップ「その部品を1個足したとき、それまでfalseだった文を最も多くtrueへ変える部品」を選んだ。同数なら、全300文で必要とされる回数が多いもの、それも同じなら `part_id` の辞書順で決めた。したがって再計算しても順序が変わらない決定的な tie-break になっている。

| 順位 | 追加部品 | 新しく成立 | 累計成立率 | pose_change |
|---:|---|---:|---:|---|
| 1 | `door` | **7** | **43.67%** | none |
| 2 | `checkout_counter` | **5** | **45.33%** | none |
| 3 | `wall` | **5** | **47.00%** | none |
| 4 | `basket` | 4 | 48.33% | none |
| 5 | `plate` | 4 | 49.67% | none |
| 6 | `shelf` | 4 | **51.00%** | none |
| 7 | `window` | 4 | 52.33% | none |
| 8 | `shirt` | 4 | 53.67% | none |
| 9 | `seat` | 4 | **55.00%** | none |
| 10 | `person_drink_woman` | 4 | **56.33%** | hands_only |
| 11 | `person_hold_girl` | 4 | 57.67% | hands_only |
| 12 | `laptop` | 3 | 58.67% | none |
| 13 | `person_carry_boy` | 3 | 59.67% | none |
| 14 | `bed` | 3 | 60.67% | none |
| 15 | `slide` | 3 | 61.67% | none |
| 16 | `train_car` | 3 | 62.67% | none |
| 17 | `clock` | 2 | 63.33% | none |
| 18 | `person_hold_woman` | 2 | 64.00% | hands_only |
| 19 | `person_put_woman` | 2 | 64.67% | hands_only |
| 20 | `cart` | 2 | 65.33% | none |
| 21 | `pan` | 2 | 66.00% | none |
| 22 | `person_carry_woman` | 2 | 66.67% | none |
| 23 | `person_put_man` | 2 | 67.33% | hands_only |
| 24 | `person_sit_girl` | 2 | 68.00% | none |
| 25 | `bus` | 2 | 68.67% | none |
| 26 | `cake` | 2 | 69.33% | none |
| 27 | `clothes_pile` | 2 | **70.00%** | none |
| 28 | `person_carry_girl` | 2 | 70.67% | none |
| 29 | `person_look_girl` | 2 | 71.33% | body |
| 30 | `person_put_boy` | 2 | **72.00%** | hands_only |

この順位には実装上かなり明確な示唆がある。

第一に、**次の開発スプリントでは動物を増やすより、室内の構造物を増やす方が効く**。door, wall, counter, shelf, window, seat は箱・板・直方体中心で作りやすいうえ、スーパー、教室、病院、駅、家庭、オフィス、飲食店へ横展開できる。

第二に、`basket`, `plate`, `shirt` のような簡単な日用品の効率が高い。高度な1部品より、**ローポリで簡単な生活用品を埋める方が文カバレッジが上がる段階**にある。

第三に、`person_carry_boy` が13位に現れる点が重要である。`carry` 自体は既存ポーズなのに、男の人しかそのポーズ部品がないため不足する。したがって「新しい動詞ポーズを発明する」問題と「既存ポーズを別人物に展開する」問題を分けるべきである。

## ポーズの過不足と実装上の結論

人物・動物が主語になっている用例だけを再抽出した結果は次の通りである。物体の “A bottle is standing ...” などはここでは除外した。

| verb | 人物/動物動作文数 | 場面数 | ポーズ型 | 状態 |
|---|---:|---:|---|---|
| stand | 19 | 18 | stand | 既存 |
| sit | 16 | 15 | sit | 既存 |
| carry | 15 | 15 | carry | 既存 |
| **hold** | **13** | **13** | hold | **新規・hands_only** |
| **put** | **9** | **8** | put | **新規・hands_only** |
| run | 8 | 6 | run | 既存 |
| walk | 8 | 8 | walk | 既存 |
| **drink** | **5** | **4** | drink | **新規・hands_only** |
| eat | 5 | 3 | eat | 既存 |
| point | 5 | 5 | point | 既存ポーズ型 |
| read | 5 | 5 | read | 既存 |
| **look** | **4** | **4** | look | **新規・body/head** |
| **write** | **3** | **2** | write | **新規・hands_only** |
| check | 2 | 2 | phone | 既存で代用 |
| raise_hand | 2 | 2 | raise_hand | 既存ポーズ型 |
| use | 2 | 2 | phone | smartphoneなら既存で代用 |
| **water** | **2** | **2** | water | **新規・hands_only** |
| climb | 1 | 1 | climb | 新規・body |
| cook | 1 | 1 | cook | 新規・hands_only |
| cut | 1 | 1 | cut | 新規・hands_only |
| fold | 1 | 1 | fold | 新規・hands_only |
| kick | 1 | 1 | kick | 新規・body |
| kneel | 1 | 1 | kneel | 既存ポーズ型 |
| pick_up | 1 | 1 | pick_up | 新規・body |
| push | 1 | 1 | push | 新規・body |
| sleep | 1 | 1 | sleep | 新規・body |
| throw | 1 | 1 | throw | 新規・body |

ここでいう `hands_only` は、「既存の立ち姿を基本に、両手の目標座標とそれに追随する腕だけを変える簡略ポーズとして成立しやすい」という制作上の分類である。`body` は脚・胴体・寝姿・前傾・頭部方向など、手だけでは意味が出ないものとした。

**最優先で追加すべきポーズ型は `hold` と `put`。** この2つはそれぞれ13場面、8場面に分散しており、特定シーン依存ではない。`drink` も食卓・カフェ・レストランなどで非常に自然で、手だけの変更で作りやすい。

一方 `cook` は日常語として重要でも、今回の「写真で瞬時に説明する」コーパスでは1文しかなく、専用ポーズとしての費用対効果は `hold` より明確に低い。台所場面の多くは `hold a pan`, `cut ...`, `put ... on ...` のように、より一般的な手動作へ分解できるからである。

したがって人物アセットの制作順は、概念的には

**既存 pose × 人物バリエーションの穴埋め → hold → put → drink → write / water → look → その他の全身ポーズ**

が合理的である。

特に現行の「ポーズ違いを別部品にする」方式では、`carry × man/woman/boy/girl` のような直積が急速に増える。ランタイムで骨格を持たせる必要はないが、**Blender Python 側ではポーズ座標をテンプレート化し、人物外見と組み合わせて一括生成する**のが望ましい。たとえば `carry` の手足座標を一つ定義しておけば、`person_carry_man`, `person_carry_woman`, `person_carry_boy`, `person_carry_girl` を同じ生成ロジックから書き出せる。今回の結果では、新しい意味カテゴリを増やすよりこの直積の欠損を埋める方が効くケースが実際に複数あった。

## 成果物、限界、出典

### 成果物

| ファイル | 内容 |
|---|---|
| `examples_300.csv` | 30場面×10文、和訳、文型、語解析、必要部品、34部品判定 |
| `vocab_frequency.csv` | 168見出し語、POS、文数、場面数、a/b/c/d、part_id |
| `greedy_additions_30.csv` | 決定的tie-breakによる貪欲追加30部品 |
| `scenes_30.csv` | 各場面の必要部品集合と現行34カバレッジ |
| `pose_analysis.csv` | 可視動詞、既存/新規ポーズ、hands_only/body |

数値整合性は、**300文、30場面、各10文、重複英文0、文長6〜9語、現行34成立124文、非3D語を含む文6文、貪欲追加30件**を再計算して確認した。

### 根拠が弱い・不明な点

最大の不明点は**現行の `bag`, `cup`, `bicycle`, `umbrella` 等が実際に何色で焼き込まれているか**である。このため色まで含めた厳密な `buildable_with_34` は入力情報だけでは確定できない。主結果41.3%は色variantを除く構造値であり、既知の色IDだけを認める色感度分析では37.0%だった。

次に、公式試験団体は「写真描写で park が何%、kitchen が何%」という横断的な場面頻度コーパスを公開していない。そのため30場面の**順序**は、公式に確認できた出題領域と、部品使い回し・3D適性を合わせた推測であり、実測頻度順位ではない。

また、2021年度以降の中学校検定教科書については、出版社がWeb公開している範囲に限りがある。東京書籍の令和3年度版関連資料とMEXTの学習指導要領は確認できたが、全出版社・全ページの「絵を見て説明する活動」を全数調査したものではない。

最後に、`talk`, `wait`, `look` などの imageability は二値ではない。たとえば `look` は顔・頭の向きを十分誇張すれば比較的可視化できるため `(b)` としたが、`wait` は同じ姿勢でも意味が成立したりしなかったりするので `(d)` とした。これは今回のローポリ・無表情・無リグという実装条件に基づく操作的分類である。

### 使用した出典一覧

1. 森沢洋介『［音声DL付改訂版］どんどん話すための瞬間英作文トレーニング』ベレ出版、2026年（2026年1月21日発売）。https://www.beret.co.jp/book/48138
2. ベレ出版『［音声DL付改訂版］おかわり！どんどん話すための瞬間英作文トレーニング』、現行商品ページ。https://www.beret.co.jp/book/48480
3. 公益財団法人 日本英語検定協会「3級の試験内容」、現行ページ。https://www.eiken.or.jp/eiken/exam/grade_3/solutions.html
4. 公益財団法人 日本英語検定協会「準2級の試験内容」、現行ページ。https://www.eiken.or.jp/eiken/exam/grade_p2/solutions.html
5. IIBC「TOEIC Speaking Test テストの形式と構成」、現行ページ。https://www.iibc-global.org/toeic/test/speaking/about/format.html
6. IIBC「TOEIC Speaking Test サンプル問題」、現行ページ。https://www.iibc-global.org/toeic/test/speaking/pr/01.html
7. IIBC “Test Format and Content — TOEIC Listening & Reading Test”、現行ページ。https://www.iibc-global.org/english/toeic/test/lr/about/format.html
8. IIBC「TOEIC Listening & Reading Test サンプル問題」、現行ページ。https://www.iibc-global.org/toeic/test/lr/about/format/sample01.html
9. Cambridge University Press & Assessment, “B1 Preliminary for Schools and B1 Preliminary exam format”、現行ページ。https://www.cambridgeenglish.org/exams-and-tests/qualifications/preliminary/format/
10. Cambridge Assessment English, “Overview of the B1 Preliminary for Schools Speaking test”, 2019/2020頃。https://www.cambridgeenglish.org/images/563309-b1-preliminary-for-schools-speaking-overview.pdf
11. Cambridge Assessment English, “B1 Preliminary for Schools Speaking Part 2 — Teacher’s Notes”, 2019。https://www.cambridgeenglish.org/images/563311-B1-Preliminary-for-Schools-Speaking-Part-2.pdf
12. Cambridge English, “A2 Key for Schools and A2 Key exam format”、現行ページ。https://www.cambridgeenglish.org/exams-and-tests/qualifications/key/format/
13. Cambridge Assessment English, “A2 Key Speaking Overview”, 2019/2020頃。https://www.cambridgeenglish.org/Images/563252-a2-key-speaking-overview.pdf
14. 文部科学省『中学校学習指導要領（平成29年告示）解説 外国語編』、2017年7月、2021年度全面実施。https://www.mext.go.jp/component/a_menu/education/micro_detail/__icsFiles/afieldfile/2019/03/18/1387018_010.pdf
15. 東京書籍「NEW HORIZON（中学校）令和3年度用教科書」公式資料。https://ten.tokyo-shoseki.co.jp/text/chu_current/eigo/
16. 東京書籍「NEW HORIZON English Course 2 教科書単元リンク集・ワークシート」、2021–2022年。https://ten.tokyo-shoseki.co.jp/tangenl/chu/12132/21418/

アクセス日: 2026-10-24
