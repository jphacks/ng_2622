# 3. LLM を使わずに測れる定量的な指標

調査日 2026-11-16。担当 3（決まった計算・小さな専用モデルで出せる指標）。
ルーブリック（担当 1）・データセット（担当 2）・LLM の安定化（担当 4）・文字起こしと音声の前処理（担当 5）・製品（担当 6）は扱わない。文字起こしの時刻から出す流暢さは扱う。

> 調べ方の注記: Web 検索の回数の上限（セッション全体で共有）に途中で達したため、後半の一部（c-rater、Somasundaran & Chodorow 2014、Iwashita et al. 2008 の数値、vocd-D の最小の長さなど）は確かめられなかった。それらは本文で「未確認」とした。
> 2026-11-16 の確かめ: 原典の PDF・公式の文書で、Somasundaran & Chodorow 2014・vocd-D の最小の長さ・SpeechRater 5.0 の一致・料金などを確かめ、本文を直した。c-rater と Iwashita et al. 2008 は原典が有料の誌で開けず、「未確認」のまま残した。残る「未確認」の多くは、文献ではなくこのアプリで測って確かめる問い。

---

## 問い

1. 内容（何を言えたか）を決まった手順で測れるか。場面は部品と関係の JSON なので、文から (主語, 動詞, 目的語)・(物, 前置詞, 物) の組を取り出して突き合わせる方法（SPICE とその後継）、同義語・言い換えの扱い、NLI・埋め込みの精度と外れやすい所。
2. 正確さ（文法の誤り）を決まった手順で数えられるか。GEC のモデル・LanguageTool・ERRANT、100 語あたりの誤り・誤りの無い節の割合、話し言葉の文字起こしに当てたときの問題。
3. 複雑さ・語彙（MTLD・vocd-D、CEFR-J などの語彙の表、文法の目録、L2SCA）は、20 秒・20〜60 語の発話で信頼できるか。英検 3 級〜2 級を見分けられるか。
4. 流暢さ（話す速さ・ポーズ・連続して話せた長さ）を単語の時刻から出せるか。人の評価とどれくらい相関するか。
5. 指標だけで人の点をどこまで予測できるか。組み合わせ方と説明のしやすさ。
6. このアプリに当てはめると、どの案が効き、手間・費用・リスクはどれくらいか。どこで動かすか。プレイヤーに見せやすい指標はどれか。

---

## 結論

1. **流暢さは、すぐに・費用なしで決まった計算に置き換えられる。いちばん効く。** 今の採点がすでに呼んでいる Azure の発音評価の応答には、単語ごとの `Offset`・`Duration`（100 ns 単位）が入っている。今のコード（`backend/src/scoring/azure.ts`）はこれを読み捨てている。これから「1 分あたりの語数（speech rate）」「ポーズで区切らずに話せた語数の平均（mean length of run, MLR）」「0.25 秒以上の間の数」を Workers の TypeScript で数十行で出せる。文献では、speech rate は人の流暢さの評価と r = .76、MLR は r = .72（22 研究のメタ分析）。CEFR の A2・B1・B2 の差も平均では分かれる（A2 は 73、B1 は 135、B2 は 172 音節/分）。説明しやすく、プレイヤーにもそのまま見せられる。ブラックボックスの Azure FluencyScore の代わりか、横に並べるのに向く。
2. **内容は「場面の組 × 発話の組」の一致で数えられる。ただし言い換えに弱いので、組と同義語は作り置き、判定はコードにする。** SPICE（2016）の「文を組に分けて F1 を出す」考え方は、このアプリのチェックリストの F1 とほぼ同じ形をしている。部品の `words`（名詞・動詞）と関係（under・next to・facing）は配置の JSON にもうあるので、正解の組は場面から作れる。手元で書いた 4 つの規則だけの試作でも、役割の取り違え（「男の子が犬を見ている」）を一致 0（正しい描写に数えない）にできた。埋め込みの類似度や NLI ではここが外れやすい（語順に鈍い。HANS）。一方で「lady is looking at the girl」と「woman is checking her hand」のような言い換えは落とし、正しい言い換えも一致 0 になった。方式を選ぶ軸は「決まった手順にして再現性を取るか、言い換えへの強さを取るか」になる。現実的なのは二段構え（A のあと必要なら C）。一段目は、部品ごとの同義語と上位語の辞書を場面を作るときに作って固定し、判定はコードがする。二段目は、それで決まらない描写だけを埋め込み・NLI・LLM に回す。
3. **文法の誤りの自動の数え上げは、話し言葉の 20 秒にはまだ当てにならない。数えるなら「級のねらいの形を使えたか・正しく使えたか」に絞る。** 話し言葉の GEC の最新の共有タスク（Speak & Improve 2025）でも、基準のシステムの誤りの検出は F0.5 = 0.22（再現率 0.08）にとどまる。LanguageTool は精度は高いが再現率が低い（書き言葉で .24）。一方、`be + -ing`、`There is/are` の数の一致、`because + 主語 + 動詞`、`so ...`、目的の `to + 原形` のように、級のお題が求める形の「使えた数・正しかった数」なら、品詞の並びの規則で決まった手順で数えられる。CEFR-J Grammar Profile も、品詞を付けた文に正規表現を当てる方式を使っている。見せる文言も「is + ing の形を 3 回中 3 回正しく言えた」と具体的になる。
4. **語彙の多様さ（MTLD・vocd-D・TTR）・語彙のレベル・統語の複雑さの比率は、このアプリでは点にしないことを勧める。** 理由は 3 つ。(a) 長さ: 多様さの指標は 50 語以上を前提にしている（TAALED の目安。MTLD が安定するのは 100 語前後という報告もある）。3 級の答えは 20 語前後なので足りない。(b) 課題に引きずられる: 作り置きの 48 場面の模範文を CEFR-J の語彙表で数えると、A1 の語の割合はどの級でも 0.91〜0.92 で変わらなかった。A1 でない語は bench・castle のような場面の名詞だった。つまり語彙のレベルは学習者ではなく場面を測ってしまう。(c) 統語の指標は文と節の切れ目に強く依存する: 話し言葉では、切れ目を人が付けると人の点と r = .49、自動で付けると r ≈ .2 に落ちた。ただし「because・so・to でつないだ節の数」は級のお題そのものなので、数えて見せる価値がある。
5. **指標を組み合わせた点は、1 回の短い応答では「人ひとり」と同程度まで届く。点の作り方は「正の重みの線形和」がよい。** ETS の約 1 万人・1 分の応答では、正の係数に限った 25 個の指標の回帰が人の点と r = .65 だった。これは人どうしの一致 r = .62 と同じくらい。正の係数に限ったことで失った精度は .02 だけだった（.67 → .65）。正の重みなら「速く話すほど点が上がる」という向きが説明と食い違わない。人の点のデータが揃うまでは、決まった重みと級ごとの目安で 0〜100 に直す。揃ったら非負の最小二乗などで重みを合わせ直す。
6. **実装の場所は、ほぼ全部を Workers の TypeScript に置ける。** 置けるのは、流暢さ・内容の組の一致・級のねらいの形の数え上げ・語彙の表の引き当て。場面の語彙は閉じていて（部品 154 個の words。`assets/parts/index.json`）、品詞は辞書で決まるので、構文解析器は要らない。埋め込みは Workers AI（bge-small-en-v1.5 など）で呼べる。Workers AI には NLI のモデルが無い。NLI・GEC・FACTUAL の解析器のような Python のモデルを使うなら、Cloudflare Containers（2026-04 に一般提供）が要る。端末（iOS）で計算すると端末ごとの差の議論を呼ぶので、計算はサーバーに置くのがよい。

---

## 調べたこと（出典ごと）

### 3.1 内容: 文から組を取り出して突き合わせる

**SPICE（Anderson, Fernando, Johnson, Gould, ECCV 2016）** [S1]
- 画像の説明文の自動の評価。候補の文と参照の文を、それぞれシーングラフ（物・属性・関係）にする。それを組の集合にして F1 を出す。
  - 組は 1〜3 要素。例 "A young girl standing on a tennis court" → `{(girl), (court), (girl, young), (girl, standing), (court, tennis), (girl, on-top-of, court)}`
  - P = |一致した組| / |候補の組|、R = |一致した組| / |参照の組|、SPICE = 2PR/(P+R)。
  - 組の一致は、見出し語が同じか、WordNet の同じ synset に入っていれば一致とする（METEOR の方式を流用）。
- 解析器は Stanford Scene Graph Parser の規則版（Schuster et al. 2015）。PCFG の依存構造解析に、照応の解決などの後処理と 9 つの言語の規則をかけて、物・関係・属性を取り出す。数（two dogs）は属性として持つ。
- 人の評価との一致（MS COCO 2015 の課題）: システム単位の Pearson は 0.88（CIDEr 0.43、METEOR 0.53）。文単位の Kendall τ は、Flickr 8K で 0.45（CIDEr 0.44、METEOR 0.42、人どうし 0.73）。つまり **1 文ずつの判定では、n-gram の指標よりわずかに良い程度で、人どうしの一致には遠い**。良さが出るのは多くの文を集計したとき。
- 著者が書いている限界: 解析器の誤りがそのまま点に響く。文法・流暢さは測らない（意図した設計）。参照の文が無くてもシーングラフのデータで評価できる可能性に触れている。これはこのアプリの「配置の JSON が正解のグラフ」という状況に当たる。

**FACTUAL（Li et al., ACL Findings 2023）** [S2][S3]
- 従来の解析器の問題を 2 つ挙げる。忠実さ（文の意味をグラフが取り違える）と一貫さ（同じ意味が違うグラフになる）。Visual Genome の説明文 40,369 件に、中間の表現 FACTUAL-MR を付け直した。
- Flan-T5（small・base・large）を学習させた解析器を公開している（MIT ライセンス、pip の `FactualSceneGraph`）。README に載る base の値は Set Match 81.37、SPICE 93.27、Soft-SPICE 98.83（解析の正確さ）。Soft-SPICE は組を文の埋め込み（既定は all-MiniLM-L6-v2）で緩く一致させる。
- 学習のデータは整った英語の説明文。学習者の英語や、句読点の無い文字起こしでどれだけ崩れるかは確かめられていない（未確認）。

**DiscoSG（Lin et al., EMNLP 2025、Outstanding Paper）** [S4]
- 複数の文の説明を、文をまたいだ照応も含めて 1 つのグラフにする。専門家が付けた 400 件と、合成の 8,430 件のデータを作った。
- 小さな Flan-T5-Base 2 つで「下書き → 繰り返し直す」と、基準より SPICE が約 30% 高く、GPT-4o より約 86 倍速い（原典の要旨と序論で確かめた。https://aclanthology.org/2025.emnlp-main.398.pdf 、2025。比べた基準は、文ごとに解析して合わせる方式）。

**CAPTURE（Dong et al., 2024）** [S5]
- 長い説明文の評価。FACTUAL の解析器で物・属性・関係を取り出し、3 段で一致させる。(1) 完全一致、(2) WordNet の同義語、(3) 残りを Sentence-BERT の cosine で緩く一致。
- 抽象名詞（moment など）は止め語の表で除く。重みは 物 : 属性 : 関係 = 5 : 5 : 2。
- 専門家の判定との一致（2 つのデータの平均）: Pearson は CAPTURE 0.509、SPICE 0.439、METEOR 0.402、CIDEr 0.115。DetailCaps-100 では GPT-4 の採点（PCC 0.516）にほぼ並ぶ。
- 後の PoSh（2025）は、SPICE や CAPTURE が「どの属性がどの物に付くか」の構造を捨てていると批判し、シーングラフを LLM の採点の手引きに使う [S6]。

**学習者の絵の描写を依存構造の組で見る研究（King & Dickinson, BEA 2013・2016・2018）** [S7][S8]
- 英語の学習者の絵の描写（漫画風の絵）を、Stanford Parser の依存構造と少数の手書きの規則で意味の形（例 `dobj#bird#shoot`）にした。それを母語話者の応答の集合と突き合わせる。
- 2016 年の研究の規模は 10 枚の絵、学習者の応答は 1 枚あたり 39 件。tf-idf で重みを付けた依存の組の cosine が最もよく、誤った応答を見分ける MAP は約 0.52。母語話者の応答から作る正解は「いつまでも不完全」だという問題を論じている。綴りの自動の訂正は、直した数より新しく生んだ誤りのほうが多かった。
- このアプリとの違いは、正解を人の応答から作るか、場面の構造（配置の JSON）から作るか。このアプリは後者を持っている。

### 3.2 言い換えに強い一致: NLI の cross-encoder と文の埋め込み

**小さな NLI のモデル** [S9][S10]

| モデル | パラメタ | SNLI test | MNLI mismatched | ライセンス |
|---|---|---|---|---|
| cross-encoder/nli-deberta-v3-base | 約 0.2B | 92.38% | 90.04% | Apache 2.0 |
| cross-encoder/nli-deberta-v3-small | 約 0.1B | 91.65% | 87.55% | Apache 2.0（モデルカードで確かめた） |

- 出力は 3 値（contradiction・entailment・neutral）。前提を場面の文（`accept` や description）、仮説を発話の 1 節にすれば、「正しい描写（含意）・矛盾・無関係」に直接当たる。
- 外れやすい所:
  - **語の重なりへの頼り（HANS、McCoy et al. 2019）** [S11]。MNLI で学習したモデル（当時の BERT を含む）は、「仮説の語がすべて前提にある → 含意」という近道を覚える。そのため "The doctor saw the lawyer" / "The lawyer saw the doctor" のような役割の入れ替えを見抜けない。MNLI の中で、この近道を支持する例は 2,158 件、反する例は 261 件。**このアプリの「犬が男の子を見ている ↔ 男の子が犬を見ている」は、まさにこの形**。
  - **空間の関係（SpaceNLI、Abzianidze et al. 2023）** [S12]。最新の NLI のモデルでも空間の推論は「中程度」で、型ごとに一貫しない。"between" が最も難しい。左右・前後は、画像と言葉のモデルでもほぼ偶然の水準（49〜52%）という報告がある（VG-Relations、2023）[S13]。
  - 否定と数（two vs three）も弱いとされる（今回は数値を確かめていない）。
- 文を細かく分けて NLI をかけると、長い文書の整合の判定が良くなる（SummaC、TACL 2022: SummaC ベンチマークで balanced accuracy 74.4%）。RoBERTa を基にした整合の判定 AlignScore-base（ACL 2023）は、同じベンチマークで AUC 87.4 [S14][S15]。これは「描写を事実 1 つずつに分けて正誤を付ける」今の設計を、LLM 無しで近似する道具になる。

**文の埋め込みの類似度**
- 語順に鈍い。単語を並べ替えても、埋め込みの cosine は高いまま残る（例 0.93。Jina AI のブログ、2024 年ごろ、査読なし）[S16]。事前学習の言語モデルが語順に鈍いことは EACL 2023 でも報告がある [S17]。
- したがって、**役割（誰が誰に）と位置（左右・上下）を、埋め込みの類似度だけで判定してはいけない**。物の名前の言い換え（lady ≈ woman）を拾う用途に限るのがよい。CAPTURE の 3 段目もこの使い方をしている。

### 3.3 正確さ（文法の誤り）

**GECToR（Omelianchuk et al., BEA 2020、Grammarly）** [S18]
- 文を書き直さずに、単語ごとに編集の札（追加・置き換え・活用の変更）を付ける。
- F0.5 は、XLNet の単体で CoNLL-2014 が 65.3、BEA-2019 が 72.4（アンサンブルでは 66.5 / 73.6）。Transformer の seq2seq（beam 12）より最大で約 10 倍速い（V100 での測定）。学習は書き言葉。

**LanguageTool（規則ベース）の妥当性（Crossley, Bradfield, Bustamante 2019, Journal of Writing Research 11(2)）** [S19]
- LanguageTool 3.2 を、人が誤りを付けた作文と比べた。
  - L1 の作文（Writing Pal）: 人の付けた誤りと一致した割合（精度）は 57%。指摘のうち 88.6% は、後で見た人にも正しい指摘と判定された。再現率は .239（F1 .336）で、見逃しの多くは句読点。
  - TOEFL の作文では、誤りの総数と全体の点の相関が r = −.528、文法の誤りの数とでは r = −.399。
- 要するに、**指摘したものはおおむね正しいが、大半を見逃す**。数えた誤りの数は点と中程度に相関する。
- Wikimedia の内部の評価でも、英語の GEC のベンチマークで検出の再現率は約 8% だった（査読なし）[S20]。

**ERRANT（Bryant, Felice, Briscoe, ACL 2017）** [S21]
- 元の文と直した文の差から、編集を自動で取り出し、種類（R:VERB:SVA など）に分ける。GEC の評価の標準の道具。spaCy に依存する Python のツール。
- 「誤りの数」と「誤りの種類」を決まった手順で出せる。ただし、直した文（人か GEC のモデルが作る）が別に要る。

**話し言葉の GEC（Speak & Improve Challenge 2025、Qian et al. 2024）** [S22]
- データ: 第二言語の学習者の音声 約 315〜340 時間。そのうち 55〜60 時間に、人の文字起こしと誤りの札が付いている。レベルは CEFR の A2〜C1。課題は 5 部構成で、絵（図）の説明 1 分の Part 4 と、各 20 秒以内の質問への答えの Part 5 を含む。
- 誤りの訂正の基準のパイプラインは 3 段。Whisper small で文字起こし（WER 17.3%）→ BERT で言いよどみを除く（Switchboard で学習）→ BART-large で GEC（BEA-2019 で学習）。
- **誤りを指摘するフィードバックの基準の性能は ERRANT の F0.5 = 0.22（精度 0.37、再現率 0.08）**。誤りの種類で差が大きく、前置詞の置き換え（R:PREP）は 0.416、名詞の置き換え（R:NOUN）は 0.087（どれも Dev のデータでの値。原典の表 6 で 2026-11-16 に確かめた）。
- 話し言葉の難しさとして挙がるのは、言いよどみ・繰り返し・言い直しと、文字起こしの誤りが学習者の誤りに見えること。文字起こしの誤りから偽の編集が生まれる問題は 2025 年の続報でも扱われている [S23]。音声から直した文を直接出す Whisper の微調整もある（Bannò et al. 2023）[S24]。
- 同じ基準の、全体の点の推定（Whisper small → BERT）は、人の点と PCC 0.746（RMSE 0.445）。

**誤りを率に直す単位**
- 話し言葉は文の切れ目が曖昧なので、AS-unit（Analysis of Speech unit。Foster, Tonkyn, Wigglesworth 2000, Applied Linguistics 21(3)）で区切るのが標準 [S25]。正確さの代表的な指標は 2 つある。
  - 誤りの無い節の割合（EFC% = 誤りの無い節の数 ÷ 節の数。Foster & Skehan 1996 から）
  - 100 語あたりの誤りの数（= 誤りの数 ÷ 語数 × 100）
- 手計算の例。2 級の答えが 40 語・5 節で、誤りが 2 つ（同じ節に 1 つずつ、別の節）とする。
  - 100 語あたりの誤り = 2/40 × 100 = **5.0**
  - EFC% = 3/5 = **60%**
  - 誤りが 1 つ減ると EFC% は 80% に跳ぶ。**節が 3〜6 個しかない 20 秒の応答では、EFC% は 17〜33% 刻みの粗い値にしかならない**。

### 3.4 複雑さ・語彙

**語彙の多様さと長さ**
- MTLD（McCarthy & Jarvis 2010, Behavior Research Methods 42(2)）[S26] の計算:
  - 頭から語を足しながら TTR（異なり語数 ÷ 延べ語数）を計る。TTR が 0.72 以下に落ちたら「因子」を 1 つ数えて、数え直す。最後の端数は (1 − TTR) / (1 − 0.72) を因子に足す。
  - MTLD = 語数 ÷ 因子の数。前から計った値と後ろから計った値の平均をとる。
- 手計算の例（3 級の模範文、20 語）: "A boy is building a sand castle. A girl is carrying a bucket. There is a ball on the beach."
  - 10 語目の is で TTR = 7/10 = 0.70 ≤ 0.72 になり、因子 1。a・is が 2〜3 回出るだけで落ちる。
  - 残りの 10 語は TTR = 0.90 なので、端数 = (1 − 0.90)/0.28 = 0.357。
  - MTLD（前から）= 20 / 1.357 = **14.7**。
  - 同じ長さで内容を 1 文繰り返しただけの答えでは 11.5。**因子が 1〜2 個しか無いので、1 語の違いで値が大きく動く**（`scripts/profile_pool.py` で計算）。
- TAALED（Kyle らの道具）の目安 [S27]。MATTR と MTLD は 50 語以上で「確信をもって使える」。HD-D は 50 語以上で「注意して使う」。Root TTR・単純な TTR は「避ける」。MATTR の既定の窓は 50 語なので、50 語未満では計算そのものができない。
- L2 の口頭の課題での検証（Kyle, Sung, Eguchi, Zenker 2024, SSLA 46(1)）[S28]: Root TTR と D（vocd-D）は長さが違うと信頼できない。調整した MATTR・MTLD は信頼性と妥当性が支持された（抄録より。窓の大きさや最小の長さは本文を確かめていない）。
- Koizumi & In'nami（2012, System 40(4)）[S29]: 50〜200 語の口頭の独話で、どの指標も長さから完全には独立しない。MTLD は 100 語前後で安定した（二次の出典の要約。参加者 38 人。日本人の学習者かは未確認。原典を探したが開けなかった（ScienceDirect が自動の取得を 403 で断る））。
- vocd-D は 50 語以上を前提にする。CLAN の実装は、35〜50 語の部分標本で TTR の曲線を描くので、50 語より短いと動かない。著者は「50 語で値が出ても、その値が信頼できるとは限らない」と書いている（CLAN の手引き 7.26.3、2026-10-09 の版。https://talkbank.org/0info/manuals/CLAN.pdf ）。

**語彙のレベルの表**
- CEFR-J Wordlist（東京外国語大学 投野研究室）[S30][S31]: 版 1.6（2020-03-24）。約 7,800 項目に A1〜B2 を付けている。**研究・教育・商用に無料で使える。条件は出典を正しく書くこと**。派生の表を作ってもよい。GitHub の olp-en-cefrj に v1.5 の CSV がある。投野研究室の CVLA（語彙のレベルの分析器）は「300 語未満では結果が不安定」と注記している。
- NGSL（Browne, Culligan, Phillips 2013）[S32]: 2,809 語で日常の英語の約 92% を覆う。話し言葉版の NGSL-Spoken は CC BY-SA 4.0。本体の NGSL は、公式の頁に「Creative Commons で無料。商用の利用を含む」とある（2026-11-16 に https://www.newgeneralservicelist.com/ で確かめた）。CC のどの版かは、頁に書かれていない。
- English Vocabulary Profile（Cambridge）: 利用の条件は確かめていない（未確認。原典を探したが開けなかった（englishprofile.org は JavaScript で描く頁で、本文を取れない））。CEFR-J で足りるので優先度は低い。
- 英検と CEFR の対応: 3 級 = A1、準 2 級 = A2、2 級 = B1（旺文社の 2024 年の対照表。協会の公式の頁は確かめていない）[S33]。

**文法の範囲の目録**
- CEFR-J Grammar Profile [S30][S34]: 品詞と見出し語を付けた文に、正規表現を当てて文法の項目を取り出す（Ishii & Tono 2018）。A1.1〜B2.2 の範囲で、263 項目（否定形を含めて 502）と、取り出しの式・Perl のスクリプトが cefr-j.org にある（項目の数は 2026 年の論文の記述による二次の情報）。
- English Grammar Profile（Cambridge）は 1,222 の構文を CEFR に対応させている [S35]。Bannò, Karanasou, Knill, Gales（arXiv 2026-03）[S36] によれば:
  - 活用や語順のような形で決まる構文は、規則ベースでも LLM と競える。
  - 意味や語用で決まる構文は LLM が上回る。
  - 力の推定には「規則で絞ってから LLM」の組み合わせが最もよい。
- **「使えたか」と「正しく使えたか」を分けて数える**考え方は、このアプリの級のお題（3 級 is + ing、準 2 級 because、2 級 so・to）にそのまま当てはまる。

**統語の複雑さ**
- L2SCA（Lu 2010, International Journal of Corpus Linguistics 15(4)）[S37]: 書き言葉の 14 指標。
  - 長さ: MLS・MLT・MLC
  - 従属: C/T・CT/T・DC/C・DC/T
  - 等位: CP/C・CP/T・T/S
  - 名詞句の複雑さ: CN/C・CN/T・VP/T
- 話し言葉の自動の採点への適用（Chen & Zechner, ACL 2011）[S38]。データは TOEFL Practice Online の約 1 分の自発の応答。
  - 文と節の切れ目を人が付けた文字起こしでは、最良のモデルが人の点と r = .49。
  - 切れ目を自動で推定すると r ≈ .2。
  - **句読点の無い話し言葉では、比率の指標が切れ目の推定の誤りで崩れる**。
- 課題が変わると崩れる（Güçer, Akef, Meurers, NLP4CALL 2026）[S39]。EFCAMDAT の 406,062 作文で、1,784 の複雑さ・正確さの指標から CEFR の帯を当てた。
  - 見たことのある課題の新しい学習者には 97.7%。
  - 学習に使っていない課題では 71% に落ちる。
  - 指標が「力」ではなく「課題」を覚えてしまうことを示している。
  - 寄与は語彙の洗練が 53%、統語の複雑さが 22%、文法の構文が 18%。最も低いレベルでは文法の構文の寄与が最も大きい。
- TAALES（Kyle & Crossley 2015, TESOL Quarterly 49(4)）[S40]: 語彙の洗練の 135 指標のうち 5 つで、話す力の全体の点の分散の 48.7% を説明した（10 分割の交差検証。r ≈ .70 に当たる）。データは TOEFL の約 1 分の応答で、このアプリの 20 秒より長い。

### 3.5 流暢さ（単語の時刻から出す）

**定義と式**（記号: N = 語数か音節の数、T = 最初の語の始まりから最後の語の終わりまでの秒、pᵢ = 語と語の間の無音のうち閾値以上のもの）

| 指標 | 式 | 意味 |
|---|---|---|
| speech rate（話す速さ） | N / T × 60 | 間を含めた 1 分あたりの語（音節）。速さと間の両方を映す複合の指標 |
| articulation rate（調音の速さ） | N / (T − Σpᵢ) | 声を出している間の速さ |
| mean length of run（MLR） | N / (ポーズの数 + 1) | 間を空けずに続けて言えた長さ |
| ポーズの頻度 | ポーズの数 / T × 60 | 1 分あたりのとぎれ |
| ポーズの平均の長さ | Σpᵢ / ポーズの数 | |
| 発声の時間の割合 | (T − Σpᵢ) / T | |
| 言い直し | 同じ語・2 語の続きの繰り返し、言いかけの数 | 文字起こしに残る範囲だけ |

- 閾値は 0.25 秒前後がよく使われる（de Jong & Bosker 2013 の提案。今回は原文を開いていない）。
- 手計算の例（20 秒の録音）: 最初の語が 1.5 秒、最後の語の終わりが 18.5 秒（T = 17.0 秒）。34 語。0.25 秒以上の間が 5 回（0.4・0.6・1.2・0.3・0.9 秒、合計 3.4 秒）。
  - speech rate = 34/17.0 × 60 = **120 語/分**
  - articulation rate = 34/(17.0 − 3.4) = 2.5 語/秒 = **150 語/分**
  - MLR = 34/(5+1) = **5.7 語**
  - ポーズの頻度 = 5/17.0 × 60 = **17.6 回/分**
  - 最初の語までの時間 = 1.5 秒

**人の評価との相関（Suzuki, Kormos, Uchihara 2021, Modern Language Journal 105(2)。22 研究・263 の効果量のメタ分析）** [S41]

| 指標 | 知覚された流暢さとの r |
|---|---|
| speech rate | **.76** |
| mean length of run | **.72** |
| articulation rate | .62 |
| ポーズの頻度 | −.59 |
| ポーズの長さ | −.46 |
| 言い直し | −.20 |
- 2026-11-16 に原典（著者の版の PDF、[S41]）の表で確かめた。speech rate は 11 研究（標本の大きさ 365）、MLR は 9 研究（335）からの値（表 8）（22 研究すべてが両方を測ったわけではない）。
- 自発の課題では、統制した課題より相関が低い（自発 .51〜.53、統制 .74）。発話の全体を聞かせた研究のほうが、一部を切り出して聞かせた研究より高い（.59 vs .50）。L2 の日本語の研究では .77。
- Bosker et al.（2013, Language Testing 30(2)）[S42]: 聞き手の流暢さの判定は、ポーズと速さの指標で最もよく説明できる。言い直しはほとんど寄与しない。

**レベルを見分けられるか**
- Tavakoli, Nakatsuhara, Hunter（2020, Modern Language Journal 104(1)）[S43]。British Council の Aptis の話す試験で、32 人 × 4 課題（A2・B1・B2・C1 が 8 人ずつ）を Praat で分析した。

| | A2 | B1 | B2 | C1 |
|---|---|---|---|---|
| speech rate（音節/分）平均±SD | 73.2±18.4 | 135.2±31.6 | 172.1±25.8 | 172.2±35.5 |
| MLR（音節） | 3.21 | 5.84 | 8.54 | 7.75 |
| articulation rate（音節/分） | 158 | 188 | 224 | 235 |
  - 効果量 η² は、speech rate .63、MLR .57、articulation rate .47。A2 と B1 は互いにも、B2・C1 とも違った。B2 と C1 は違わなかった。
  - ポーズの指標の多くは、A2 と他のレベルを分けた。
  - この研究が引く Ginther et al.（2010）は、流暢さの指標は試験の点と強く相関するが、隣り合うレベルは分けられなかったと報告している。
- Saito et al.（2018, Applied Psycholinguistics 39(3)）[S44]。**日本人の成人の英語の学習者 90 人**と母語話者 10 人。
  - 節の終わりのポーズの頻度が、流暢さの低い群と中の群を分けた。
  - 節の途中のポーズが、中の群と高い群を分けた。
  - 調音の速さが、高い群と母語話者に近い群を分けた。
  - 英検 3 級〜2 級の生徒は「低〜中」に当たると考えられるので、**文と文の間の長い間**がよく効く見込み（推定）。

**自動で測っても使えるか**
- Bibauw, François, Desmet（AILA 2021）[S45]。フランス語の若い初中級の学習者 215 人、約 12,000 の音声。語彙の量との相関で比べた。

| | 半自動（人が直した文字起こし、言いよどみを除く） | 文字起こしの時刻だけ（全自動） | 信号処理だけ |
|---|---|---|---|
| MLR | .628 | .588 | .479 |
| speech rate | .609 | .585 | .461 |
  - **全自動の文字起こしの時刻でも、半自動に近い**。信号処理だけ（Praat の音節の核の検出）は落ちる。
- de Jong, Pacilly, Heeren（2021, Assessment in Education）[S46]: 自動で検出した「えー」は誤検出が多い。それでも自動の指標と手の指標は、流暢さの判定を同じくらい予測した。

**このアプリで取れる時刻**
- Azure の発音評価の応答（今すでに呼んでいる）[S47][S48]。
  - 単語ごとに `Offset`・`Duration`（100 ns 単位）が付く。
  - `Granularity` を `Phoneme` にすると、全体・語・音節・音素の結果が返る（`Word` では全体と語だけ）。音節の結果は en-US だけ（[S47] で 2026-11-16 に確かめた）。公式の例では音節にも Offset がある。
  - FluencyScore の公式の定義は「どれだけ母語話者の語の間の無音の使い方に近いか」だけで、計算は公開されていない。
  - 語ごとの `UnexpectedBreak`（予期しない切れ目）の確信度も返る。公式が勧める閾値は 0.75。
  - 30 秒を超える音声は連続のモードにする必要がある（このアプリは最長 20 秒なので当たらない）。
  - 今のコードは `Granularity: "Word"` で呼び、`Words` の正確さだけを読んでいる。時刻は読み捨てている。
- Apple SpeechAnalyzer（iOS 26）[S49][S50]: `SpeechTranscriber` の `attributeOptions: [.audioTimeRange]` で、文字列の区間ごとに時刻を付けられる。途中の結果には時刻が付かず、確定の結果だけに付くという報告がある（開発者フォーラム）。今の iOS のコードはこのオプションを付けていない。

### 3.6 指標と人の点の関係（組み合わせ方）

- **Loukina, Zechner, Chen, Heilman（BEA 2015, ETS）** [S51]
  - データ: 学習用・評価用ともに約 1 万人、1 分以内の応答、点は 1〜4。人どうしの一致は応答の単位で r = .62。
  - 結果: 係数を正に限った LASSO（25 指標）が r = .653 で、専門家が選んだ 12 指標（.607）を上回った。係数に制約の無いモデル（.67）との差は .02。
  - 解釈: 1 回の応答の単位では、**指標の線形和でも人ひとりと同じくらい人の点に一致する**。係数の符号を、指標と点の相関の向きに揃えることが、妥当性と説明のために求められる。6 応答を合計した話者の単位なら、人どうしは r ≈ .9 と見込まれる。
- TAALES の 5 指標が話す力の分散の 48.7% を説明（前掲）[S40]。
- Speak & Improve の基準（BERT。決まった指標ではない）は PCC .746 [S22]。
- SpeechRater 5.0（ETS RR-18-10）は、発音・韻律・語彙・文法・内容・談話の指標を線形回帰でまとめる [S52]。TOEFL Practice Online の版 5 の採点モデルは、102 の指標から LASSO と専門家の判断で 20 を選び、最小二乗で係数を決めた（係数は正）。人との一致（評価用の 333 人・約 2,000 応答）は次のとおり（原典の表 15・16 で確かめた。https://files.eric.ed.gov/fulltext/EJ1202795.pdf 、2018）。
  - 1 応答の単位: 人どうし r = .591、機械と人 r = .557
  - 6 応答を合計した話者の単位: 人どうし r = .88、機械と人 r = .770
- 注意: 課題が変わると指標の予測は落ちる（Güçer et al. 2026: 97.7% → 71%）[S39]。

### 3.7 この repo で手元で確かめたこと

スクリプトは [`scripts/`](./scripts/) に置いた。repo の根から `python3 -I docs/design/research/scoring-objectivity/scripts/match_demo.py backend/src/scenes/pool/gen-v2-eiken2-park-13.json assets/parts` のように動かす。`profile_pool.py` は `<pool_dir> <cefrj.csv>` を取る（CEFR-J Wordlist の CSV は repo に入れていない）。

**作り置きの場面の模範文の、級ごとの指標**（`profile_pool.py`）
- 対象は `backend/src/scenes/pool` の 48 場面の `description`。語彙のレベルは CEFR-J v1.5 で引いた（語形の変化は簡単な規則で戻した）。

| 級 | 場面の数 | 語数 | 1 文の語数 | A1 の語の割合 | because | so | to + 原形 | TTR | MTLD |
|---|---|---|---|---|---|---|---|---|---|
| 3 級 | 22 | 21.0±1.3 | 7.0 | 0.92 | 0.00 | 0.00 | 0.05 | 0.68 | 19.2±2.8 |
| 準 2 級 | 13 | 43.7±3.6 | 8.7 | 0.91 | 1.00 | 0.00 | 0.00 | 0.54 | 20.5±2.0 |
| 2 級 | 13 | 58.5±3.9 | 9.8 | 0.92 | 1.08 | 1.00 | 0.77 | 0.54 | 24.5±5.3 |
- 読み取れること:
  - (1) 語彙のレベル（A1 の割合）は級で変わらない。A1 でない語は next・bench・castle・candle など、場面の物の名前。
  - (2) 級で変わるのは、長さと、because・so・to のつなぎ。級のお題の設計そのもの。
  - (3) TTR は長さで 0.68 → 0.54 と下がる（長さへの依存）。MTLD は 19〜25 で、級の差より場面の差（SD）のほうが目立つ。
  - これは模範文であり、生徒の発話ではない。生徒の発話で同じ傾向になるかは未確認。

**決まった手順の内容の判定の試作**（`match_demo.py`、出力は `match_demo.out`）
- 中身:
  - 部品の `words`（名詞・動詞）を場面の語彙にする。
  - 4 つの規則（there is X PREP Y / 主語 be V-ing 目的語 / X is PREP Y / 動詞のあとの前置詞句）で、節ごとに組を取り出す。
  - チェックリストの `accept` の文も同じ規則で組にし、要素ごとに一致を見る（完全 1、上位語 0.25、代名詞・欠け 0.5、前置詞だけ違う 0.75）。
- 対象は `gen-v2-eiken2-park-13`（女の子が手を見せる公園）。

| 発話 | 結果 |
|---|---|
| "A girl is showing her hand. A boy is running. A dog is sitting." | 女の子 = 言えた、男の子 = 一部（across the grass が無い）。犬が座っているのはチェックリストに無いが、部品 `animal_sit_dog_a` の動詞 sit と一致するので「正しい描写」と判定 |
| "A boy is watching the dog. The dog is running." | 役割の取り違えと、走っていない犬の描写をどちらも一致 0 にできた（**埋め込みでは高い類似度になりやすい形**） |
| "A kid is running on the grass. A lady is looking at the girl. There are flowers." | 男の子 = 一部（kid → child の上位語）、花 = 一部。lady is looking at the girl は女の人が手を調べる項目と結び付かず落ちた（**言い換えの限界**） |
| 2 級の模範に近い答え | 8 項目中 6 項目が言えた、1 項目が一部 |
- 規則は TypeScript でも 200〜400 行ほどで書ける規模（推定）。言い換えの網は、部品ごとの同義語の辞書の厚さで決まる。

---

## このアプリへの当てはめ（案ごとに）

前提: 今の採点は 内容 50%（LLM がチェックリストを判定し、コードが F1）・表現 25%（LLM の段階）・話し方 25%（Azure）。受けた指摘は「ロジックが見えない」「AI に頼りすぎ」「安いモデルでも安定してほしい」。

### 案 A: 流暢さを Azure の単語の時刻から決まった計算で出す（推奨・最優先）
- **中身**:
  - `assessSpeech` で、`Words[].Offset/Duration` を読む（Azure の呼び出しはすでにある）。
  - 3.5 の式で speech rate（語/分）・MLR・0.25 秒以上の間の数と合計・最初の語までの時間を出す。
  - 間の位置（文の途中か、文の終わりか）は、句読点の位置か案 D の節の区切りで分ける。
  - 「話し方」の点の中の Azure FluencyScore を、これで置き換えるか、並べて見せる。
- **効き目**:
  - 人の流暢さの評価と r = .72〜.76 の指標そのもの。A2 と B1 の差（73 → 135 音節/分）は平均で大きい。
  - 同じ音声なら同じ値になる（LLM のぶれ 0）。
  - 「なぜこの点か」を秒と語数で示せる。
- **手間**: Workers で数十〜100 行と、単体テスト。点への直し方（後述の区分線形）の目安を決める作業が別に要る。
- **費用**: 追加の API は無し。
- **リスク**:
  - 短い答え（3 級の 20 語前後で 10 秒ほど）では間の数が 1〜3 回なので、1 回で値が動く。
  - 速く話すだけで点が上がる、という誘惑が生まれる。内容と掛け合わせて防ぐ（例: 内容の F1 が低いときは流暢さの寄与を抑える）。
  - Azure は端末の文字起こしを正解文にして合わせるので、文字起こしが大きく外れると語の時刻もずれうる（程度は未確認）。
  - 「えー」は文字起こしに出ないことが多い。その分は語の間の時間として間に数えられる。これは流暢さの指標としては望ましい向き。
- **見せ方**: 「1 分あたり 95 語（2 級の目安 100 語）」「いちばん長く続けて言えたのは 9 語」「1 秒以上止まったのは 2 回」。

### 案 B: 内容を「場面の組 × 発話の組」で数える（推奨・中期）
- **中身**:
  1. 場面を作るときに、チェックリストの各項目の組（主語・動詞・目的語・前置詞）と、部品ごとの同義語・上位語の辞書を作って固定する。辞書は、部品 154 個の `words` から Open English WordNet などで候補を出し、LLM の提案も混ぜて、人が確かめる。「その場で LLM が判定する」から「作り置きの辞書をコードが引く」に移す。
  2. 採点では、決まった規則で発話を組にする。場面の語彙が閉じているので、品詞は辞書で決まり、構文解析器は要らない。
  3. 項目ごとの「言えた・一部・言えていない」は、要素の一致度の閾値で決める。今の F1・重み・その他の加点 0.5 はそのまま使う。
  4. 正しさは配置から作った組（部品の名詞 × 動詞、関係 under・next to・facing）と照らす。「場面に無い物」は名詞が場面の語彙に無いことで、「矛盾」は名詞は合うが動詞や関係が違うことで、決まった手順で出す。
- **効き目**:
  - 同じ文字起こしなら同じ点になる（同じ答えでの判定の割れ。2026-11-11 の実測では 30 通り中 2 通りで幅が出た。これが 0 になる）。
  - 判定の根拠を「取り出した組」と「一致した辞書の語」で見せられる。
  - 役割の取り違えと、無い物を決まった手順で見抜ける。
  - LLM の費用と待ち時間（1〜4 秒）が減る。
- **手間**: 規則と照合の TypeScript（推定 200〜400 行）、辞書を作る道具（場面の生成の流れに足す）、人の判定との一致を測る評価の組（担当 2 と共有）。目安は 1 人で 1〜2 週間（推定）。
- **費用**: 採点ごとの費用はほぼ 0。辞書の作り置きに LLM を少し使う。
- **リスク**:
  - **言い換えの見逃し（偽の「言えていない」）**。試作でも「looking at the girl」を落とした。辞書の厚さに依存する。
  - 部品の種類ごとの辞書は一般の仕組みだが、場面ごとに規則を足し始めると、チームの「場当たり的な直しをしない」方針に反する。規則は場面に依らない数個に保ち、差は辞書（データ）に寄せる。
  - 文字起こしの誤り（girl → car）にはどの方式も弱い。担当 5 の範囲。場面の語彙が分かっているので、音の近い場面の語への寄せ（例 car → girl）は決まった手順で試せる余地がある（未検証）。
  - 人の判定との一致は未確認。SPICE の文単位の Kendall τ は 0.45（人どうし 0.73）と高くない。ただしこれは語彙が開いた説明文での値で、このアプリは語彙が閉じ、文が単純なので、もっと高くなる見込み（推定）。
- **見せ方**: 「言えた項目 4/6」「男の子 → 走っている ✓、犬 → 男の子を見ている ✓、ベンチ → 木の下 ✗」。チェックリストの画面と同じ形で、根拠の語を下線で示せる。

### 案 C: 案 B で決まらない描写だけ、埋め込み・NLI で補う（任意）
- **中身**: 案 B で一致度が中間（例 0.25〜0.75）の描写だけを、2 段で見る。
  - (a) 物の名前の言い換えは、Workers AI の `bge-small-en-v1.5` で語句の cosine を見る。
  - (b) 文としての含意・矛盾は NLI（`nli-deberta-v3-small/base`）で見る。前提は `accept` の文、仮説は発話の節。
  - 役割と位置は、案 B の規則の結果を優先し、NLI に任せない（HANS・SpaceNLI の弱点）。
- **効き目**: 言い換えの見逃しを減らす。LLM より安く、温度が無いので、同じ入力なら同じ出力（GPU の浮動小数の差はほぼ無視できる見込み）。
- **手間**:
  - 埋め込みは Workers から呼ぶだけ。
  - NLI は Workers AI に無いので、Cloudflare Containers（2026-04-13 に一般提供。10 ms 単位で課金）で Python のサーバーを立てる。冷えた状態からの起動は「多くは 1〜3 秒。イメージの大きさと起動の処理による」（Containers の FAQ、https://developers.cloudflare.com/containers/faq/ 、2026-11-16 に確かめた）。
  - 閾値を合わせるための評価の組が要る。
- **費用**: Containers の CPU は 1 vCPU 秒あたり $0.000020（Workers Paid は月 375 vCPU 分まで込み。公式の料金の頁 [S54] で確かめた）。1 回 2 秒なら約 $0.00004 で、ほぼ 0。埋め込みの `bge-small-en-v1.5` は 100 万 token あたり $0.020（Workers AI の料金の頁、https://developers.cloudflare.com/workers-ai/platform/pricing/ 、2026-11-12 更新の版で確かめた）。短い句なので小さい。
- **リスク**: 閾値の調整が新たな「見えないロジック」になる。cosine の閾値は説明しにくい。否定・数・左右に弱い。

### 案 D: 文法は「級のねらいの形」の使えた数・正しかった数を規則で数える（推奨）
- **中身**: CEFR-J Grammar Profile と同じく、品詞の並びに正規表現を当てる。級ごとに数える形を決める。
  - 3 級: `be + V-ing` の進行形、`There is/are + 名詞` の数の一致、場所の前置詞。
  - 準 2 級: 3 級の形に加えて、`because + 主語 + 動詞`。
  - 2 級: 準 2 級の形に加えて、`so + 節`、目的の `to + 原形`。
  - 「使えた」と「正しく使えた」を分けて数える。誤りの例は、be の抜け（A boy running）・数の不一致（Two dogs is）・because のあとに節が無い（because the dog）。品詞は場面の語彙の辞書と、少数の機能語の表で決まる。
  - 「表現」の点のうち文法の部分を、これに置き換えるか、LLM の段階の付け方の根拠として渡す。
- **効き目**:
  - 級のお題に直結する。英検の評価の観点の「文法・語法」と、お題の「なぜ？・結果や目的」に沿う。
  - 決まった手順で説明できる。
  - 規則ベースでも、形で決まる構文なら LLM と競える（Bannò et al. 2026）。
- **手間**: TypeScript で数日（推定）。形ごとの単体テスト。
- **費用**: 0。
- **リスク**:
  - 文字起こしが機能語（is・a）を落としたり足したりすると、偽の誤りになる。文字起こしの言語モデルが学習者の誤りを直してしまう可能性もある（担当 5 と共同で測る必要がある。未確認）。
  - 規則の外の正しい言い方（"The boy runs"）を減点しない設計にする。数えるのは「ねらいの形の加点」だけにして、減点はしない。
- **見せ方**: 「is + ing の形 3/3 回正しい」「because で理由を言えた ✓」「so で結果をつなげよう（次の目標）」。

### 案 E: GEC のモデル + ERRANT で誤りの数・種類を出す（今は勧めない）
- **中身**: Containers に spaCy・ERRANT・GECToR などの GEC のモデルを置き、100 語あたりの誤り・EFC%・誤りの種類を出す。
- **効き目**: 誤りの種類まで決まった手順で出せる。
- **手間**: Python の環境づくり、言いよどみの除去（S&I の基準と同じ 3 段の流れ）、評価。1〜2 週間以上（推定）。
- **費用**: 実行の費用は小さい（Containers）。
- **リスク**: 話し言葉では検出の再現率 0.08・F0.5 0.22 の水準（S&I 2025 の基準）。20 秒の応答では EFC% が 17〜33% 刻みと粗い。文字起こしの誤りが学習者の誤りに見える。**点に入れると、見えないぶれの源が LLM から GEC に移るだけになりうる**。研究・振り返りの表示（「直すならこう」）には使える。

### 案 F: 語彙の多様さ・語彙のレベル・統語の複雑さの比率は点にしないことを勧める（表示だけなら可）
- **理由**:
  - MTLD・MATTR は 50 語未満が前提の外。3 級の答えは 20 語前後。
  - 語彙のレベルは、このアプリでは場面の名詞で決まり、級で変わらない（模範文で A1 の割合が 0.91〜0.92）。
  - C/T・DC/C などの比率は節の切れ目の推定に左右される（自動の切れ目で r ≈ .2）。
  - 指標が課題を覚える（Güçer et al. 2026）。このアプリは級ごとにお題も場面も違うので、級の間の比較では特に混ざりやすい。
- **表示の例**（任意）: CEFR-J で A2 以上の語を使えたら「bench（A2）を使えた」と褒める。CEFR-J は出典を書けば商用で無料。
- **例外**: 「because・so・to でつないだ節の数」と「話した語数」は、級のお題そのものなので案 D・案 B の中で数える。

### 案 G: 指標の組み合わせ方
- **人の点のデータが無い今**: 指標ごとに、級ごとの目安で 0〜100 に直す区分線形（下限で 0、目安で 100、間は直線）にし、決まった重みで足す。
  - 例: 3 級の speech rate の下限 40 語/分 → 0 点、目安 110 語/分 → 100 点。95 語/分なら (95 − 40)/(110 − 40) × 100 = **79 点**。
  - 目安の数値は仮の値。Tavakoli 2020 は音節/分で A2 73・B1 135 なので、語/分に直すには 1 語あたりの音節の数（単純な英語で 1.2〜1.4 ほどと推定）で割る。手元のデータで合わせ直す。
- **人の点のデータが揃ったら**（担当 2）: 非負の最小二乗、または係数を正に限った LASSO で重みを合わせる（Loukina 2015 で、制約の損は r .02）。点への直し方は単調な関数（isotonic 回帰など）にする。
- **説明のしやすさ**: 「合計 = 0.5 × 内容 + 0.25 × 表現 + 0.25 × 話し方。話し方 = 速さ 40% + 続けて言えた長さ 30% + 発音の正確さ 30%」のように、式と各指標の値を画面に出せる。力の差がある人どうしの競争（家族の例）には、級ごとの目安に対する達成率で比べる形が作りやすい（製品の設計は担当 6）。

### まとめの表

| 案 | 効き目 | 手間 | 費用 | 主なリスク | 動かす場所 | プレイヤーへの見せやすさ |
|---|---|---|---|---|---|---|
| A 流暢さ（時刻） | 高い（r .72〜.76） | 小（数十〜100 行） | 0 | 短い答えで値が動く・速さの誘惑 | Workers（Azure の応答） | ◎ 語/分・続けて言えた語数 |
| B 内容（組の一致） | 高い（ぶれ 0・根拠が見える） | 中（1〜2 週間） | ほぼ 0 | 言い換えの見逃し | Workers | ◎ 項目と根拠の語 |
| C 埋め込み・NLI の補い | 中（言い換えを拾う） | 中 | 小 | 閾値が見えにくい・役割と左右に弱い | Workers AI と Containers | △ |
| D 級のねらいの形 | 中〜高（お題に直結） | 小（数日） | 0 | 文字起こしが機能語を落とす | Workers | ◎ 3/3 回正しい |
| E GEC + ERRANT | 低い（話し言葉で再現率 .08） | 大 | 小 | ぶれの源が移るだけ | Containers | △ |
| F 多様さ・語彙・統語の比率 | 低い（短い・課題に引きずられる） | 小 | 0 | 点にすると不公平 | Workers | ○（褒める表示だけ） |
| G 正の重みの線形和 | 説明の土台 | 小 | 0 | 目安の値の根拠が要る | Workers | ◎ 式を出せる |

端末（iOS）について: NaturalLanguage の NLTagger（品詞・見出し語。iOS 12 以降）、Core ML の NLI、SpeechAnalyzer の時刻は、どれも端末で動かせる。ただし、指摘のあった「端末で結果が違うと不公平」を避けるには、採点の計算をサーバーに集めるのがよい。端末は音声と（必要なら時刻つきの）文字起こしを送る役にとどめる。

---

## 不確かな点・残る問い

- **このアプリの発話での妥当性は、どの指標も未確認**。文献の値は TOEFL・Aptis・成人・1 分の応答などの条件による。日本の中高生・20 秒・場面の描写では、人の点（または講師の点）との相関を担当 2 のデータで測る必要がある。特に次の 2 つ。
  - 案 A の目安の値（語/分）
  - 案 B の判定と、人や LLM の判定との一致率
- 案 B の言い換えの網羅は、辞書づくりの手間と見逃しの率の兼ね合い。どこまで辞書で、どこから C（埋め込み・NLI）か LLM に回すかの線は、データで決める必要がある。
- 文字起こし（SpeechAnalyzer と Azure）が、学習者の文法の誤りをどれだけ「直して」しまうか。案 D の正確さの数え上げの前提に関わる（担当 5 と共同）。
- Azure の単語の時刻の精度（正解文を端末の文字起こしにしたとき、文字起こしの誤りで時刻がずれるか）は未確認（実測の問い）。音節の結果は `Granularity: "Phoneme"` で返り、en-US だけ（3.5 で確かめた）。
- FACTUAL・DiscoSG の解析器が、学習者の誤りを含み句読点の無い文でどれだけ崩れるかは未確認。作り置きの模範文を組にする用途（オフライン）なら使える見込み。
- 確かめられなかった数値: Iwashita et al.（2008、Applied Linguistics 29(1)、https://doi.org/10.1093/applin/amm017 ）のレベルごとの特徴と、c-rater（Leacock & Chodorow 2003）の一致率。どちらも原典を探したが開けなかった（有料の誌で、自動の取得では本文が読めない）。EVP の利用の条件も開けなかった。
- 2026-11-16 に確かめたもの: vocd-D の最小の長さ（3.4）、SpeechRater 5.0 の人との一致（3.6）、NGSL 本体のライセンス（3.4。CC の版は頁に無い）、Containers の冷えた起動の時間と Workers AI の埋め込みの料金（案 C）。
- Somasundaran & Chodorow（2014、BEA、https://aclanthology.org/W14-1801.pdf ）は 2026-11-16 に原典で確かめた。ETS の「絵を見て、指定の 2 語を使って 1 文を書く」課題の自動採点で、規則と統計のモデルを組み合わせ、絵の説明の文との一致も特徴に使う。正解率は機械 76.23%・人どうし 86%、QWK は機械と人 0.63・人どうし 0.83。絵の描写の内容を機械で判定する近い先例だが、1 文・書き言葉で、人どうしとの差は 10 ポイント残った。
- 3 級（A1）は、流暢さの文献（多くは A2 以上）の範囲の下限より下になる。A1 での指標の振る舞いは文献が乏しい。

---

## 出典の一覧

- [S1] Anderson, P., Fernando, B., Johnson, M., Gould, S. (2016). SPICE: Semantic Propositional Image Caption Evaluation. ECCV 2016, LNCS 9909, 382–398. https://arxiv.org/abs/1607.08822
- [S2] Li, Z., Chai, Y., Zhuo, T. Y., Qu, L., Haffari, G., Li, F., Ji, D., Tran, Q. H. (2023). FACTUAL: A Benchmark for Faithful and Consistent Textual Scene Graph Parsing. Findings of ACL 2023. https://arxiv.org/abs/2305.17497
- [S3] FactualSceneGraph（GitHub、MIT）. https://github.com/zhuang-li/FactualSceneGraph ／ モデル https://huggingface.co/lizhuang144/flan-t5-base-VG-factual-sg
- [S4] Lin, S., Teng, C., Li, F., Ji, D., Qu, L., Li, Z. (2025). DiscoSG: Towards Discourse-Level Text Scene Graph Parsing through Iterative Graph Refinement. EMNLP 2025. https://aclanthology.org/2025.emnlp-main.398/ （速さと SPICE の数値は、2026-11-16 に原典の要旨と序論で確かめた。https://aclanthology.org/2025.emnlp-main.398.pdf ）
- [S5] Dong, H. et al. (2024). Benchmarking and Improving Detail Image Caption（CAPTURE）. https://arxiv.org/abs/2405.19092
- [S6] PoSh: Using Scene Graphs to Guide LLMs-as-a-Judge for Detailed Image Descriptions (2025). https://arxiv.org/abs/2510.19060
- [S7] King, L., Dickinson, M. (2016). Shallow Semantic Reasoning from an Incomplete Gold Standard for Learner Language. BEA 2016, 112–121. https://aclanthology.org/W16-0512/
- [S8] King, L., Dickinson, M. (2018). Annotating picture description task responses for content analysis. BEA 2018, 101–109. https://aclanthology.org/W18-0510/
- [S9] cross-encoder/nli-deberta-v3-base（モデルカード）. https://huggingface.co/cross-encoder/nli-deberta-v3-base
- [S10] cross-encoder/nli-deberta-v3-small（モデルカード）. https://huggingface.co/cross-encoder/nli-deberta-v3-small
- [S11] McCoy, R. T., Pavlick, E., Linzen, T. (2019). Right for the Wrong Reasons: Diagnosing Syntactic Heuristics in Natural Language Inference. ACL 2019, 3428–3448. https://arxiv.org/abs/1902.01007
- [S12] Abzianidze, L., Zwarts, J., Winter, Y. (2023). SpaceNLI: Evaluating the Consistency of Predicting Inferences in Space. NALOMA 2023. https://arxiv.org/abs/2307.02269
- [S13] Kamath, A., Hessel, J., Chang, K.-W. (2023). What's "up" with vision-language models? Investigating their struggle with spatial reasoning. https://arxiv.org/abs/2310.19785
- [S14] Laban, P., Schnabel, T., Bennett, P., Hearst, M. (2022). SummaC: Re-Visiting NLI-based Models for Inconsistency Detection in Summarization. TACL 10. https://arxiv.org/abs/2111.09525
- [S15] Zha, Y., Yang, Y., Li, R., Hu, Z. (2023). AlignScore: Evaluating Factual Consistency with a Unified Alignment Function. ACL 2023. https://arxiv.org/abs/2305.16739
- [S16] Jina AI（ブログ、2024-12-17）. Text Embeddings Fail to Capture Word Order and How to Fix It. https://jina.ai/news/text-embeddings-fail-to-capture-word-order-and-how-to-fix-it
- [S17] Towards preserving word order importance through Forced Invalidation. EACL 2023. https://aclanthology.org/2023.eacl-main.187
- [S18] Omelianchuk, K., Atrasevych, V., Chernodub, A., Skurzhanskyi, O. (2020). GECToR – Grammatical Error Correction: Tag, Not Rewrite. BEA 2020, 163–170. https://arxiv.org/abs/2005.12592
- [S19] Crossley, S. A., Bradfield, F., Bustamante, A. (2019). Using human judgments to examine the validity of automated grammar, syntax, and mechanical errors in writing. Journal of Writing Research, 11(2), 251–270. https://jowr.org/jowr/article/download/591/487
- [S20] Wikimedia Phabricator T305180（LanguageTool の評価、内部の記録）. https://phabricator.wikimedia.org/T305180
- [S21] Bryant, C., Felice, M., Briscoe, T. (2017). Automatic Annotation and Evaluation of Error Types for Grammatical Error Correction. ACL 2017. https://aclanthology.org/P17-1074/ （今回は開いていない。内容は既知の事項）
- [S22] Qian, M. et al. (2024). Speak & Improve Challenge 2025: Tasks and Baseline Systems. https://arxiv.org/abs/2412.11985
- [S23] (2025). arXiv 2506.18532（話し言葉の GEC のフィードバックの評価で、文字起こしの誤りから生まれる偽の編集を除く）. https://arxiv.org/abs/2506.18532
- [S24] Bannò, S., Ma, R., Qian, M., Knill, K., Gales, M. (2023). Towards End-to-End Spoken Grammatical Error Correction. https://arxiv.org/abs/2311.05550
- [S25] Foster, P., Tonkyn, A., Wigglesworth, G. (2000). Measuring spoken language: a unit for all reasons. Applied Linguistics, 21(3), 354–375. https://findanexpert.unimelb.edu.au/scholarlywork/1065275-measuring-spoken-language--a-unit-for-all-reasons
- [S26] McCarthy, P. M., Jarvis, S. (2010). MTLD, vocd-D, and HD-D: A validation study of sophisticated approaches to lexical diversity assessment. Behavior Research Methods, 42(2), 381–392.（TAALED の文書から引用）
- [S27] TAALED（PyPI の文書。最小の長さの目安の表）. https://pypi.org/project/taaled/ ／ Zenker, F., Kyle, K. (2021). Investigating minimum text lengths for lexical diversity indices. Assessing Writing, 47, 100505.
- [S28] Kyle, K., Sung, H., Eguchi, M., Zenker, F. (2024). Evaluating evidence for the reliability and validity of lexical diversity indices in L2 oral task responses. SSLA, 46(1), 278–299. https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/abs/evaluating-evidence-for-the-reliability-and-validity-of-lexical-diversity-indices-in-l2-oral-task-responses/E51955F0291E21A916CD2C4787508B80
- [S29] Koizumi, R., In'nami, Y. (2012). Effects of text length on lexical diversity measures: Using short texts with less than 200 tokens. System, 40(4), 554–564.（要約は二次の出典 https://perso.uclouvain.be/yves.bestgen/images/LL24.pdf などによる）
- [S30] CEFR-J ダウンロードの頁（Wordlist 1.6、Grammar Profile、利用の条件）. https://www.cefr-j.org/download.html
- [S31] Open Language Profiles: olp-en-cefrj（CEFR-J Vocabulary Profile 1.5 の CSV）. https://github.com/openlanguageprofiles/olp-en-cefrj
- [S32] New General Service List（公式）. https://www.newgeneralservicelist.com/ ／ NGSL-Spoken https://www.newgeneralservicelist.com/ngsl-spoken
- [S33] 旺文社 英検の CSE スコアと CEFR の対照（2024）. https://eic.obunsha.co.jp/file/exam_info/2024/0311.pdf
- [S34] GrammarTagger: A Multilingual, Minimally-Supervised Grammar Profiler for Language Education (2021)（Ishii & Tono 2018 の方式の説明）. https://arxiv.org/abs/2104.03190
- [S35] BEA 2024: English Grammar Profile を使った文法の制御の研究（EGP は 1,222 構文）. https://aclanthology.org/2024.bea-1.24.pdf
- [S36] Bannò, S., Karanasou, P., Knill, K., Gales, M. (2026). Exploiting the English Grammar Profile for L2 grammatical analysis with LLMs. https://arxiv.org/abs/2603.17171
- [S37] Lu, X. (2010). Automatic analysis of syntactic complexity in second language writing. International Journal of Corpus Linguistics, 15(4).（指標の一覧は https://en.wikipedia.org/wiki/L2_Syntactic_Complexity_Analyzer ）
- [S38] Chen, M., Zechner, K. (2011). Computing and Evaluating Syntactic Complexity Features for Automated Scoring of Spontaneous Non-Native Speech. ACL 2011, 722–731. https://aclanthology.org/P11-1073/
- [S39] Güçer, E., Akef, S., Meurers, D. (2026). Poor Generalisation of Proficiency Classifiers Trained on Linguistic Complexity Features to New Writing Tasks. NLP4CALL 2026. https://aclanthology.org/2026.nlp4call-1.24.pdf
- [S40] Kyle, K., Crossley, S. A. (2015). Automatically Assessing Lexical Sophistication: Indices, Tools, Findings, and Application. TESOL Quarterly, 49(4), 757–786. https://soletlab.asu.edu/taales/
- [S41] Suzuki, S., Kormos, J., Uchihara, T. (2021). The Relationship Between Utterance and Perceived Fluency: A Meta-Analysis of Correlational Studies. Modern Language Journal, 105(2), 435–463. https://eprints.lancs.ac.uk/id/eprint/152963
- [S42] Bosker, H. R., Pinget, A.-F., Quené, H., Sanders, T., de Jong, N. H. (2013). What makes speech sound fluent? The contributions of pauses, speed and repairs. Language Testing, 30(2), 159–175. https://hrbosker.github.io/publication/bosker-etal-2013-lt
- [S43] Tavakoli, P., Nakatsuhara, F., Hunter, A.-M. (2020). Aspects of fluency across assessed levels of speaking proficiency. Modern Language Journal, 104(1), 169–191. https://centaur.reading.ac.uk/84796/
- [S44] Saito, K., Ilkan, M., Magne, V., Tran, M. N., Suzuki, S. (2018). Acoustic characteristics and learner profiles of low-, mid- and high-level second language fluency. Applied Psycholinguistics, 39(3), 593–617. https://discovery.ucl.ac.uk/10066019/1/AP2018.pdf
- [S45] Bibauw, S., François, T., Desmet, P. (2021). Automatizing L2 fluency measurement: validity and developmental sensitivity of temporal fluency metrics variations. AILA 2021. https://sbibauw.github.io/talks/2021/aila
- [S46] de Jong, N. H., Pacilly, J., Heeren, W. (2021). PRAAT scripts to measure speed fluency and breakdown fluency in speech automatically. Assessment in Education: Principles, Policy & Practice. https://doi.org/10.1080/0969594X.2021.1951162 （題名・誌・著者は Crossref で 2026-11-16 に確かめた。内容は Web 検索の結果の要約による。本文は未確認。原典を探したが開けなかった（有料の誌））
- [S47] Microsoft Learn: Use pronunciation assessment（FluencyScore の定義、Offset/Duration、UnexpectedBreak の閾値 0.75、30 秒の制限）. https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment
- [S48] Microsoft Learn: Speech to text REST API for short audio. https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short
- [S49] Apple Developer: SpeechTranscriber.ResultAttributeOption（audioTimeRange）. https://developer.apple.com/documentation/speech/speechtranscriber/resultattributeoption
- [S50] Apple Developer Forums: audioTimeRange would still be interesting for .volatileResults in SpeechTranscriber. https://developer.apple.com/forums/thread/794510
- [S51] Loukina, A., Zechner, K., Chen, L., Heilman, M. (2015). Feature selection for automated speech scoring. BEA 2015, 12–19. https://aclanthology.org/W15-0602/
- [S52] Chen, L. et al. (2018). Automated Scoring of Nonnative Speech Using the SpeechRater v. 5.0 Engine. ETS RR-18-10. https://doi.org/10.1002/ets2.12198
- [S53] Cloudflare Workers AI: モデルの一覧（埋め込み・reranker。NLI は無し）. https://developers.cloudflare.com/workers-ai/models/
- [S54] Cloudflare: Containers and Sandboxes are now generally available（2026-04-13）. https://developers.cloudflare.com/changelog/2026-04-13-containers-sandbox-ga ／ 料金 https://developers.cloudflare.com/containers/pricing/
- [S55] wink-pos-tagger（WSJ22-24 で 93.2%、525,000 語/秒）. https://github.com/winkjs/wink-pos-tagger
- [S56] Apple Developer: NLTagScheme（lexicalClass・lemma、iOS 12 以降）. https://developer.apple.com/documentation/naturallanguage/nltagscheme
