# 5. 音声の入力と、端末による差の公平さ

> 調査メモ（2026-11-16）。担当 5。採点の前の段階（録音 → 文字起こし → 採点に渡す）を扱う。ルーブリック・データセット・文法と語彙の指標・LLM の採点・製品は、ほかの担当の範囲なので扱わない。
> ベンダーごとの WER と料金の比較は repo の `docs/design/speech-scoring-research.md` の「3. 文字起こし」にあるので繰り返さない。
> 数字には、出典の条件（データ・話者・課題）を添える。確かめられなかったことは「未確認」と書く。Web 検索の回数の上限に達したため、最後の数件（Koenecke 2020 など）は原典を開けていなかった。2026-11-16 に原典で確かめ直し、開けたものは本文に反映した。残る「未確認」は、原典を開けなかったものか、測らないと分からないもの。

## 問い

1. 第二言語の学習者（特に日本語を母語とする人）の英語で、文字起こしはどれくらい、どう誤るか。その誤りは自動採点の点をどれくらい動かすか。
2. 場面の部品の名前（girl・dog・bench など）を認識のヒントとして渡すと、誤りは減るか。Apple・Azure・Whisper で何ができるか。言っていない語が出てしまう（水増しの）危険はどれくらいか。
3. 端末による差をどう無くすか。SpeechAnalyzer は端末や OS の版でモデルや精度が違うのか。古い iPhone で使えるか。
4. 文字起こしの誤りに強い採点をどう作るか（確信度・N-best・音の近さ・言いよどみの扱い）。
5. 学習者の声に合わせたファインチューンは、どれくらいのデータで、どれくらい効くか。端末で動く小さなモデルは何があるか。
6. このアプリでは、どの案を、どこに（iOS / Workers / 別のサーバー）、どの順で入れるか。公平さをプレイヤーにどう説明するか。

## 結論

1. **日本人学習者の自由発話の WER は 20% 前後で、母語話者の約 1.5〜2 倍。力の低い人ほど誤りが増える。** ICNALE の 60 秒の独話（日本人 107 人、電話の音声）で、Google・Rev・Whisper large-v3 の WER は 20.7〜23.8%、母語話者は 11.9〜13.8%（Koizumi 2024）。英国の BULATS の試験では、WER は A1 で 43.7%、C で 21.2%（Knill ほか 2018）。Speak & Improve でも、Whisper-small は A2 で約 17%、C1 で 8% 未満（Sun ほか 2025）。**誤りの起き方に力の差があるので、文字起こしの誤りは、力の低い人を二重に不利にする。**
2. **今の作りには、端末によって採点の道筋が変わる所が 3 つある（repo を読んで見つけた）。** (a) SpeechTranscriber が使えない端末（iPhone 11 系・SE 第 2 世代は使えないという開発者の報告）、音声モデルがまだ入っていない端末、文字起こしの失敗・空の結果・5 秒の時間切れのときは、Azure の文字起こしに切り替わる。(b) 端末の文字起こしがあると Azure の発音評価は正解文ありの評価（scripted）、無いと正解文なしの評価（unscripted）になる。Microsoft は、正解文なしの評価は別の認識モデルを使うと書いている。つまり話し方の 25% も、端末で評価の方式が変わる。(c) 文字起こしは端末が `X-Transcript` で送り、サーバーはそのまま信じる。作り替えた文字起こしを送ることもできてしまう。**いちばん効くのは、全員の WAV を同じサーバーの同じ設定で文字にすることで、手間も小さい**（WAV はもう全員分サーバーに届いている）。マイクの差は残るので、録音の条件もそろえる（`AVAudioSession` の `.measurement` モード、音量の正規化、話す前のマイクの確かめ）。iPhone X は iOS 26 を入れられない（二次情報。下の 3 節）ので、このアプリはそもそも入らない。心配すべき差は「iPhone 11・SE 第 2 世代」と「12 以降」の間にある。
3. **チェックリストの F1 は、1 語の聞き違いに弱い。** 「A girl is running」が「A car is running」になると、中心の項目を落とし（再現率 R が下がる）、場面に無い物を言った誤り（適合率 P が下がる）も増える。3 級の例で、内容は 100 点から 63 点に下がる（下の手計算）。ETS の要点（key point）の検出は WER 18.5% でも人の書き起こしと同じ性能だったが（Yoon ほか 2019）、それは複数の語で要点を判定したからで、このアプリの項目は名詞 1 語で決まることが多い。**直し方は、「聞き取りに自信の無い語は、減点の根拠にしない」をコードで決めること。** 確信度（SpeechTranscriber は `transcriptionConfidence` と `alternativeTranscriptions` を返せるのに、今の `.transcription` の preset では使っていない）と、音の近さ（音素の編集距離。日本語話者に多い取り違えの重みを付ける）を使う。確信度 0.9 以上の語だけを使うと、発音の誤りのある語の WER は 29.0% から 7.3% に下がった（Knill ほか 2018）。
4. **部品の名前をヒントとして渡す案は、今の構成では使えず、使うなら水増しへの備えが要る。** SpeechTranscriber は `contextualStrings` を使わない（Apple の担当者の回答、2026-01）。使えるのは古いモデルの DictationTranscriber だけ。Azure の phrase list は、今呼んでいる短い音声用の REST に無く、Fast transcription の REST や SDK にある。Workers AI の Whisper は `initial_prompt`、Deepgram Nova-3 は `keyterm` を受け付ける。ヒントの語は言っていなくても出やすくなるので、そのまま点に使うと「場面の語が勝手に出て当たる」水増しになる。入れるなら、場面に無い音の近い語（例: girl に対して car・curl・gal）を混ぜ、ヒントありとなしの結果が食い違った語は「聞き取りが分かれた」として扱う。
5. **ファインチューンは今は勧めない。効くが、データの偏りで公平さを悪くしうる。** Speak & Improve の約 28 時間で Whisper-small を LoRA で学習すると、全体の WER は 10.2% → 9.2% に下がったが、A2 の WER は相対で約 20% 上がった（Sun ほか 2025）。チームの録音（大学生）で学習すると、同じことが中高生や力の低い人に起きうる。日本の中高生の英語の書き起こしつき音声が数時間〜数十時間要り、学習したモデルを動かす GPU のサーバー（Workers AI では動かせない。LoRA を載せられるのは LLM 向けの決まったモデルだけで、Whisper は無い。2026-11-16 に Cloudflare の文書で確かめた）か、WhisperKit で端末に載せる作りが要る。先に、測る仕組みと、誤りに強い照合を入れるべき。
6. **公平さの説明は「全員同じ AI で文字にし、聞き取りの自信が無い語では減点しない。端末の差は X 本の録音で測って Y ポイント以内」と、数字で言えるようにする。** そのために、端末の型番・OS の版・文字起こしの出どころを採点のログに残し、同じ録音を端末ごとに文字にして比べる測り方を先に作る。

## 調べたこと（出典ごと）

### 0. 今の作り（repo を読んだこと）

| 段階 | 今の作り | 端末の差が入る所 |
| --- | --- | --- |
| 録音 | `VoiceRecorder.swift`。`AVAudioRecorder` で WAV（16 kHz・16 bit・モノラル）、最長 20 秒。`AVAudioSession` は `.playAndRecord`・`.default` モード・`.defaultToSpeaker`。音量メーターあり（-50〜-10 dB を 0〜1 に） | `.default` モードでは、端末が自動の音量調整などの処理をかける（下の Apple の文書）。マイクの性能と処理は機種で違う |
| 文字起こし | `DeviceTranscriber.swift`。`SpeechTranscriber(locale: en-US, preset: .transcription)` に WAV を渡す。5 秒で時間切れ。使えない・失敗・時間切れは nil | 使えない端末・音声モデルがまだ入っていない端末・失敗・空の結果・時間切れのときに、Azure の文字起こしになる |
| 送信 | `LiveGameClient.finishSpeaking`。文字起こしが返るまで（最長 5 秒）待ってから、WAV と `X-Transcript` を送る | 端末の文字起こしの待ちが、そのまま結果の遅れになる |
| 話し方 | `backend/src/scoring/azure.ts`。端末の文字起こしを `ReferenceText` に入れる。空なら正解文なしの評価。`EnableMiscue: false` | 文字起こしの有無で、評価の方式（scripted / unscripted）が変わる |
| 内容・表現 | `backend/src/scoring/index.ts`。端末の文字起こしがあればそれ、無ければ Azure の文字起こしを Claude に渡す。指示は "The input is an automatic transcript, so ignore punctuation and small recognition errors."（`checklistGrade.ts`） | 誤りの扱いは Claude の判断まかせ |
| ログ | `scoring_timing` に `transcriptSource`（device / azure）と `azureTranscript` を残す | 端末の型番と OS の版は残していないので、端末ごとの差をログから出せない |

- 端末の文字起こしは `X-Transcript` のまま信じて使う（`routes/rounds.ts` の `decodeTranscript` は長さと復号しか見ない）。公平さの面では、作り替えた文字起こしを送られる余地になる。
- アプリの対象は iOS 26.0 以上（`ios/project.yml` の `deploymentTarget`）。

### 1. 学習者の英語での、文字起こしの誤りの大きさと傾向

**Koizumi (2024)「Accuracy of Automatic Speech Recognition in L2 Learners' Spontaneous Speech」**（外国語教育メディア学会中部支部研究紀要 35、https://www.jstage.jst.go.jp/article/letcj/35/0/35_15/_pdf ）
- データ: ICNALE の Spoken Monologues。日本人 107 人（TOEIC 平均 686、CEFR A2 16 人・B1 62 人・B2 29 人）の 60 秒の独話 214 本と、母語話者 50 人の 100 本。話題はアルバイトと禁煙。国際電話で録った MP3（44.1 kHz・32 kbps）で、匿名化のために声の高さを変えてある。
- WER（小文字化・フィラーと句読点を除いた「Normalized」）: 母語話者は Google 13.8%・Rev 12.7%・Whisper large-v3 11.9%。日本人は 20.7%・21.3%・23.8%。
- 言いよどみ（フィラー・繰り返し・言い直し）を GPT-4o で除いた参照文と比べると（Pruned-Normalized）、Whisper が最もよく 18.8%。
- CEFR 別（Normalized）: A2 25.4%、B1 21.5%、B2 21.1%。ただし統計モデルでは、力の差は有意でなかった（A2 が 16 人と少ない）。
- 誤りの典型: 学習者の文法の誤りを、文字起こしが「直して」しまう。名詞の形の誤り（例: many student）を直した割合は Google 57.6%・Rev 55.8%・Whisper 98.9%、動詞は 51.1%・38.5%・86.2%。
- 言いよどみの除去: GPT-4o に段階を決めた指示（フィラー → 繰り返し → 言い直しの順で消す）で消させると、F 値 0.949。
- 先行研究の紹介として: 30 人の学習者を 5 つのアプリ（Apple Dictation を含む）で比べた Hirai & Kovalyova (2024) では、正しく認識できた語の割合が、話の再生（retelling）で 57.60%、質問への自由な答えで 64.41%（Koizumi 2024 の紹介の文で確かめた。原典の Language Learning & Technology 28(1)、https://hdl.handle.net/10125/73555 は、ScholarSpace がブラウザの確認で取得を拒み、開けなかった）。

**Knill ほか (2018)「Impact of ASR performance on free speaking language assessment」**（Interspeech 2018、DOI 10.21437/Interspeech.2018-1312、https://eprints.whiterose.ac.uk/152761/ ）
- データ: BULATS の試験（A1〜C、多くの母語）。評価は 226 人。
- 2 つの文字起こし（WER 47.5% と 30.4%）で、音声と流暢さの特徴量による採点の人との相関は、どちらも PCC 0.854 で変わらなかった。品詞の特徴量を足すと、WER の低い方だけ 0.865 に上がった。話題から外れた答えの検出も、WER の低い方が良かった（0.949 → 0.976 など）。
- 力ごとの WER（1,043 の答え）: A1 43.7%（置換 18.2・脱落 19.9・挿入 5.5）、A2 32.2%、B1 25.1%、B2 23.7%、C 21.2%。
- 確信度で絞る効果: 発音の誤りのある語の WER は 29.0%、確信度 0.9 以上の語だけでは 7.3%。全部の語では 22.7% → 3.4%。結論は「最も確信のある語に絞って講評すれば、文字起こしの誤りによる誤った講評を減らせる」。

**Qian ほか (2024)「Speak & Improve Challenge 2025: Tasks and Baseline Systems」**（https://arxiv.org/abs/2412.11985 ）
- データ: Speak & Improve の約 315 時間（A2〜C1、多くの母語）。手で書き起こした部分は約 55 時間で、言いよどみと文法の訂正の注釈つき。日本人の学習者のコーパスとして KISTEC（KIT Speaking Test Corpus）も挙げている。
- 文字起こしの基準（Whisper small）: dev で WER 10.4%（置換 4.9・脱落 4.0・挿入 1.5）。評価は Speech WER（SpWER）で、言いよどみは 1 つの記号にまとめ、消しても誤りに数えない。
- 文字起こし → BERT の採点の基準: PCC 0.746、RMSE 0.445。

**Sun, Zhu, Shi (2025)「Proficiency-Aware Adaptation and Data Augmentation for Robust L2 ASR」**（ICASSP 2026 に投稿、https://arxiv.org/abs/2510.10738 ）
- Whisper-small のそのままの WER は A2 で約 17%、C1 で 8% 未満。
- 学習 28.2 時間で LoRA をそのままかけると、全体は 10.2% → 9.2% に下がるが、A2 の WER は相対で 20%（dev）・21%（eval）上がる。A2 の挿入の誤りは 7.34%・7.69% に増える。
- 力の分類を同時に学習し、力の低い人の音声だけ SpecAugment で増やすと、全体 7.2% まで下がり、力の差も縮む。

**Balaji Shankar ほか (2025)「Leveraging ASR and LLMs for Automated Scoring and Feedback in Children's Spoken Language Assessments」**（SLaTE 2025、http://www.seas.ucla.edu/spapl/paper/balaji_slate2025_llm.pdf ）
- データ: 米国の小 3〜中 2（184 人、約 16 時間）の話の再生（Test of Narrative Language）。決まった語（登場人物・物・動作など）を言えたかを数える採点で、このアプリのチェックリストに近い。母語は英語（アフリカ系米国英語を含む）で、学習者ではない。
- WER: ElevenLabs 11.4%、Rev 12.1%、Gemini 12.3%、AWS 13.1%、Deepgram 13.3%、Azure 15.3%、GPT-4o 21.0%、Whisper large-v3 24.5%。上位 5 つの結果を Flan-T5 で融合すると 11.0%。
- 融合の後も群の差が残る: アフリカ系米国英語 11.7% と それ以外 9.8%、読みと言語の障害あり 13.6% と なし 8.2%。
- LLM（o3）の採点の一致率は、文字起こし 86.96%、人の書き起こし 88.04% と差が小さい。プロンプトに「よくある聞き違いの例」を入れ、発音の誤りや小さな認識の誤りに寛容に採点するよう指示したためと著者は見ている。ただし群によっては、人の書き起こしにしても一致率が上がらなかった（採点の側にも偏りがある）。

**Yoon ほか (2019)「Toward Automated Content Feedback Generation for Non-native Spontaneous Speech」**（BEA 2019、https://aclanthology.org/W19-4432.pdf ）
- ETS の統合型の課題（読んで・聞いて、要点を話す）。要点（key point）が答えに入っているかを判定する。
- 文字起こしの WER は 18.5%。要点の判定（2 つのモデルの組み合わせ）は、人の書き起こしで正解率 0.79・F 値 0.69・κ 0.51、文字起こしで 0.80・0.68・0.51。誤りに強かった。
- 注意: 要点は数語〜1 文で、単語の埋め込みや n-gram の重なりで判定する。1 語の取り違えは、ほかの語で埋め合わせられる。

**O'Neill & Carson-Berndsen (2023)「Investigating the Sensitivity of ASR Systems to Phonetic Variation in L2 Englishes」**（https://arxiv.org/abs/2305.07389 ）
- 文字起こしの誤りは、同じ母語の話者の間で「系統的で一貫している」。音素の置き換えの誤りは、人が付けた注釈とおおむね合う。日本語話者向けの「取り違えの表」を作る意味がある、という根拠になる。

**girl → car の取り違えの見立て（推測。確かめた出典は無い）**
- 日本語話者は girl を「ガール」[ɡaːɾɯ] に近く発音しやすい。英語の girl の母音 /ɝ/（r の音色の付いた母音）が日本語に無く、[aː] は car /kɑːr/ の母音に近い。語頭の g と k の違いは、英語では主に息の出方（有気音）で区別されるので、声が小さいと崩れやすい。日本語話者の L と R の混同、子音の後に母音を足す癖（例: [ɡaːɾɯ] の最後の [ɯ]）も、取り違えのもとになる。
- 「声が小さい・言いよどむと悪化する」（2026-11-13 にチームで遊んだときの所見。repo には記録が無い）は、上の Knill の「力の低い人ほど脱落の誤りが多い」（A1 で脱落 19.9%）と合う。

### 2. 文脈で認識を寄せる（contextual biasing）

**Apple（公式の文書と開発者フォーラム）**
- DictationTranscriber の文書（https://developer.apple.com/documentation/speech/dictationtranscriber ）: 「特定の語へ寄せるには `AnalysisContext` を作って `contextualStrings` に語を入れ、`SpeechAnalyzer` に渡す」。独自の語彙は `SFSpeechLanguageModel` と `customizedLanguage(modelConfiguration:)` で渡す。DictationTranscriber は「システムの音声入力や、端末内で動かす `SFSpeechRecognizer` と同じモデル」で、古い端末でも動く。
- Apple の担当者の回答（2026-01、https://developer.apple.com/forums/thread/811083 。解決済みの印が付いた Apple_Agent の回答）: "contextual strings only help transcriptions from the DictationTranscriber module. The SpeechTranscriber module does not currently take contextual strings into account." `contextualStrings` の公式の文書（https://developer.apple.com/documentation/speech/analysiscontext/contextualstrings ）も「DictationTranscriber のモジュールで使える」とだけ書き、SpeechTranscriber には触れない（2026-11-16 に確かめた）。
- 第三者の比べ（Inscribe、2026-07。GIGAZINE の記事 https://gigazine.net/gsc_news/en/20260714-apple-speech-analyzer-benchmark/ 、元は https://get-inscribe.com/blog/apple-speech-api-benchmark.html ）: LibriSpeech の読み上げ（M2 Pro の Mac）で、SpeechAnalyzer 2.12%・Whisper small 3.74%・旧 SFSpeechRecognizer 9.02%。訛りのある英語は測っていない。別の比べ（Argmax、2025-06-20、https://www.argmaxinc.com/blog/apple-and-argmax ）では、earnings22（決算説明会の会話）の 1 割を M4 の Mac mini（macOS 26 の beta）で測り、WER は SpeechTranscriber 14.0%・WhisperKit の whisper-small.en 12.8%・whisper-base.en 15.2% だった（2026-11-16 に原典で確かめた）。順位は一致しない。
- まとめ: 端末で寄せるには、精度の低い古いモデル（DictationTranscriber）に替える必要がある。割に合わない見込み。

**Azure**
- phrase list の文書（2026-10-28 更新、https://learn.microsoft.com/en-us/azure/ai-services/speech-service/improve-accuracy-phrase-list ）: 使えるのは SDK のリアルタイムの文字起こし、Fast transcription API、LLM Speech、Voice Live。バッチでは使えない。このアプリが呼ぶ「短い音声用の REST」は一覧に無い。短い音声用の REST の文書（https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short ）のパラメータの表にも phrase list は無い。使えないと明記した文は無いが、渡す口が文書に無いので、使えないものとして扱う（2026-11-16 に確かめた）。重み（0〜2）を変えられるのは SDK だけ。語の数は 200 以下を勧め、上限は 2,000。
- 発音評価の文書（2026-07-03 更新、https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment ）: "For unscripted assessment, the speech-to-text (STT) model used is different from Azure STT. If you need assessment based on highly accurate recognized text, we recommend first calling Azure STT to obtain the reference text, and then performing scripted assessment." 正解文ありは音読の場面向け、なしは話す場面向けで、返る結果も違う。
- 正解文と違う語を言ったとき: 利用者の質問（Microsoft Q&A、2026-01-14）では、「there」の正解文に「they」と言っても誤りと判定されず、高い点が返ったという報告がある（音読の場面、SDK と Playground の両方で再現したという。公式の説明ではない）。端末の聞き違いが話し方の点をどれだけ動かすかは未確認（文献では決まらず、測る必要がある）。

**Whisper・Workers AI**
- OpenAI の Whisper の prompting の手引き（https://cookbook.openai.com/examples/whisper_prompting_guide ）: 綴りの手本として語を prompt に入れる方法を紹介しつつ、「あまり当てにならない（not especially reliable）」と書いている。
- Yang, Huang, Lee (2024)「Do Prompts Really Prompt?」（SLT 2024、https://arxiv.org/abs/2406.05806 ）: Whisper は prompt を人の期待どおりには読まない。話題に強く従うほど良くなるわけではない。
- Cloudflare Workers AI の `@cf/openai/whisper-large-v3-turbo`（https://developers.cloudflare.com/ai/models/%40cf/openai/whisper-large-v3-turbo/ ）: `initial_prompt`・`prefix`・`vad_filter`・`hallucination_silence_threshold`・`condition_on_previous_text`・`beam_size` などを渡せる。出力は全文と区切りごとの WebVTT で、語ごとの確信度は返らない。料金は 0.000513 USD / 分。
- Workers AI の `@cf/deepgram/nova-3`（https://developers.cloudflare.com/ai/models/%40cf/deepgram/nova-3/ ）: `keyterm`（"Key term prompting can boost or suppress specialized terminology"）、`filler_words`（uh・um を残す）を渡せる。料金は HTTP で 0.0052 USD / 分。出力の schema（https://developers.cloudflare.com/workers-ai/models/nova-3/schema-output.json ）には、語ごとの `confidence`・`start`・`end` がある（2026-11-16 に確かめた）。

**水増し（言っていない語が出る）の危険**
- 寄せる語の一覧が大きいと、綴りや音の似た語の誤検出で WER がかえって上がる（arXiv 2508.17796、Whisper large-v3 の trie を使う寄せ方。検索の要約で読んだ範囲）。
- 学習で寄せる方式でも、正解の語に関係の無い語（distractor）を 25〜50 語混ぜ、正解の語を 1 割の確率で一覧から抜いて、寄せすぎを防いでいる（SALMONN-2、arXiv 2607.17079、2026-07。2026-11-16 に原典で確かめた）。
- 寄せる語の無い発話では、一覧を空にしないと誤検出が出る、という報告もある（arXiv 2306.00804。検索の要約で読んだ範囲）。
- このアプリで「言っていない語が出る率」を測った研究は無い。場面の部品の名前を全部渡すと、正解の語の一覧をそのまま渡すことになり、聞き取れない発話ほど場面の語に寄る（= 内容の点が上がる）と見るのが安全（推測）。

### 3. 端末による差

**SpeechTranscriber の対応端末とモデル（Apple）**
- 文書（https://developer.apple.com/documentation/speech/speechtranscriber ）: 「`isAvailable` か `supportedLocales` で、端末が SpeechTranscriber のモデルに対応しているかを確かめる。対応していなければ機能を止めるか DictationTranscriber を使う」。
- 担当者の回答（2025-09、https://developer.apple.com/forums/thread/801197 ）: 「SpeechTranscriber にはハードウェアの要件がある。A16 の iPad は満たす。古いハードウェアでは DictationTranscriber を使える」。端末の一覧は出さない方針（2025-10、https://developer.apple.com/forums/thread/802863 ）。
- 開発者の報告（2025-11、https://developer.apple.com/forums/thread/807739 ）: iPhone 12・SE 第 3 世代・14 Pro・15 Pro で動き、SE 第 2 世代（A13）で動かない。別のスレッド（2025-11、https://developer.apple.com/forums/thread/806765 ）では、iPhone 11・11 Pro・11 Pro Max・SE 第 2 世代で `isAvailable` が false、iPhone 12〜17 では動いたという報告がある。A13 の端末は使えない（Neural Engine が 8 コアだから）、というのは開発者の推測で、Apple は認めていない。`isAvailable` の文書も「端末のハードウェアと能力から見て使えるか」とだけ書き、機種は挙げない（2026-11-16 に確かめた）。シミュレータでは動かない。
- iOS 26 を入れられるのは iPhone 11 以降と SE 第 2 世代以降（A13 以降。MacRumors 2025-08 など二次情報、https://www.macrumors.com/2025/08/05/will-my-iphone-support-ios-26 ）。iPhone X・XS・XR は入らない。
- WWDC25 の Session 277（書き起こし、https://nonstrict.eu/wwdcindex/wwdc2025/277/ ）: 「モデルはシステムの領域に置かれ、アプリの大きさを増やさない」「モデルは絶えず改善しており、更新が出ればシステムが自動で入れる」。
- AssetInventory の文書（https://developer.apple.com/documentation/speech/assetinventory ）: モデルは Apple のサーバーから入れ、システムが自動で更新し、アプリ間で共有する。**モデルの版を調べる API は無い。**
- 未確認の点: (1) 端末の性能（A14 と A19 など）で、同じモデルでも結果が変わるか（計算の精度や量子化の違い）。(2) 同じ日に、端末ごとにモデルの版が違うことがあるか（自動更新の時期の差）。(3) iPhone 12 で 20 秒の音声を文字にする時間（5 秒の時間切れに当たるか）。

**マイクと音の処理**
- `AVAudioSession.Mode.measurement` の文書（https://developer.apple.com/documentation/avfaudio/avaudiosession/mode-swift.struct/measurement ）: 「システムが入出力にかける信号処理を最小にしたいアプリ向け。マイクが複数ある端末では主マイクを使う」。注意として「入出力のダイナミクス処理の一部を止めるので、再生の音量が下がる」。別の説明では、このモードでは自動の音量調整（AGC）をしない。
- `.voiceChat` は通話向けで、エコーの除去や自動の音量調整が入る（Apple の文書の要約）。
- マイクの違いの研究: LibriSpeech の音声を 3 つのマイク（Matrix Voice・ReSpeaker・安い USB マイク、10 cm の距離、静かな部屋）で流し直すと、Google と Bing の WER は元の音声の最大 1.41 倍になった。Bing ではマイクによって 1.24〜1.41 倍と幅があった（Mathur ほか 2018、https://discovery.ucl.ac.uk/id/eprint/10075038/1/mathur_hasca2018.pdf 。2026-11-16 に本文で確かめた）。古い研究で、今のモデルでの差は未確認（測る必要がある）。
- 音量: Moonshine の論文（Jeffries ほか 2024、https://arxiv.org/abs/2410.15608 ）は、入力の音量を下げていくと、-40 dB より小さい所で WER が急に上がることを示した（LibriSpeech、Whisper と Moonshine の比べ）。普通の範囲の音量の違いには、今のモデルはおおむね強い。
- 雑音の除去: 1 チャンネルの雑音除去は、作り出すひずみ（artifact）のせいで、かえって認識を悪くしやすい（Iwamoto ほか 2022、Interspeech、https://arxiv.org/abs/2201.06685 ）。雑音の除去を前処理に入れるのは避ける。
- 無音と幻覚: Whisper は無音の多い音声で、言っていない文を作りやすい。失語症の話者で 1.7%、対照群で 1.2% の区切りに幻覚が出て、無音の割合が多いほど起きやすい（Koenecke ほか 2024、FAccT、https://arxiv.org/abs/2402.08021 ）。言いよどみの多い、力の低い学習者ほど同じ形で不利になりうる。VAD で無音を切ると減らせる（Workers AI の Whisper には `vad_filter`・`hallucination_silence_threshold` がある）。
- 背景: 米国の 5 社の文字起こしで、話者の人種によって WER に大きな差が出た研究（Koenecke ほか 2020、PNAS、https://www.pnas.org/doi/10.1073/pnas.1915768117 ）がよく引かれる。Amazon・Apple・Google・IBM・Microsoft の 5 つで、米国の 5 都市の面接（黒人 73 人・白人 42 人、19.8 時間、年齢と性別をそろえた）を文字にすると、平均の WER は黒人 0.35、白人 0.19 だった。同じ語句を言った部分でも差が同じくらい大きく、著者は差の元を音響モデルにあるとした（2026-11-16 に PMC 版 https://pmc.ncbi.nlm.nih.gov/articles/PMC7149386/ で確かめた）。

### 4. 誤りに強い採点の材料

**確信度・N-best（各社の文書）**
- SpeechTranscriber（https://developer.apple.com/documentation/speech/speechtranscriber/preset 、`ReportingOption`・`ResultAttributeOption` の頁）: `transcriptionConfidence`（確信度の属性）、`audioTimeRange`（時刻）、`alternativeTranscriptions`（ほかの候補）を付けられる。今使っている `.transcription` の preset はどれも付けない。`.timeIndexedTranscriptionWithAlternatives` は候補と時刻を付ける。
- Azure の短い音声用の REST（`format=detailed`）は NBest（候補の一覧）を返す。今のコードは `NBest[0]` だけを使う。
- Knill ほか (2018) の確信度で絞る効果は、上の 1. のとおり（29.0% → 7.3%）。

**音の近さで照合する**
- 音の近さ（Soundex・Metaphone など）と、あいまいな一致を組み合わせて、文字起こしの誤りの重さを評価する提案がある（LASER、arXiv 2510.07437。検索の要約で読んだ範囲）。
- 対話システムで、辞書の発音を言語理解に足すと、誤りが約 5〜7% 減った（Wang ほか 2011、USC、https://people.ict.usc.edu/~leuski/publications/papers/Wang-11.pdf 。検索の要約で読んだ範囲）。
- 学習者の文字起こしに、よくある聞き違いの例を LLM のプロンプトで添えた例は、上の Balaji Shankar ほか (2025)。

**言いよどみ・言い直し**
- 文字起こしのモデルの多くは、フィラー（uh・um）を学習の段階で落としている。Speak & Improve の評価では、言いよどみは消しても誤りに数えない（SpWER）。
- Lu ほか (2025)「Acoustically Precise Hesitation Tagging Is Essential for End-to-End Verbatim Transcription Systems」（https://arxiv.org/abs/2506.04076 ）: 学習の文字起こしにフィラーを正しく書き込むと（Extra）、フィラーを消した学習（Pure）より WER が 6.2% → 5.5% に下がる。記号だけ（Rich）では 7.2% に悪化。
- McGuire (2025)（https://arxiv.org/abs/2503.06924 ）: L2-ARCTIC（母語は 6 つ、日本語は無い）で、言いよどみの種類と文字起こしの組み合わせで、成績が大きく違う。
- Koizumi (2024) の言い直しの除去の手順（上の 1.）は、このアプリでも使える形をしている。

### 5. ファインチューンと端末で動く小さなモデル

| 研究 | データ | 効き目 |
| --- | --- | --- |
| Sun ほか (2025) | Speak & Improve、学習 28.2 時間、Whisper-small、LoRA | 全体 10.2% → 9.2%。A2 は相対 20% 悪化。工夫すれば 7.2% |
| Lu ほか (2025) | Speak & Improve の 7,100 件（学習 + dev）、Whisper large-v3、rsLoRA（rank 32） | 9.5% → 6.47%（Closed Track で 1 位） |
| Attia ほか (2024)「Kid-Whisper」（AIES、https://arxiv.org/abs/2309.07927 ） | 米国の 8〜11 歳（MyST）を整えた 132.5 時間 | small 13.93% → 9.11%、medium 13.23% → 8.61%。学習に入れていない CSLU の自由発話も medium で 31.85% → 16.53% |
| Jain ほか (2024)（IEEE Access 12、DOI 10.1109/ACCESS.2024.3378738） | 母語でない子どもの英語（PFSTAR・speechocean762 など）の 1 割だけで学習 | 同じデータでの既知の基準から、WER が相対 29〜89% 改善（要旨で確かめた。表の数値とデータの名前は未確認。IEEE Xplore が PDF の取得を拒み、開けなかった） |
| Halychanskyi ほか (2026)（ICML 2026 の workshop、https://arxiv.org/abs/2604.27273 ） | 少ない実の訛りの音声 ＋ 合成の訛りの音声 | 音素をでたらめに置き換えた合成でも、効き目の多くが出る。合成と実の比率が大事 |

- 端末で動く選択肢: Apple の SpeechTranscriber（無料・システムが更新）、DictationTranscriber（古い端末・寄せる語を渡せる・精度は低め）、WhisperKit（Argmax。Whisper を CoreML で動かす。https://arxiv.org/abs/2507.10860 。ファインチューンした Hugging Face の Whisper を `whisperkittools` で CoreML に変換できる、https://github.com/argmaxinc/whisperkittools ）、Moonshine（27.1M・61.5M パラメータ、Whisper tiny・base と同程度の精度で速い。長い音声では精度が落ちる）。
- サーバーで動かすなら、Workers AI の Whisper large-v3-turbo は Cloudflare の決まったモデルで、自前のファインチューンは載せられない。Workers AI の LoRA は「LoRA に対応したモデル」だけで使え、対応するのは LLM 向けの決まったモデル（Mistral・Gemma・Llama 2 の `-lora`）だけ。Whisper の頁に LoRA の記載は無く、自前のモデルを載せる口も文書に無い（2026-11-16 に https://developers.cloudflare.com/workers-ai/features/fine-tunes/loras/ と Workers AI のモデルの一覧で確かめた）。

## このアプリへの当てはめ（案ごとに、効き目・手間・費用・リスク）

### 手計算: 1 語の聞き違いが内容の点をどれだけ動かすか

3 級（`eiken-3`）の場面で、項目が「中心 1: 女の子が走っている（重み 2）」「中心 2: 犬が寝ている（重み 2）」「細部: 犬がベンチの下にいる（重み 1）」、満点の重み 5 とする。

- 言ったこと: "A girl is running. A dog is sleeping under the bench."
- 正しく文字になったとき: R = (2 + 2 + 1) / 5 = 1.0、P = 3 / 3 = 1.0、内容 = 100 × 2 × 1.0 × 1.0 / (1.0 + 1.0) = **100 点**。
- girl が car になったとき: 中心 1 は当たらず、"A car is running" は場面に無い物（absent）で誤り。R = (0 + 2 + 1) / 5 = 0.6、P = 2 / 3 ≈ 0.667、内容 = 100 × 2 × 0.6 × 0.667 / (0.6 + 0.667) ≈ **63 点**。
- 合計（重み 50・25・25）では、内容の 37 点の差が **約 18 点**になる。2〜4 人で競うと、順位がまるごと入れ替わる大きさ。
- 聞き違いを「場面に無い物の誤り」に数えなければ（下の案 E）、R = 0.6、P = 2 / 2 = 1.0、内容 = 75 点。さらに音の近さで「一部（重み × 0.5）」とすれば、R = (1 + 2 + 1) / 5 = 0.8、P = 1.0、内容 ≈ **89 点**。

20 秒で 30〜40 語話し、WER が 20% なら、1 回に 6〜8 語が誤る計算になる（多くは冠詞や前置詞で、項目の名詞に当たるのはその一部。割合は未確認）。

### 案 A: 全員の WAV を、同じサーバーの同じ設定で文字にする（最優先）

- 中身: 端末の文字起こしを採点に使わない（表示だけに使うか、やめる）。Worker で WAV を文字にし、その文で全員を同じ方式で採点する。候補は次の 3 つで、どれにするかは案 C の測定で決める。
  - A1: Azure の文字起こし → その文を正解文にして発音評価（Microsoft が勧める 2 段）。全員 scripted になり、話し方の評価の方式がそろう。
  - A2: Workers AI の Whisper large-v3-turbo（`vad_filter`・`condition_on_previous_text: false`）→ 発音評価。
  - A3: Workers AI の Deepgram Nova-3（`filler_words` でフィラーを残せる）→ 発音評価。
- 効き目: 端末のモデル・OS の版・端末の速さ（5 秒の時間切れ）による差と、話し方の評価の方式の差が無くなる。`X-Transcript` を作り替えて送る余地も無くなる。マイクと声の差は残る。精度が上がるかは、選ぶモデル次第（米国の子どもの話の再生では、Whisper large-v3 が 24.5% と悪く、Azure は 15.3%。Balaji Shankar ほか 2025）。
- 手間: バックエンドだけ。`score()` の文字起こしの取り方を差し替える。WAV はもう全員分届いている。1〜2 日。アプリは、文字起こしを待たずにすぐ送れるので、結果が最大 5 秒早くなる。
- 費用（20 秒 1 人あたり）: A1 は Azure の文字起こしが 1 回増えて約 0.0057 USD（標準の約 0.017 USD / 分、既存の調査の値から計算）。A2 は約 0.00017 USD。A3 は約 0.0017 USD。4 人の 1 ラウンドで、A1 でも約 0.023 USD 増える。
- 実装の場所: Cloudflare Workers（A2・A3 は `env.AI.run`、A1 は今の Azure の REST をもう 1 本）。
- リスク: 文字起こしの時間の分（1〜2 秒、未確認）だけ発音評価が後ろにずれる。正解文なしの評価を全員にかけて並べて走らせれば、待ち時間は増えないが、Microsoft の勧めからは外れる。文字起こしのサービスの障害が全員に効く（今は端末とサーバーの 2 本立て）。

### 案 B: 録音の条件をそろえる

- 中身:
  - B1: 録る間だけ `AVAudioSession` を `.measurement` モードにし、端末ごとの自動の音量調整を止める。振り返りで再生するときは今の設定に戻す（文書の注意どおり、`.measurement` では再生の音量が下がる）。
  - B2: サーバー（Worker）で、WAV の音量を正規化する（RMS か LUFS で目標の値へ）。前後の無音を VAD で切る。雑音の除去はしない（Iwamoto ほか 2022）。
  - B3: 部屋に入ったとき、決まった短い文（例: "A girl is sitting on the bench."）を言ってもらい、音量・雑音の大きさ・その文の認識が合うかを確かめる。声が小さければ、その場で「もう少し大きな声で」と出す。今の音量メーターの値（`averagePower`）も、録音中に小さすぎれば知らせる。
- 効き目: 声の小ささ（2026-11-13 にチームで遊んで出た悪化の原因）と、機種ごとの音の処理の差を減らす。B3 は端末ごとの差の測定（案 C）にもなる。
- 手間: B1 は iOS の数行、B2 は Worker で WAV の数値の処理（数十行）、B3 は画面と文の判定で 2〜3 日。
- 費用: B3 だけ、1 人 1 回の文字起こしの分（数秒の音声）。
- 実装の場所: B1・B3 は iOS、B2 は Workers。
- リスク: `.measurement` で静かな声がより小さく録れ、かえって悪くなる端末がありうる（未確認）。B2 の正規化で雑音も大きくなる。どちらも案 C の測定で確かめてから入れる。

### 案 C: 端末ごとの差を測る仕組み（案 A・B の前提）

- 中身:
  - C1: 録音を固定した比べ。チームと協力者の 20 秒の描写を 30 本ほど集め、人が書き起こす。同じ WAV を、各機種の SpeechTranscriber と、案 A の候補に通す。マイクを除いた「モデルと OS」の差が出る。
  - C2: 流し直しの比べ。同じ録音をスピーカーから一定の距離で流し、各機種で録る（Mathur ほか 2018 の方法）。マイクと音の処理の差が出る。
  - C3: 本番のログ。採点のログに、端末の型番（`utsname.machine`）・OS の版・文字起こしの出どころ・端末とサーバーの文字起こしの食い違いの率（WER として計算）を足す。同意の範囲で、食い違いの大きい回の音声を残せるようにする（プライバシーポリシーの見直しが要る）。
- 測る量:
  - 端末の差 = 機種 d の WER − 基準の WER。同じ音声を両方に通すので、対にして差を見る。
  - 採点への効き = 人の書き起こしでの内容の点 − 文字起こしでの内容の点。1 本ずつの差の平均と最大。今の安定の目標（同じ答えで 5 点以内）に合わせ、「端末の差による内容の点の差が平均 5 点以内」を目標にするとよい。
- 手計算の目安: 30 本 × 35 語 ≈ 1,000 語で、WER 20% の標準誤差は √(0.2 × 0.8 / 1000) ≈ 1.3 ポイント。話者ごとのまとまりがあるので、実際はこれより大きい。2 機種の差が 3〜4 ポイント以上なら見分けられる見込み。
- 効き目: 「公平」を数字で言えるようになる。どの案が効くかを決められる。
- 手間: C1・C2 は録音と書き起こしで 1〜2 日（人の書き起こしが一番重い）。C3 はログの項目を足すだけで半日。
- 費用: ほぼ無し（書き起こしの人手だけ）。
- リスク: 書き起こしの決まり（フィラーを残すか、言い直しをどう書くか）を先に決めないと、数字が比べられない。Speak & Improve の SpWER の決まりに合わせるとよい。チームは大学生なので、中高生や力の低い人の誤りは少なく見積もる。データの集め方は担当 2 と合わせる。

### 案 D: 場面の部品の名前で認識を寄せる（測ってから、検証の用途に限って）

- 中身: サーバーの文字起こし（Workers AI の Whisper の `initial_prompt`、Nova-3 の `keyterm`、Azure の Fast transcription の `phraseList`）に、場面の部品の `words` を渡す。端末では SpeechTranscriber が使わないので、やらない。
- 水増しへの備え:
  - D1: 場面に無い、音の近い語を同じ数だけ混ぜる（girl に対して car・curl・gal、dog に対して duck・dock など）。一覧から正解が分からないようにする。
  - D2: 寄せた結果を点に直接使わない。寄せない結果と比べ、食い違った語だけを「聞き取りが分かれた語」とし、案 E の決まり（一部の扱い）に回す。
  - D3: わざと場面の一部の物を言わない録音を作り、寄せたときに言っていない部品の名前が出る率を測る。率が無視できる大きさ（例: 100 本で 1 回以下）でなければ入れない。
- 効き目: 未確認。部品の名前は girl・dog のような易しい語が多く、珍しい固有名詞ほどは効かない見込み（推測）。
- 手間: D2 の 2 回の呼び出しと比べで 1〜2 日。D3 の測定に 1 日。
- 費用: 文字起こしが 2 回になる（A2 なら 1 人 0.00034 USD）。
- 実装の場所: Workers。
- リスク: 水増しで、力の低い人ほど点が上がる逆向きの不公平が起きうる。Whisper の prompt は効き方が読めない（OpenAI 自身が当てにならないと書いている）。

### 案 E: 誤りに強い照合（コードで決める）

- 中身:
  - E1: 確信度を取る。サーバーで文字にするなら Azure の NBest と語ごとの確信度、端末を残すなら SpeechTranscriber の `transcriptionConfidence` と `alternativeTranscriptions`。
  - E2: 音の近さを計算する。文字起こしの名詞と、場面の部品の `words` を、発音辞書（CMUdict など）の音素の編集距離で比べる。日本語話者に多い置き換え（r と l、/ɝ/ と /ɑr/、b と v、s と θ、母音の付け足し、g と k）は距離を小さくする。表は、案 C の録音で実際に出た取り違えから作る（O'Neill & Carson-Berndsen 2023 の、同じ母語なら誤りが系統的だという結果が根拠）。
  - E3: 決まり（案。担当 1・4 と合わせて決める）:
    - 確信度の低い語、または場面の部品と音の近い「場面に無い語」は、場面に無い物の誤り（absent）に数えない。上の手計算で 63 点 → 75 点。
    - その語が場面の部品と音で近く、文の形（主語・動作）も項目と合えば、その項目を「一部」にする。上の手計算で 89 点。
    - 「言えた」にはしない。聞き違いの直しで満点を与えると、案 D と同じ水増しになるため。
  - E4: 振り返りの画面で、直した語を「car → girl と聞き取りを直しました（音が近いため）」と見せる。
- 効き目: 聞き違いの二重の不利（R と P が同時に下がる）を消す。力の低い人ほど誤りが多いので、力の低い人への不利を主に減らす。決まりがコードにあるので、安いモデルにしても結果がぶれにくい（AI に依存しすぎない、という指摘にも合う）。
- 手間: E1 は 0.5 日、E2 は辞書の同梱と距離の計算で 2〜3 日、E3 は採点のコードと Claude に渡す形の変更（担当 4 の範囲と重なる）。
- 費用: ほぼ無し。
- 実装の場所: Workers（`checklistGrade.ts` の引用の照合と、F1 の計算の前）。
- リスク: 音の近い語どうしの描写の取り違え（本当に car と言った人）を、誤りとして数えなくなる。場面に car も girl もあるときは使えない（どちらも場面にある語なので、確信度だけで決める）。決まりの数を増やすと「場当たり的な直し」になるので、音の近さと確信度の 2 つの量だけで決める。

### 案 F: 言いよどみ・言い直しの扱いをそろえる

- 中身: 内容の照合の前に、フィラー・すぐの繰り返し・言い直しの前半を消した文を作る（Koizumi 2024 の 3 段の手順。コードの規則でできる部分は規則で、残りは LLM）。元の文は表示と、話し方の評価に残す。言い直し（"a boy... a girl is running"）は、直した後だけを描写として数え、前半を場面に無い物の誤りに数えない。
- 効き目: 言いよどむ人（力の低い人・緊張した人）の内容の点が、言い直しで下がらない。フィラーを残すかどうかで文字起こしのサービスの差が出るので（ElevenLabs・Nova-3 は残せる、Whisper は落としやすい）、消してからそろえれば、サービスを替えても点がぶれにくい。
- 手間: 1〜2 日。今の Claude の判定（数えない描写 `ignored`）との重なりを担当 4 と確かめる。
- 費用: 規則だけなら無し。
- 実装の場所: Workers。
- リスク: 消しすぎると、本当に 2 つ言った描写を 1 つにしてしまう。流暢さは Azure の音声から測るので、文字の側で消しても話し方の点は変わらない。

### 案 G: 学習者の声へのファインチューン（今はやらない。データがそろってから）

- 中身: 日本の中高生の英語の描写を集めて書き起こし、Whisper（small〜large-v3-turbo）を LoRA で学習する。力の低い人の音声を多めに入れ、増やす（Sun ほか 2025 の工夫）。
- 要るデータの目安: Speak & Improve の 28 時間で全体の WER が 1〜3 ポイント下がる（ただし力の低い人に注意）。子どもでは 1 割の少量でも効いた例がある（Jain ほか 2024）。このアプリでは数時間〜数十時間（20 秒の発話で 1,000〜5,000 本程度、推測）が要り、Award Day までの規模では足りない。
- 効き目: 誤りの多い所（日本語話者の音の取り違え）に直接効く見込み。ただし学習の偏りで、力の低い人の WER がかえって上がりうる。
- 手間: 大きい。データの同意・書き起こし・学習・評価で数週間。
- 費用: 学習の GPU（数時間）と、動かすサーバー（常時の GPU か、使った分だけ払うもの）。端末で動かすなら WhisperKit で CoreML に変換し、アプリにモデル（small で約 460 MB）を入れる。
- 実装の場所: 別のサーバー（Workers AI には自前の Whisper を載せられない。上の 5. のとおり、2026-11-16 に Cloudflare の文書で確かめた）か、iOS（WhisperKit）。iOS に載せると端末の性能の差が戻るので、公平さの面ではサーバーの方がよい。
- リスク: 学習のデータに未成年の声が入るので、同意と保管の決まりが要る。モデルを持つと、更新と評価を続ける手間がかかる。

### 公平さを、プレイヤーにどう説明できるか（案 A・C・E を入れた後）

- 「全員の声を、同じサーバーの同じ AI で、同じ設定で文字にしています。iPhone の機種によって、文字起こしの AI は変わりません。」（案 A）
- 「聞き取りに自信の無い語や、音が近くて聞き違えたかもしれない語では、減点しません。」（案 E。振り返りで、直した語に印を付けて見せる）
- 「チームの録音 N 本で、iPhone 12 と iPhone 17 の文字起こしの差は X ポイント、内容の点の差は平均 Y 点でした。」（案 C の結果。数字は測ってから入れる）
- 「声が小さいと聞き取りにくくなります。部屋に入ったときのマイクの確かめで、声の大きさを見ています。」（案 B3）
- 言わない方がよいこと: 「誤りはありません」「どの端末でも同じ点になります」。マイクと声の差は残るので、測った範囲の数字で言う。

### 入れる順（提案）

1. 案 C3（ログに端末の型番・OS の版・出どころを足す）と案 C1（録音を固定した比べ）。半日〜2 日。今の差の大きさが分かる。
2. 案 A（サーバーの文字起こしにそろえ、発音評価の方式もそろえる）。1〜2 日。今の作りの 3 つの差（出どころ・評価の方式・作り替え）が消える。
3. 案 E（確信度と音の近さで、聞き違いを誤りに数えない）と案 F（言いよどみ）。担当 1・4 と決まりを合わせて 1 週間程度。
4. 案 B（録音の条件）。案 C の測定で効くと分かってから。
5. 案 D（寄せる語）は、案 C の録音で水増しの率を測ってから。案 G（ファインチューン）は、担当 2 のデータが集まってから。

## 不確かな点・残る問い

- 日本の**中高生**の英語で、SpeechTranscriber・Azure・Whisper の WER を測った研究は見つからなかった。ICNALE（大学生、電話の音声、声の高さを変えてある）と米国の子ども（母語話者）の値から推しているだけ。案 C で測るまでは、どれが良いか言えない。
- SpeechTranscriber の対応端末（A13 は使えないか）と、端末や自動更新の時期でモデルや結果が変わるかは、Apple が公表しておらず未確認。Apple は一覧を出さない方針（DTS の回答、2025-10）で、文書は `isAvailable` で確かめるよう書くだけ。A13 の機種（iPhone 11 系・SE 第 2 世代）で false という報告は、2 つのスレッド（806765・807739、2025-11）にある（2026-11-16 に確かめた）。iPhone 11 と 12 で同じ WAV を通して比べる必要がある。
- 端末の文字起こしを正解文にしたとき、Azure の `NBest[0].Display`（ログの `azureTranscript`）が正解文に引きずられるかは未確認。引きずられるなら、ログで端末と Azure の食い違いを比べても意味が無い。正解文なしで同じ WAV を通して確かめる。
- 正解文に聞き違いの語（car）があるとき、話し方の点がどれだけ下がるかは未確認（Microsoft Q&A には、違う語でも高い点が返るという報告がある）。
- Azure の短い音声用の REST で phrase list が使えるか、Workers AI の Nova-3 が語ごとの確信度を返すか、Workers AI に自前のファインチューンした Whisper を載せられるかは、2026-11-16 に文書で確かめた。短い音声用の REST には phrase list を渡す口が無い。Nova-3 は語ごとの確信度を返す。Workers AI に自前の Whisper は載せられない。
- 寄せる語を渡したときに「言っていない部品の名前が出る率」は、このアプリの条件で測った研究が無い。案 D3 の測定が要る。
- 案 E の決まり（聞き違いを「一部」にする）は、内容の点の定義そのものを変えるので、担当 1（ルーブリック）と担当 4（LLM の採点）との合意が要る。
- 文字起こしが文法の誤りを直してしまう傾向（Whisper は名詞の形の誤りの 98.9% を直した）は、表現の点を力の低い人ほど高めに出す。どの文字起こしを選ぶかが表現の点にも効くので、担当 3 と合わせて測る。
- Web 検索の上限に達したため、Koenecke 2020（PNAS）・Jain 2024 の表・Mathur 2018 の本文・SALMONN-2 などは原典を開けていなかった。2026-11-16 に、Koenecke 2020・Mathur 2018・SALMONN-2 は原典で確かめた。Jain 2024 の表（IEEE Xplore が取得を拒んだ）と Hirai & Kovalyova 2024 の原典（ScholarSpace が取得を拒んだ）は開けなかった。

## 出典の一覧

学術
- Koizumi, T. (2024). Accuracy of Automatic Speech Recognition in L2 Learners' Spontaneous Speech. 外国語教育メディア学会中部支部研究紀要 35. https://www.jstage.jst.go.jp/article/letcj/35/0/35_15/_pdf
- Knill, K. M. ほか (2018). Impact of ASR Performance on Free Speaking Language Assessment. Interspeech 2018. DOI 10.21437/Interspeech.2018-1312. https://eprints.whiterose.ac.uk/152761/
- Qian, M. ほか (2024). Speak & Improve Challenge 2025: Tasks and Baseline Systems. https://arxiv.org/abs/2412.11985
- Sun, L., Zhu, C., Shi, S. (2025). Proficiency-Aware Adaptation and Data Augmentation for Robust L2 ASR. https://arxiv.org/abs/2510.10738
- Lu ほか (2025). Acoustically Precise Hesitation Tagging Is Essential for End-to-End Verbatim Transcription Systems. https://arxiv.org/abs/2506.04076
- Balaji Shankar, N. ほか (2025). Leveraging ASR and LLMs for Automated Scoring and Feedback in Children's Spoken Language Assessments. SLaTE 2025. http://www.seas.ucla.edu/spapl/paper/balaji_slate2025_llm.pdf
- Yoon, S.-Y. ほか (2019). Toward Automated Content Feedback Generation for Non-native Spontaneous Speech. BEA 2019. https://aclanthology.org/W19-4432.pdf
- O'Neill, E., Carson-Berndsen, J. (2023). Investigating the Sensitivity of Automatic Speech Recognition Systems to Phonetic Variation in L2 Englishes. https://arxiv.org/abs/2305.07389
- McGuire, M. (2025). Automatic Speech Recognition for Non-Native English: Accuracy and Disfluency Handling. https://arxiv.org/abs/2503.06924
- Attia, A. A. ほか (2024). Kid-Whisper: Towards Bridging the Performance Gap in Automatic Speech Recognition for Children VS. Adults. AIES 2024. https://arxiv.org/abs/2309.07927
- Jain, R. ほか (2024). Exploring Native and Non-Native English Child Speech Recognition With Whisper. IEEE Access 12. DOI 10.1109/ACCESS.2024.3378738（要旨のみ確認）
- Halychanskyi, Y. ほか (2026). Few-Shot Synthetic Accented Speech for ASR Fine-Tuning: What Helps and When? https://arxiv.org/abs/2604.27273
- Koenecke, A. ほか (2024). Careless Whisper: Speech-to-Text Hallucination Harms. FAccT 2024. https://arxiv.org/abs/2402.08021
- Koenecke, A. ほか (2020). Racial disparities in automated speech recognition. PNAS. https://www.pnas.org/doi/10.1073/pnas.1915768117（PMC 版 https://pmc.ncbi.nlm.nih.gov/articles/PMC7149386/ で確認）
- Yang, C.-K., Huang, K.-P., Lee, H.-y. (2024). Do Prompts Really Prompt? Exploring the Prompt Understanding Capability of Whisper. SLT 2024. https://arxiv.org/abs/2406.05806
- Sun, G. ほか (2023). Can Contextual Biasing Remain Effective with Whisper and GPT-2? https://arxiv.org/abs/2306.01942
- Zero-shot Context Biasing with Trie-based Decoding using Synthetic Multi-Pronunciation (2025). https://arxiv.org/abs/2508.17796（検索の要約で確認）
- SALMONN-2: Advancing General-Purpose Hearing Abilities with Self-Supervised Representations (2026). https://arxiv.org/abs/2607.17079（本文で確認）
- Jeffries, N. ほか (2024). Moonshine: Speech Recognition for Live Transcription and Voice Commands. https://arxiv.org/abs/2410.15608
- Iwamoto, K. ほか (2022). How Bad Are Artifacts?: Analyzing the Impact of Speech Enhancement Errors on ASR. Interspeech 2022. https://arxiv.org/abs/2201.06685
- Mathur, A., Smith, R., Isopoussu, A., Lane, N. D. (2018). On Robustness of Cloud Speech APIs: An Early Characterization. HASCA 2018. https://discovery.ucl.ac.uk/id/eprint/10075038/1/mathur_hasca2018.pdf（本文で確認）
- WhisperKit: On-device Real-time ASR with Billion-Scale Transformers (2025). https://arxiv.org/abs/2507.10860
- Wang, W. ほか (2011). 音の近さを言語理解に足す研究（USC ICT）. https://people.ict.usc.edu/~leuski/publications/papers/Wang-11.pdf（検索の要約で確認）
- LASER: An LLM-based ASR Scoring and Evaluation Rubric (2025). https://arxiv.org/abs/2510.07437（検索の要約で確認）

公式の文書・フォーラム
- Apple SpeechTranscriber: https://developer.apple.com/documentation/speech/speechtranscriber （Preset・ReportingOption・ResultAttributeOption の各頁も）
- Apple DictationTranscriber: https://developer.apple.com/documentation/speech/dictationtranscriber
- Apple AssetInventory: https://developer.apple.com/documentation/speech/assetinventory
- Apple AVAudioSession.Mode.measurement: https://developer.apple.com/documentation/avfaudio/avaudiosession/mode-swift.struct/measurement
- WWDC25 Session 277「Bring advanced speech-to-text to your app with SpeechAnalyzer」の書き起こし（2025）: https://nonstrict.eu/wwdcindex/wwdc2025/277/
- Apple Developer Forums: https://developer.apple.com/forums/thread/811083 （2026-01、contextualStrings）、https://developer.apple.com/forums/thread/801197 （2025-09、ハードウェアの要件）、https://developer.apple.com/forums/thread/802863 （2025-10、一覧は出さない）、https://developer.apple.com/forums/thread/807739 （2025-11、機種の報告）
- Microsoft: Improve recognition accuracy with phrase list（2026-10-28）: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/improve-accuracy-phrase-list
- Microsoft: Use pronunciation assessment（2026-07-03 更新）: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment
- Cloudflare Workers AI whisper-large-v3-turbo: https://developers.cloudflare.com/ai/models/%40cf/openai/whisper-large-v3-turbo/
- Cloudflare Workers AI nova-3: https://developers.cloudflare.com/ai/models/%40cf/deepgram/nova-3/
- OpenAI Whisper prompting guide: https://cookbook.openai.com/examples/whisper_prompting_guide
- Argmax whisperkittools: https://github.com/argmaxinc/whisperkittools

二次の情報
- Inscribe の SpeechAnalyzer の比べ（2026-07）: https://get-inscribe.com/blog/apple-speech-api-benchmark.html （GIGAZINE の記事 https://gigazine.net/gsc_news/en/20260714-apple-speech-analyzer-benchmark/ で確認）
- iOS 26 の対応機種（MacRumors、2025-08）: https://www.macrumors.com/2025/08/05/will-my-iphone-support-ios-26
- Microsoft Q&A（正解文と違う語でも高い点が返るという報告）: https://learn.microsoft.com/en-us/answers/questions/5707709/azure-speech-pronunciation-assessment-word-and-pho

repo（読んだだけ、変更していない）
- `ios/NG2622/Audio/DeviceTranscriber.swift`、`ios/NG2622/Audio/VoiceRecorder.swift`、`ios/NG2622/Game/LiveGameClient.swift`、`ios/project.yml`
- `backend/src/scoring/index.ts`、`backend/src/scoring/azure.ts`、`backend/src/scoring/checklistGrade.ts`、`backend/src/routes/rounds.ts`、`backend/src/usecases/submitAudio.ts`
- `docs/design/usecase.md`（文字起こしの決定の経緯）、`docs/design/azure-pronunciation-assessment.md`、`docs/feedback/20261115-award-day.md`
