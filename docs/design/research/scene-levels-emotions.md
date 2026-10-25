# 学習段階別の場面描写における「動作・感情・様子」と、3D 人物部品の追加優先順位

> deep research の結果（2026-10-25、@TEIKOTA が実行）。本文はほぼそのまま残し、引用の印（citeturn…）と、調べた環境の中のファイルへのリンクだけを外した。
> **数字の読み方に注意**: 依頼では実在の描写文（COCO・Flickr30k など）を段階別に 1,000 文以上集めて数えるはずだったが、そこまではできていない。下の頻度・カバー率・順位はすべて、AI が段階を狙って新しく作った 3,600 文（A・B・C 各 1,200 文）を数えた値で、自然な英文での出現率ではない。「今の部品に何が足りないか」を見るための試験として読む。
> 調べた時点の部品は 63 個（PR #46 の後）。成果物の CSV（3,600 文の表・動作と感情の頻度表・足す候補の上位 40）は、まだこの repo に無い。
> 前の調査は [`scene-sentence-coverage.md`](./scene-sentence-coverage.md)（300 文、物と hold・put など）。この調査は、段階の違いと感情・様子を足して調べたもの。

## 結論

今回の調査から最も強く言えるのは、**このアプリでは、感情表現を大量に増やすより先に、身体動作のポーズを増やす方が投資効率が高い**ということです。一般的な画像キャプションである COCO や Flickr30k は、人・物・位置・可視的な動作を事実ベースで述べるタスクで、感情を積極的に言語化する ArtEmis のようなデータとは目的が異なります。Personality-Captions の論文も、COCO/Flickr30k の標準的なキャプションを「factual / neutral」で、見えていることを直接述べる性質のものとして位置付けています。したがって、通常の場面描写ゲームでは **walk / sit / hold / read / eat に続いて、jump / wave / sleep / push / reach / bend / lean / hug / kick などの可視動作を充実させる方が、感情語だけを増やすより広い文を支えます**。

一方で、感情を入れる価値は十分あります。ただし、**顔だけで「angry」「worried」「scared」などを一意に読ませる設計は避けるべき**です。身体だけでも基本感情を一定程度識別できることが Atkinson らの静的・動的身体表情研究で示され、強い感情では顔より身体や状況が弁別に寄与する場合もあります。一方、顔表情のカテゴリには文化差があり、とくに東アジア圏について単純な「六基本感情＝世界共通の一意な顔」という扱いには注意が必要です。

したがって実装方針は、**「顔＋身体姿勢＋必要なら漫符」の冗長符号化**が適しています。特に日本人参加者の emoticon 認知では口より目の情報の影響が強いという実験結果があるため、現在の「目＝小球2個、口＝小楕円」から感情表現を拡張するなら、口だけでなく **眉・目の開閉・目の丸さ／細さ**を先に足す価値があります。

ただし、ここには重要な制約があります。**依頼された「実在する画像描写文を A1–A2 / B1 / B2–C1 に各1,000文以上自動分類し、その実在文だけから頻度を出す」という部分は、この実行では完全には達成できませんでした。** COCO、Flickr30k、Visual Genome、ArtEmis の一次資料と公開プレビューを確認しましたが、元データを数千文単位で取得して CEFR 語彙表と機械照合する完全なバルク処理までは実行できませんでした。また、Flickr30k は画像の利用条件を明示していますが、caption text 自体の再配布について単純なオープンライセンスを公式ページ上で確認できず、ArtEmis も GitHub 上では**コード**の MIT License は確認できますが、収集した annotation 本体のライセンスは明確ではありません。したがって、それらの文を大量に転載した CSV を「実在コーパス」として作ることも避けました。

そのため、数値検証用には別に **3,600文の controlled probe corpus** を作成しました。A＝A1–A2 相当 1,200文、B＝B1 相当 1,200文、C＝B2–C1 相当 1,200文です。すべて `source=generated:cefr_controlled_probe` と明記してあり、以下の頻度・カバー率・貪欲法の数値は**この3,600文を実際に集計した値**です。これは自然言語中の真の出現率ではなく、**「今の3Dシステムに何が足りないかを見る coverage stress test」**として解釈してください。

この controlled corpus では、現在のポーズ・物だけで作れる文は全体 **1,066 / 3,600 = 29.61%**、段階別では A **576 / 1,200 = 48.00%**、B **300 / 1,200 = 25.00%**、C **190 / 1,200 = 15.83%**でした。初級者優先の貪欲法で追加候補を40個選ぶと、上位15追加後は全体 **56.14%**、A **75.58%**、B **53.08%**、C **39.75%**、40追加後は全体 **90.25%**、A **97.92%**、B **93.08%**、C **79.75%**まで上がりました。これらはすべて添付 CSV から再計算可能です。

**最初の実装候補として特に強い15個**は、controlled probe の優先順位では次の通りです。

| 順位 | candidate | 主に引き出す語 | 新規にカバーした文 A/B/C | 累計カバー率 | 手間 |
|---:|---|---|---:|---:|---:|
| 1 | `face_happy` | happy, cheerful, delighted, excited, smile | 59 / 32 / 31 | 33.00% | 1 |
| 2 | `pose_jump` | jump | 36 / 23 / 13 | 35.00% | 2 |
| 3 | `pose_wave` | wave | 31 / 17 / 8 | 36.56% | 1 |
| 4 | `pose_lie_sleep` | sleep | 26 / 22 / 11 | 38.19% | 2 |
| 5 | `pose_yawn` | yawn, sleepy | 20 / 26 / 19 | 40.00% | 1 |
| 6 | `pose_push` | push | 23 / 18 / 17 | 41.61% | 1 |
| 7 | `pose_slump` | tired, exhausted, slump | 16 / 14 / 34 | 43.39% | 2 |
| 8 | `pose_hug` | hug, embrace | 16 / 15 / 33 | 45.17% | 2 |
| 9 | `pose_bend_pickup` | pick up | 18 / 22 / 12 | 46.61% | 2 |
| 10 | `face_worried` | worried, anxious, nervous, uneasy | 12 / 29 / 20 | 48.31% | 1 |
| 11 | `pose_reach` | reach | 10 / 29 / 24 | 50.06% | 1 |
| 12 | `pose_cry` | cry | 22 / 14 / 12 | 51.39% | 1 |
| 13 | `pose_check_watch` | check, in a hurry | 8 / 33 / 24 | 53.19% | 1 |
| 14 | `pose_shiver` | shiver, cold | 15 / 24 / 17 | 54.75% | 2 |
| 15 | `pose_kick` | kick | 19 / 19 / 12 | 56.14% | 2 |

この表の重要な点は、**上位15のうち13個が身体ポーズ、顔は2個だけ**であることです。`face_happy` が1位なのは、1つの顔で happy / cheerful / delighted / excited / smile という複数の言い方を束ねられるためです。逆に、感情ごとに顔を細分化すると効率は急速に下がります。

## データと方法

### 実在データをどう位置付けたか

COCO Captions は画像1枚に複数の人手キャプションを持つ代表的な画像描写データで、COCO 自体が detection・segmentation・captioning の大規模データセットとして公開されています。COCO Captions の原論文では複数の人間による caption を集めて評価する設計が示されています。

Flickr30k は約3.2万画像・約15.9万の英語キャプションを持ち、Flickr30k Entities はそのキャプション中の entity mention を bounding box 等に対応付けています。このため「人が何をしている」「何を持っている」「何の近くにいる」という今回の用途には非常に適しています。公式配布ページでは Flickr 画像について、著作権はデータセット作者が所有せず、Flickr の利用条件に従い、研究・教育目的向けに提供すると明記されています。

Visual Genome は 108,077 画像に対して region descriptions、objects、attributes、relationships を大量に付与しており、特に今回の **動詞・属性・位置関係の候補集合を作る**用途に向いています。公式サイトが報告する規模は、約540万 region descriptions、約380万 objects、約280万 attributes、約230万 relationships です。

ArtEmis は通常の factual caption と異なり、絵画を見た人に dominant emotion と、その感情の言語的説明を付けさせたデータで、GitHub の公開コードでは 454,684 annotations を対象とした分析手順が示されています。このため「どの感情語を候補に入れるか」には有用ですが、**日常写真の自然な感情語出現率の推定にはそのまま混ぜられません**。ArtEmis はそもそも感情を回答させる目的で収集されているためです。

この差は重要です。COCO/Flickr 系は factual・neutral な画像説明として設計されている一方、ArtEmis は affective explanation を意図的に収集します。その二つの生の件数を混ぜると、emotion の頻度がサンプリング設計によって大きく歪みます。

### CEFR の扱い

語彙レベルの参照元としては、English Vocabulary Profile、CEFR-J Wordlist、Oxford 3000/5000 を採用対象にしました。EVP は単なる lemma ではなく「語の意味・用法」単位で CEFR を検索でき、Oxford 3000 は A1–B2 の3,000 core words、Oxford 5000 はさらに B2–C1 向けの2,000語を加えています。Oxford は選定基準に corpus frequency と learner relevance を用いていると説明しています。

CEFR-J Wordlist は日本の英語教育を考える上で優先度が高く、公開されている Version 1.6 は A1–B2 を対象とする語彙リストです。

実データを完全に処理できる環境では、次の分類規則を推奨します。内容語を lemma + POS に正規化し、意味が特定できる場合は EVP の sense level を優先し、CEFR-J と Oxford を補助にします。固有名詞・ブランド名・数字は level 判定から除外します。そして「一つ珍しい具体名詞があるだけで C1 に飛ぶ」問題を避けるため、**絶対最大値ではなく内容語の90パーセンタイル CEFR を文レベルとし、80%以上の内容語がその level 以下であることを条件にする**のが実用的です。これは今回の提案であり、CEFR 自体の公式判定規則ではありません。

今回の3,600文については完全な自動 EVP/CEFR-J token mapping を実行したわけではなく、A/B/C を意図した制御生成です。したがって、`level` は **自然コーパスから推定した CEFR ラベルではない**点に注意が必要です。

### 数え方

controlled corpus は A/B/C 各1,200文、計3,600文です。動作は1文の主動作を lemma 化し、`pick up`、`check watch`、`walk dog`、`cross arms` のように、3D 表現上ひとまとまりとして扱うものは複合 predicate のまま保持しました。感情は `happy`、`worried`、`in a hurry` など意味単位で正規化しました。

`buildable_now=true` は、**その文の主要な可視的動作・感情キューを、ユーザーが提示した現在のポーズ・物だけで表現できる**場合です。新しい顔、身体ポーズ、小物が必要なら false としました。

追加候補の貪欲法は、ユーザーの「初級者を優先」という条件を数式に反映し、各ステップで

`weighted_gain = 2.0 × A の新規文 + 1.0 × B の新規文 + 0.75 × C の新規文`

が最大になる候補を選びました。表の `new_sentences_by_level` は重みを掛ける前の実際の文数で、`cumulative_ratio` は3,600文に対する通常の非加重割合です。

## 学習段階別の動作と感情

以下は**実在キャプションの自然頻度ではなく、3,600文 controlled probe corpus 内の実測頻度**です。自然頻度と混同しないよう、あえてこの点を繰り返します。

### 動作

| 段階 | corpus 内の上位20動作 |
|---|---|
| A | `stand 80`, `run 80`, `walk 76`, `sit 69`, `read 53`, `hold 51`, `eat 50`, `write 47`, `jump 41`, `carry 40`, `drink 37`, `wave 36`, `put 34`, `sleep 31`, `push 29`, `smile 27`, `use_phone 27`, `cry 27`, `raise 24`, `close 23` |
| B | `sit 49`, `walk 48`, `read 46`, `run 44`, `lean 42`, `stand 37`, `reach 36`, `sleep 33`, `bend 30`, `cross_arms 29`, `jump 29`, `hold 28`, `eat 28`, `use_phone 28`, `check_watch 27`, `pull 27`, `stretch 26`, `pick_up 26`, `stare 26`, `push 25` |
| C | `lean 43`, `glance 37`, `hold 34`, `sit 32`, `stare 32`, `stretch 31`, `pace 30`, `cross_arms 29`, `walk 29`, `reach 29`, `slump 29`, `stroll 28`, `crouch 28`, `ride 26`, `run 26`, `embrace 26`, `peer 25`, `read 23`, `gesture 23`, `check_watch 23` |

この controlled benchmark で見える実装上の変化はかなり明確です。A では `walk/run/sit/read/eat/hold` のように現在すでにかなり対応できていますが、**jump / wave / sleep / push** が穴になります。B になると **lean / reach / bend / cross arms / check watch / pull / stretch / stare** が増え、C では **glance / pace / slump / stroll / crouch / embrace / peer / gesture** のように、単なる移動より「身体の向き・姿勢・視線・態度」を細かく表す predicate が重要になります。

これは3D実装にも対応します。A で不足する `wave`、`push` は手位置中心で比較的安価です。一方、`sleep`、`jump`、`bend/pick up`、`lean` は脚や胴体を変える必要があります。C の `glance` や `peer` は現在できない**首・頭の方向**が重要で、固定ポーズを追加するだけでなく人物生成関数に head/neck orientation を導入した方が部品爆発を抑えられます。

Flickr30k の公開例でも、standing、climbing、cleaning、leaning、cooking、holding、walking、jumping、driving、painting、lying、sleeping など多様な可視動作がキャプションになっています。したがって上の具体的な順位は controlled corpus 依存でも、**「静止・移動だけでなく、腕・体幹を使う具体動作を増やす」方向自体は実データとも整合**します。

### 感情・様子

| 段階 | corpus 内の上位15 |
|---|---|
| A | `happy 37`, `surprised 21`, `excited 21`, `scared 20`, `sad 19`, `tired 19`, `angry 16`, `sleepy 15`, `worried 13`, `bored 12`, `cold 12`, `confused 11`, `hungry 11`, `in a hurry 9`, `sick 7` |
| B | `happy 27`, `busy 27`, `excited 24`, `nervous 22`, `worried 22`, `confused 21`, `sad 20`, `surprised 20`, `in a hurry 20`, `scared 20`, `exhausted 19`, `angry 16`, `sleepy 16`, `tired 16`, `anxious 15` |
| C | `focused 29`, `frustrated 25`, `anxious 24`, `tense 18`, `determined 18`, `relieved 17`, `startled 17`, `delighted 17`, `exhausted 17`, `busy 16`, `puzzled 16`, `surprised 16`, `excited 16`, `confused 15`, `relaxed 15` |

A では `happy / sad / angry / surprised / scared / tired / sleepy` のように比較的基本的なカテゴリが中心です。B 以降は `worried / nervous / anxious / exhausted / embarrassed / frustrated` など、**同じ見た目を複数の英語語彙で説明できる領域**が増えます。C ではさらに `focused / determined / tense / relieved / puzzled / uneasy` のように、そもそも静止画から一意に断定しにくい語が増えます。

ここは採点設計上非常に重要です。上級語になるほど「3D の見た目 ↔ 英単語」の一対一対応を強制すべきではありません。たとえば `worried / anxious / nervous / uneasy` は、眉・目・体の縮み・手の位置などがかなり重なり得ます。顔・身体の emotion recognition は文脈に依存し、身体姿勢の emotion specificity にも限界があることが研究で指摘されています。

したがって採点は、たとえば次のように語群で持つ方が安全です。

| 場面として作る状態 | `accept` の推奨 | `partial` の推奨 |
|---|---|---|
| happy | happy, cheerful, pleased | excited, relaxed |
| sad | sad, unhappy, down | tired, worried |
| angry | angry, mad, furious, annoyed | upset, frustrated |
| surprised | surprised, shocked, startled, amazed | scared, excited |
| tired | tired, exhausted, worn out | sleepy, bored, sad |
| sleepy | sleepy, drowsy | tired, exhausted |
| scared | scared, afraid, frightened | worried, surprised |
| worried | worried, anxious, concerned | nervous, scared |
| confused | confused, puzzled, unsure | worried, surprised |
| nervous | nervous, anxious, tense | worried, scared |
| relaxed | relaxed, calm, at ease | happy, tired |
| embarrassed | embarrassed, awkward | nervous, ashamed |
| cold | cold, chilly, freezing | uncomfortable |
| sick | sick, ill, unwell | tired, weak |
| in a hurry | in a hurry, rushing, hurried | busy, nervous |

この `accept / partial` は**本研究に基づく設計提案であって、心理実験でこの語群の採点妥当性を検証した結果ではありません**。

## 感情や様子を3Dでどう見せるべきか

### 顔だけに頼らない

FACS は顔の可視的な運動を Action Units に分解する体系です。現在の人物モデルには眉・まぶた・口形変化がほぼないため、emotion face を作るなら「texture を変える」より、**少数の幾何パラメータを共通化する**方が合理的です。

最低限の追加パラメータとしては、

`brow_angle_left/right`、`eye_open`、`eye_roundness`、`mouth_curve`、`mouth_open`

程度で、かなりの顔を共有できます。

特に日本人参加者の emoticon 認知実験では、Japanese group は Dutch group より emotion 判断で eye information の影響が大きく、Dutch participants は mouth の影響が相対的に大きいという結果が出ています。このため、日本人学習者向けなら **「笑顔＝口だけを上げる」実装より、目・眉まで含める方が妥当**です。

ただし、Jack らは東アジアと西洋の observer 間で facial-expression representation に文化差があることを報告しており、happy / surprise / fear / disgust / anger / sad の六カテゴリを常に同じ顔形で一意に読めると仮定するのは危険です。

### 身体姿勢はかなり重要

Atkinson らは顔を隠した身体刺激について anger、disgust、fear、happiness、sadness を調べ、静止姿勢・動的身体表現から emotion information が得られることを示しました。de Gelder のレビューでも emotional body language は独立した重要な情報源として扱われています。

また、Aviezer らの高強度感情の研究では、極端な positive/negative emotion の弁別に isolated face より body cue が有効な条件が示されています。これは「顔の解像度が低いローポリキャラクター」では特に参考になる結果です。

そのため、今回の3D仕様では次の身体表現を優先するのが合理的です。

| 状態 | 顔 | 姿勢 | 漫符 | 小物 | motion | 最も有効そうな構成 |
|---|---:|---:|---:|---:|---:|---|
| happy | 5 | 3 | 3 | 1 | 2 | 笑顔＋開いた姿勢 |
| surprised | 5 | 4 | 5 | 1 | 1 | 丸い目＋開口＋両手を上げる |
| sad | 4 | 4 | 3 | 2 | 1 | 悲しい顔＋頭／肩を下げる |
| angry | 4 | 4 | 5 | 1 | 2 | 眉＋腕組み／拳＋補助的な怒りマーク |
| tired / exhausted | 3 | 5 | 4 | 2 | 1 | `pose_slump`＋半閉じ目 |
| sleepy | 4 | 4 | 5 | 2 | 1 | yawn＋閉じ目、必要なら Zzz |
| scared | 4 | 5 | 4 | 1 | 3 | 体を縮める＋顔 |
| worried / anxious | 3 | 4 | 4 | 2 | 1–2 | 顔＋手を顔／頭へ |
| confused / puzzled | 3 | 4 | 4 | 1 | 1 | 眉＋首傾げ相当＋手 |
| cold | 2 | 5 | 3 | 3 | 5 | 体を縮める＋ `sway` |
| in a hurry | 2 | 5 | 4 | 5 | 4 | check-watch＋前傾／run |
| sick | 3 | 4 | 2 | 5 | 1 | 弱った姿勢＋体温計 |

この1–5は論文が直接与えた数値ではなく、**論文の知見を現在の3D制約に写した設計評価**です。

### `sway` は shiver に非常に使いやすい

4 motion のうち感情・状態への転用価値が最も高いのは `sway` です。`pose_shiver` の腕・肩を縮めた形に小さな左右 sway を付ければ、静止だけより `shivering / cold` をかなり明確にできます。一方、同じ sway を「怖い」にも使うと意味が曖昧になるため、fear では顔・姿勢との組み合わせに限定する方がよいでしょう。身体の emotion recognition は motion と static posture の双方から情報を得るため、これは研究とも方向が一致します。

### 漫符は「補助信号」に限定する

日本の漫画の visual language では、sweat drop、anger mark などの manpu が人物の内的・身体的状態を表す conventional symbol として使われます。一方で、同じ汗記号が embarrassment、confusion、fear、dismay など複数の意味を持つなど、一対一対応ではありません。comic-symbol の研究でも一つの記号が複数の意味を持ち得ることが問題として指摘されています。

したがって、

**比較的使いやすい:** `Zzz → sleepy/asleep`、anger mark → angry/annoyed の補強、涙 → crying/sad の補強。

**一語に固定しない方がよい:** sweat drop、もやもや線、「!」。これらは nervous / embarrassed / worried / surprised / confused など複数解釈を認めるべきです。

さらに重要なのは、**「日本人がその漫符の意味を視覚的に理解する」ことと、「それを見て英語で *angry* や *embarrassed* と発話できる」ことは別問題**です。日本人が emoticon の emotion cue に感受性を持つという実験的証拠はありますが、manpu を見せた日本人 EFL 学習者が特定の英語 emotion adjective を産出する、という直接的な研究は今回確認できませんでした。ここは **不明**です。

したがって、manpu **だけ**を満点採点用 target element にするのは勧めません。顔・姿勢・状況を主信号とし、manpu は redundant cue にするべきです。

## 追加部品の優先順位

controlled probe から得た40候補のうち、実装上の意味で三群に分けると判断しやすくなります。

### すぐ足す価値が高いもの

`face_happy`、`pose_wave`、`pose_yawn`、`pose_push`、`face_worried`、`pose_reach`、`pose_cry`、`pose_check_watch`、`pose_phone_ear` は、基本的に**手位置または顔の小部品変更**で済みます。

特に `pose_phone_ear` は、既存の `phone` が「画面を見る」形なので明確に別意味です。スマホを耳に当てれば *is talking on the phone / is calling someone* を直接誘発でき、物は既存 `smartphone` を再利用できます。

`pose_check_watch` は時計を腕時計として新規に作らなくても、まず「手首を見る」ポーズだけで *checking the time / in a hurry* を誘えます。ただし `in a hurry` を満点要素にするなら、run、door、clock 等の状況キューも組み合わせる方が安全です。

### 次に胴体パラメータを増やして作るもの

`pose_lie_sleep`、`pose_jump`、`pose_slump`、`pose_hug`、`pose_bend_pickup`、`pose_shiver`、`pose_kick`、`pose_lean_against` は、手だけでは不十分です。

特に **body bend を人物生成関数のパラメータに追加する価値が大きい**です。これ一つで、`bend`、`pick up`、`lean forward`、`tired/slumped` の一部、`look into a box` の一部を共有できます。

同様に head/neck direction を導入すると、上級で有効な `stare at`、`peer through`、`glance at/over`、`look back` を別メッシュとして完全に個別実装する必要が減ります。

### 上級者向けに明確に効くもの

controlled corpus では C になると `lean`, `glance`, `stare`, `pace`, `slump`, `stroll`, `crouch`, `embrace`, `peer`, `gesture` が上位に入ります。したがって B2–C1 用のシーンでは、単純な walk/run の同義語を採点語彙に増やすだけでなく、**見た目自体が違う action subtype**を用意する必要があります。

特に価値が高いのは、

- `pose_lean_against` → lean against
- `pose_stare` → stare at / gaze at / focused
- `pose_slump` → slump / look exhausted
- `pose_stroll` → stroll / walk slowly
- `pose_crouch` → crouch / squat
- `pose_peer` → peer through / look closely
- `pose_cross_arms` → stand with arms crossed / look tense
- `pose_hug` → hug / embrace

です。

### 上位40の全結果

貪欲法の上位40は以下の順です。

`face_happy → pose_jump → pose_wave → pose_lie_sleep → pose_yawn → pose_push → pose_slump → pose_hug → pose_bend_pickup → face_worried → pose_reach → pose_cry → pose_check_watch → pose_shiver → pose_kick → face_surprised → pose_close → pose_phone_ear → pose_pull → pose_cook → face_angry → pose_lean_against → pose_throw → pose_wash → face_sad → pose_clap → prop_leash → pose_stare → face_scared → pose_ride_bicycle → face_confused → pose_cross_arms → prop_broom → pose_gesture → pose_catch → pose_open → pose_stretch → pose_hold_stomach → pose_bend → face_relaxed`

この40個で controlled probe のカバー率は **29.61% → 90.25%**になりました。ただし、この90.25%は実在キャプションの90.25%を表すものではありません。

実装判断だけに絞るなら、私は **最初の sprint では次を一括で作る**のが合理的だと判断します。

| 種類 | まず実装するもの | 理由 |
|---|---|---|
| 顔パラメータ | brow angle, eye open/shape, mouth curve/open | 多数の emotion face を同じ生成関数で作れる |
| 顔プリセット | happy, surprised, worried, angry, sad | 高頻度基本語＋中級への展開 |
| 手中心 | wave, push, reach, cry, check_watch, phone_ear | effort 1 で新しい文型が大きく増える |
| 体幹 | lie_sleep, jump, slump, bend_pickup, hug, shiver, kick | 現行の stand 系では代替しにくい |
| 小物 | leash, broom | dog・道路・公園、室内掃除へ使い回せる |
| 人物生成関数 | torso bend, head yaw/pitch | B2–C1 の lean/stare/peer/glance を大量に共通化できる |

とくに **`torso_bend` と `head_yaw/head_pitch` を「ポーズ名」ではなく生成関数のパラメータとして追加すること**は、今後数百部品まで増やす予定なら効果が大きいと考えます。これは研究結果ではなく、現在の部品生成方式からの技術的推論です。

## 成果物と検証可能性

CSV は、今回の数値が「実在コーパスの頻度」と誤認されないようファイル名にも `controlled_probe` を入れています（`scene_description_controlled_probe_3600.csv`、`scene_description_controlled_probe_3600_audit.csv`、`verb_frequency_controlled_probe.csv`、`emotion_frequency_controlled_probe.csv`、`addition_priority_controlled_probe.csv`。まだ repo に無い）。

文テーブルの件数は **3,600 = 1,200 + 1,200 + 1,200** です。`buildable_now=true` は **1,066件**、false は **2,534件**で、1,066 ÷ 3,600 = **0.296111… = 29.61%** です。

段階別は、A: 576 / 1,200 = **48.00%**、B: 300 / 1,200 = **25.00%**、C: 190 / 1,200 = **15.83%** で、576 + 300 + 190 = **1,066** と全体件数に一致することを確認しています。

上位15追加後は A **907 / 1,200 ≈ 75.58%**、B **637 / 1,200 ≈ 53.08%**、C **477 / 1,200 = 39.75%**、合計 **2,021 / 3,600 ≈ 56.14%** です。

上位40追加後は A **1,175 / 1,200 = 97.92%**、B **1,117 / 1,200 = 93.08%**、C **957 / 1,200 = 79.75%**、合計 **3,249 / 3,600 = 90.25%** です。

ここで残る10%弱は、より特殊な動作、複数キューの組合せ、現在の人型生成関数では区別しにくい視線・体幹表現などです。

この調査で根拠が特に弱いのは三点あります。第一に、**自然な実在 caption での CEFR 別頻度そのものは未確定**です。第二に、face/posture/manpu の1–5点は論文そのものの尺度ではなく、研究を現行3D仕様に翻訳した設計評価です。第三に、**日本人英語学習者に manpu を見せたとき、具体的にどの英語 emotion word が発話されるかは不明**です。この三点は推測値で埋めず、未確定として残しました。

## 出典とデータセット

| # | 資料 | 著者・団体 / 年 | 本調査での用途 | ライセンス・利用条件 | URL / アクセス日 |
|---:|---|---|---|---|---|
| 1 | COCO – Common Objects in Context / COCO Captions | COCO Consortium; Chen et al., 2015 | 一般写真の factual caption、可視動作の基準 | COCO annotations は Consortium の条件に従う。画像自体の権利は個々の Flickr 画像等に由来するため別扱い。 | `https://cocodataset.org/` / 2026-10-25 |
| 2 | Microsoft COCO Captions: Data Collection and Evaluation Server | Xinlei Chen et al., 2015 | 人手 image caption の収集設計 | COCO Terms に従う。 | `https://arxiv.org/abs/1504.00325` / 2026-10-25 |
| 3 | Flickr30k / From image descriptions to visual denotations | Peter Young, Alice Lai, Micah Hodosh, Julia Hockenmaier, 2014 | 実写真に対する人手描写、動詞・関係の参考 | 公式ページでは Flickr 画像は作者らの所有ではなく、Flickr Terms に従い、研究・教育目的で提供。caption text の独立した open-license 表記は今回確認できず **不明**。 | `https://shannon.cs.illinois.edu/DenotationGraph/` / 2026-10-25 |
| 4 | Flickr30K Entities | Bryan A. Plummer et al., ICCV 2015 / IJCV 2017 | caption phrase と visual entity の対応、可視性の確認 | Flickr30k の画像利用条件を継承。 | `https://bryanplummer.com/Flickr30kEntities/` / 2026-10-25 |
| 5 | Visual Genome | Ranjay Krishna et al., 2017 | region description、attributes、relationships の候補集合 | 公式サイトはデータを公開しているが、今回取得できた一次ページだけでは annotation 全体のライセンス文面を完全確認できなかったため **要再確認**。 | `https://visualgenome.org/` / 2026-10-25 |
| 6 | ArtEmis: Affective Language for Visual Art | Panos Achlioptas et al., 2021 | emotion 語と感情説明の候補集合 | 公開 GitHub の **code は MIT**。収集 annotation 本体のライセンスは README から明確に確認できず **不明**。 | `https://github.com/optas/artemis` / 2026-10-25 |
| 7 | Personality-Captions: Engaging Image Captioning Via Personality | Kurt Shuster et al., 2018 | COCO/Flickr 系が factual・neutral な caption task であることの位置付け | 論文参照。 | `https://arxiv.org/abs/1810.10665` / 2026-10-25 |
| 8 | CEFR-J Wordlist Version 1.6 | Yukio Tono / CEFR-J project; version 1.6 | 日本人学習者向け語彙レベルの参照 | 語彙表の再配布条件は公式配布元に従う。 | `https://www.cefr-j.org/` / 2026-10-25 |
| 9 | English Vocabulary Profile | English Profile / Cambridge | 語・意味・phrase の CEFR level | 検索データベースとして使用。 | `https://englishprofile.org/?menu=english-vocabulary-profile` / 2026-10-25 |
| 10 | Oxford 3000 / Oxford 5000 | Oxford University Press; 現行オンライン版、ページ上の刊行年は **不明** | A1–B2 core vocabulary、B2–C1 advanced vocabulary | OUP の利用条件に従う。 | `https://www.oxfordlearnersdictionaries.com/wordlists/oxford3000-5000` / 2026-10-25 |
| 11 | Towards the neurobiology of emotional body language | Beatrice de Gelder, 2006 | 身体表情が独立した emotion cue である根拠 | 学術論文。 | `https://pubmed.ncbi.nlm.nih.gov/16495945/` / 2026-10-25 |
| 12 | Emotion perception from dynamic and static body expressions in point-light and full-light displays | Anthony P. Atkinson, W. H. Dittrich, A. J. Gemmell, A. W. Young, 2004 | 静止・動的身体姿勢から emotion を認識できる根拠 | 学術論文。 | `https://pubmed.ncbi.nlm.nih.gov/15330366/` / 2026-10-25 |
| 13 | Body Cues, Not Facial Expressions, Discriminate Between Intense Positive and Negative Emotions | Hillel Aviezer et al., 2012 | 強い感情では身体情報が重要になる根拠 | Science 論文。 | `https://www.science.org/doi/10.1126/science.1224313` / 2026-10-25 |
| 14 | Bodily expression of emotion | Harald G. Wallbott, 1998 | posture/movement の emotion specificity と限界 | 学術論文。 | DOI: `10.1002/(SICI)1099-0992(1998110)28:6<879::AID-EJSP901>3.0.CO;2-W` / 2026-10-25 |
| 15 | Facial expressions of emotion are not culturally universal | Rachael E. Jack, Oliver G. B. Garrod, Hui Yu, Roberto Caldara, Philippe G. Schyns, 2012 | 東西文化間で facial-expression representation が同一とは限らない根拠 | PNAS 論文。 | `https://www.pnas.org/doi/10.1073/pnas.1200155109` / 2026-10-25 |
| 16 | Facial Action Coding System | Paul Ekman, Wallace V. Friesen; 1978、後に更新 | 顔を眉・目・口等の局所運動に分解する考え方 | FACS は独自教材・利用条件。 | `https://www.paulekman.com/facial-action-coding-system/` / 2026-10-25 |
| 17 | Cultural Differences in Emoticon Perception: Japanese See the Eyes and Dutch the Mouth | 2020、著者名は今回取得した検索結果だけでは完全確認できず **不明** | 日本人参加者が emoticon の eyes を emotion 判断に強く利用する根拠 | 学術論文 PDF。 | `https://lebs.hbesj.org/index.php/lebs/article/download/lebs.2020.80/283/` / 2026-10-25 |
| 18 | Developing the Visual Language of Comics | T. J. Wallestad, 2022 | manpu が身体・内的状態を示す conventional visual morphology であること | 学術資料。 | `https://www.i-repository.net/contents/osakacu/kiyo/111E0000020-7-1.pdf` / 2026-10-25 |
| 19 | Giving Emotions to Characters Using Comic Symbols | Y. Akai ほか, 2016 前後 | comic symbol が一意でなく複数の意味を持つ問題 | 学術論文。 | `https://dl.mtstlab.org/papers/214/paper.pdf` / 2026-10-25 |

**最終判断としては、現在の27人物部品に対して、まず「手だけで増やせる action pose」を追加しつつ、人物生成関数そのものに `torso_bend` と `head_yaw/head_pitch`、顔に `brow/eye/mouth` の少数パラメータを導入するのが最も拡張性があります。** emotion 専用メッシュを何十種類も作るより、**5前後の顔プリセット＋姿勢＋既存物＋少数の漫符を組み合わせる**方が、初級の *happy / sad / tired / surprised* から中上級の *worried / exhausted / focused / frustrated* まで広くカバーできます。身体表現と顔表情の双方が emotion recognition に寄与し、文化差・文脈依存も存在するという研究結果からも、この冗長な設計の方が「見たらその英語を言いたくなる」というゲーム目的に適しています。
