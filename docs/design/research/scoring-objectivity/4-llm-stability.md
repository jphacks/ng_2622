# 4. LLM に任せる部分を、安いモデルでも安定させる方法

調べた日: 2026-11-16。担当 4（採点に LLM を使う部分の信頼性・安定性・安いモデルへの移しやすさ）。
ルーブリックの中身（担当 1）・データセット（担当 2）・LLM を使わない指標（担当 3）・音声（担当 5）・製品（担当 6）は扱わない。

> 調べ方の注意: 調べている途中で、このセッションの WebSearch の上限（全担当の合計）に達した。後半は、既に分かっていた URL を WebFetch で読むことだけで進めた。そのため、Kaggle の上位の点・RubricEval・FLASK の数値などは確かめられていなかった（「不確かな点」に書いた）。RubricEval・FLASK は、次の行のとおり 2026-11-16 に確かめた。
> 2026-11-16 の確かめ: 原典の PDF・公式の文書で、FLASK・TICK・RubricEval・Selene Mini・Xiao・SAFE・Uchida・Claude の料金と logprobs・Workers AI を確かめ、本文を直した。結論の数値（Yoshida の QWK、PoLL の κ、CheckEval の α、Prometheus 2 の FLASK の相関）も原典と合っていた。Mizumoto & Eguchi と Pack et al. は開けず、Kaggle は最終の順位の点が取れず、「未確認」を残した。

---

## 問い

1. LLM で自動採点した研究で、人との一致はどれくらいか。モデルの大きさや種類でどう変わるか（英作文・話す答え）。
2. LLM の判定を安定させる手法（チェックリスト・理由を先に書かせる・例を入れる・多数決・temperature と seed・構造化出力・点の調整・相対の比較・位置や長さの偏り）と、その効果。
3. 採点専用の小さな評価用のモデル（Prometheus 2・JudgeLM・Auto-J など）は、ルーブリックを渡して点を付けられるか。人との一致は。
4. 大きなモデルから小さなモデルへの蒸留・採点専用の fine-tune に要るデータの量と、得られる一致。
5. LLM の役割を「抜き出し・判定」に限り、点の計算を決まった規則で行う組み合わせ（hybrid）。今のアプリをさらに決定的にする設計。
6. 安いモデルで結果が安定しているかを、何を何件で測ればよいか。

前提として読んだ repo のもの: `backend/src/scoring/checklistGrade.ts`（指示文 `SYSTEM`・出力の schema・呼び直し）、`backend/src/scoring/checklist.ts`（引用の確かめ・F1）、`backend/scripts/measure-scoring-baseline.ts`、ADR `20261110-score-content-with-checklist-f1`・`20261111-count-other-claims-as-bonus-and-require-actions-for-items`、`backend/wrangler.jsonc`、`docs/feedback/20261115-award-day.md`。

---

## 結論

1. **総合点を LLM に直接付けさせると、人との一致は中くらいで、安いモデルほど下がる。** 英作文では、安いモデル（Claude 3.5 Haiku・GPT-4o-mini・Gemini 1.5 Flash・Llama 3 70B）の QWK が 0.52〜0.63（人どうしは 0.8〜0.9）。GPT-4 でも例を入れないと 0.6 前後で、段階ごとに 1 つ例を入れて 0.81（人どうし 0.87）。話す答えでは、ゼロショットの相関が 0.56〜0.76、学習させたモデルが 0.82〜0.95。**一方で、参照のある狭い二値の判定（「この答えは正解と同じことを言っているか」）では、小さなモデルが GPT-4 と同じか上回る**（Cohen の κ 0.73〜0.90）。安いモデルへ移せるかは、モデルの大きさよりも「LLM に何を判断させるか」の狭さで決まる。
2. **今のアプリの形（LLM が判定し、コードが F1 を計算する）は、文献の安定させる手法の多くを既に取り入れている。次の一歩は、1 回の大きな判定を「項目ごとの固定の欄」と「小さな yes/no」に分け、部分点の規則と場面との照合をコードへ移すこと。** チェックリストで判定すると、評価モデルの間の一致（Krippendorff の α）が 0.09 から 0.48 に上がった研究がある（CheckEval）。項目ごとの欄にすると、2026-11-11 の指示を直す前の実測（150 回）で唯一の不合格だった「1 文が 2 項目に当たるのに片方にしか付かない」（78 点と 85 点。直した後の 90 回は全部合格）が、起きにくくなる見込み（測って確かめる）。
3. **Claude の Sonnet 5.5・Haiku 5.5 は temperature を既定から変えられず（変えると 400）、seed も無い。** API の版 2026-10-21 では、どのモデルでも temperature を送ると 400 になる。他社の seed も「best effort」で、temperature 0 でも同じ入力の 1000 回の答えが 80 通りに分かれた報告がある。**パラメタでは決定的にできない。** 選択肢を減らす・同じ入力の結果を保存する・多数決をとる、といった設計で安定させる。
4. **安いモデルなら多数決をとっても安い。** Haiku 5.5 の単価は Sonnet 5.5 の 1/20（入力 0.10 対 2.00 USD/100 万 token）。3〜5 回を並列に回し、項目ごとに多数決をとっても、Sonnet 1 回より安い見込み。1 回で 20% の確率で判定が割れる項目は、独立なら 3 票の多数決で 10%、5 票で 6% に下がる（誤りは相関するので、実際の効き目はこれより小さい）。
5. **境目の例（anchor）を指示文に入れると、特に弱いモデルで一貫性が上がる。** ただし、指示文を長くすると逆に悪くなるモデルもある（Gemini 1.5 Flash で QWK 0.57 → 0.37）。モデルを替えるたびに、同じ測り方で確かめる必要がある。
6. **測るなら、点の幅より先に「項目の判定の割れ率」を見る。** 3級は満点の重みが 5 しかないので、中心の 1 項目が「言えた ↔ 一部」に割れるだけで内容が 14 点動く。「幅 5 点以内」を守るには、3級では項目の判定がほぼ毎回一致しなければならない。測る件数の目安は、繰り返しのぶれに 60 答え × 5 回、モデル間の一致に同じ 60 答え、人との一致に 100 答え（約 600 の項目の判定）を 2 人で付けたもの。採点専用の小さなモデル（Prometheus 2 など）や蒸留は、今は優先しない。人との相関が GPT-4 より低く（FLASK で 0.55 対 0.68）、場面が増え続ける形では、場面をまたぐ学習データとホスティングが要るため。

---

## 調べたこと（出典ごと）

### 1. 人との一致（英作文）

#### Mizumoto & Eguchi（2023、Research Methods in Applied Linguistics 2(2) 100050）
- GPT-3 の text-davinci-003 で TOEFL11（ETS の非母語話者の英作文、12,100 本、級は low / medium / high）を全部採点し、基準の級と比べた。言語の指標（語彙・文法・まとまりなど）を GPT の点と組み合わせた回帰で、GPT の点だけより予測が良くなり、語彙の指標がいちばん効いた（著者のページと要旨より）。
- 数値は原典（ScienceDirect は 403）を読めず、二次の引用だけ確かめた。Iwanaka（2026、山口県立大学）の総説によると、基準の級との隣接一致（1 段以内）は 89.15%、採点し直したときの点の動きは多くが 1〜2 点で、級内の信頼性は「moderate」。QWK の値は二次の出典どうしで食い違う（0.388 や 0.682 という引用がある）ので、**未確認**。2026-11-16 にも原典を探したが開けなかった（OA の CC BY だが、ScienceDirect が自動の取得を 403 で断り、Elsevier の API は鍵が要る。著者の頁の要旨に数値は無い）。
- 当てはめ: 「LLM の点 ＋ 決まった指標」の組み合わせが LLM 単独より良い、という最初期の根拠。今のアプリの「LLM が判定し、コードが計算する」の方向と合う。

#### Yancey, LaFlair, Verardi & Burstein（2023、BEA、Duolingo）
- Duolingo English Test の 5 分の短い英作文を、CEFR の 6 段階と「採点できない」2 種の 8 区分で採点。人 1 との比較は 1,175 本。人どうしの QWK は 0.87。
- **例（calibration example）を入れない GPT-4 と GPT-3.5 は、文字数だけで当てる分類器にも勝てなかった（QWK 約 0.6）。段階ごとに 1 つ例を入れると、GPT-4 は 0.81 になり、85 個の言語の特徴を使う従来の自動採点（0.84）にほぼ並んだ。** 例を増やしても伸びなかった。GPT-3.5 は例を 2 つ入れても 0.7 前後。
- 詳しいルーブリックと「理由を先に書く」は、例が無いときには効いたが、例を 1 つ入れた後はほとんど差が無かった。
- 書き手の母語で一致が違った（スペイン語 0.89、テルグ語 0.66）。GPT-4 は人より平均 +0.15 段階甘かった。
- 出典: https://aclanthology.org/2023.bea-1.49 （2023）

#### Yoshida（2025、AIED 2025、arXiv 2505.01035）
- TOEFL11 の 12,100 本を、Claude 3.5 Haiku・GPT-4o-mini・Gemini 1.5 Flash・Llama 3 70B で採点。ルーブリック無し・短いルーブリック（78 語）・本来のルーブリック（375 語）を比べた。
- QWK は 0.52〜0.63（原典の図 3 から読んだ値。Gemini 1.5 Flash の本来のルーブリックの 0.37 を除く。本文は「0.6 前後」とだけ書く。2026-11-16 に確かめた）。3 つのモデルは短いルーブリックで本来のものとほぼ同じ（差 0.01 未満）、入力の token は約 6 割。**Gemini 1.5 Flash は詳しくするほど下がった（約 0.57 → 0.37）**。著者は「QWK 0.6 前後は、人どうし（0.8〜0.9）に届かず、指示文だけの LLM の採点はまだ実用に足りない」とまとめている。
- 出典: https://arxiv.org/abs/2505.01035 （2025）

#### Pack, Barrett & Escalante（2024、Computers and Education: AI 6）
- 英語のクラス分けの試験の 119 本を、PaLM 2・Claude 2・GPT-3.5・GPT-4 で、時期を空けて 2 回ずつ採点し、2 人の人と比べた。GPT-4 が最も良く、級内の信頼性は「excellent」、妥当性は「good」。GPT-3.5 以外は 2 回目に級内の信頼性が上がった。人との一致は GPT-3.5・GPT-4 で少し下がった。
- 出典: https://doaj.org/article/7b38bf3f0de448dc8f48ab09a9243db5 （2024、要旨と二次の要約から。数値は未確認。原典を探したが開けなかった（DOAJ の頁は JavaScript で描き、本文の ScienceDirect は自動の取得を 403 で断る））

#### Kundu & Barbosa（2024、arXiv 2409.13120）
- ASAP の英作文で、ChatGPT（GPT-3.5）と Llama は人より点が低く、人の点との一致も弱かった。Llama-3 が最も良かった。著者は「人の採点の代わりにはならず、補助の道具」と結論。
- 出典: https://arxiv.org/abs/2409.13120 （2024）

#### Gayed（2026、arXiv 2607.14605）
- Gemma-3-27B を、2 つのお題の 480 本だけで LoRA で調整し、見たことのない 8 つのお題の TOEFL11 12,100 本で QWK 0.702、級の一致 77.8%。
- **同じ級の中で、ヨーロッパの言語が母語の書き手が、東アジアの言語が母語の書き手より高く採点される、母語による偏りがあった。** 日本の中高生だけが使うアプリでは、母語の偏りは順位には効きにくいが、他の国の基準と比べる説明には注意が要る。
- 出典: https://arxiv.org/abs/2607.14605 （2026、単著の preprint）

### 2. 人との一致（話す答え）

#### Uchida（2024、Learner Corpus Studies in Asia and the World 6、神戸大学の機関リポジトリ）
- ICNALE GRA（話す答えと書いた答えが 140 件ずつ、80 人の評価者が点を付けたもの）の点と、ChatGPT の点を比べた。**話す答えの総合点との相関（最も高いもの）は ChatGPT 3.5 で 0.341、4.0 で 0.561、指示文を工夫して 0.641。書いた答えは 3.5 で 0.801、4.0 で 0.888。** 同じ LLM でも、文字起こしした話し言葉の採点は、書いた英文よりかなり難しい。
- 出典: Uchida, S. (2024). Evaluating the Accuracy of ChatGPT in Assessing Writing and Speaking: A Verification Study Using ICNALE GRA. https://da.lib.kobe-u.ac.jp/da/kernel/0100487710/ （2024-03-20。数値はリポジトリの要旨で、題と書誌は PDF で 2026-11-16 に確かめた）

#### Bannò, Ma, Qian, Tang, Knill & Gales（2025、SLaTE 2025、arXiv 2507.10200）
- 公開の Speak & Improve Corpus 2025 の話す答えを、Whisper small の文字起こしにして、Qwen 2.5 72B にゼロショットで採点させた。数字の点を直接言わせず、試験官向けの CEFR の「できること」の説明文（A〜F）から選ばせ、選択肢の logit を softmax にした確率で重み付けた平均（Fair Average）を点にした。説明文の並びを 3 通りに入れ替えて平均した。
- 相関（PCC、eval）: ゼロショットの Qwen 72B 0.761、学習させた BERT 0.727、学習させた音声の LLM（Qwen2-Audio）0.821。並びを入れ替えたときの分布の違い（Jensen-Shannon）は多くの観点で 0.03〜0.16 と小さいが、文法の正確さ（0.25）などは大きかった。
- 当てはめ: 「数字ではなく、決まった説明文から選ばせる」「並びを入れ替えて平均する」は、表現の段階の採点にそのまま使える考え方。
- 出典: https://arxiv.org/abs/2507.10200 （2025）

#### Ma, Qian, Tang, Bannò, Knill & Gales（2025、Interspeech 2025、arXiv 2505.21148）
- Linguaskill（非公開、学習 31,476 件）と S&I（学習 6,640 件）で、音声の LLM（Qwen2-Audio-7B）を LoRA（rank 16）で調整した。
- 全体の PCC: **ゼロショット 0.640 → 学習後 0.954**。文字起こしに BERT 0.942、wav2vec2 0.934。話す答えの総合の採点では、学習データがあれば専用のモデルが LLM のゼロショットを大きく上回る。
- 出典: https://arxiv.org/abs/2505.21148 、https://www.isca-archive.org/interspeech_2025/ma25b_interspeech.html （2025）

> 日本の中高生が 20 秒で場面を描写した答えを LLM で採点した研究は見つからなかった。近いのは Uchida（2024、ICNALE）と S&I の研究。

### 3. 判定の一般の信頼性とモデルの大きさ

#### Zheng et al.（2023、NeurIPS、MT-Bench）
- GPT-4 の判定と人の一致は、引き分けを除いて 85%。人どうしは 81〜82%。
- **位置の偏り**（2 つの答えを入れ替えても同じ判定をする割合）: GPT-4 65.0%、GPT-3.5 46.2%、Claude-v1 23.8%。**例（few-shot）を入れると、Claude-v1 23.8 → 63.7%、GPT-3.5 46.2 → 55.0%、GPT-4 65.0 → 77.5%**。
- **長さの偏り**（中身を増やさず言い換えを並べて長くした答えに騙される割合）: Claude-v1 と GPT-3.5 が 91.3%、GPT-4 が 8.7%。
- 出典: https://arxiv.org/abs/2306.05685 （2023）

#### Thakur et al.（2024〜2025、GEM 2025、arXiv 2406.12624）
- 13 の判定モデルで、人と十分に一致したのは最も大きいモデルだけ。一致した割合（percent agreement）ではモデルの差が見えず、Scott の π のような偶然を除いた指標が要る。判定モデルには甘くつける偏り（leniency）があった。順位を付けるだけなら、小さなモデルや単語の一致でもそれなりに当たった。
- 出典: https://arxiv.org/abs/2406.12624 （2024、版により数値が違う）

#### Verga et al.（2024、Cohere、PoLL）
- 参照の答えがある QA の正誤（二値）の判定で、Cohen の κ（人との一致）は GPT-4 0.627 / 0.841 / 0.830（NQ / TriviaQA / HotpotQA）に対し、**Claude 3 Haiku 0.749 / 0.894 / 0.873、Command R・GPT-3.5 も 0.73〜0.90**。3 つの小さなモデルの多数決（PoLL）は 0.763 / 0.906 / 0.867 で、費用は GPT-4 Turbo の 1/7〜1/8（原典の表 1 と 4.5 節で 2026-11-16 に確かめた。GPT-3.5 は 0.726 / 0.859 / 0.833、Command R は 0.734 / 0.902 / 0.815）。
- 指示文の違いで GPT-4 の κ が 0.518〜0.725 と 0.21 も動いた。ある モデルに合わせた指示文は、別のモデルでは悪くなった（GPT-3.5 は 0.729 → 0.509）。
- 当てはめ: **「参照（チェックリストの accept）と比べて、言ったか言わないかを決める」形なら、小さなモデルでも大きなモデル並みになりうる**、という根拠。指示文はモデルごとに確かめる必要がある、という注意。
- 出典: https://arxiv.org/abs/2404.18796 （2024）

### 4. 安定させる手法

#### 4-1. チェックリスト（小さな yes/no に分ける）

- **CheckEval**（Lee et al.、arXiv 2403.18771、v2 は 2025-03。下の値は v3（2025-10-31）の評価モデルの間の一致の表と表 15 で 2026-11-16 に確かめた）: 要約と対話の評価で、観点を人が決め、yes/no の問いを 20〜33 個に展開し、「yes の割合」を点にする。12 の評価モデル（7B〜123B と GPT）で比べた。
  - 評価モデルの間の一致（Krippendorff の α、SummEval）: 1〜5 点で付ける G-Eval が 0.09、**CheckEval が 0.48**。大きいモデルどうしは 0.05 → 0.67、**小さいモデル（7〜9B）どうしは 0.06 → 0.24 にとどまる**。
  - 人との相関（Spearman）: Llama3.1-8B で 0.24 → 0.41。モデルの間の相関のばらつき（分散）は約 8 割減った。
  - 弱点: yes/no では長い文章の質の差を拾いにくい。品質の低い文章で一部の観点が悪くなった。
  - 出典: https://arxiv.org/abs/2403.18771
- **TICK**（Cook et al.、2024、NeurIPS の workshop）: 指示から LLM が yes/no の問いを作り、それに答えて「通った割合」を点にする。GPT-4o の判定で、人の好みと完全に一致した割合が 46.4% → 52.2%。人がチェックリストを見ながら付けると、人どうしの α が 0.194 → 0.256。問いごとの答えの正しさは GPT-4o 0.826、Command-R+ 0.781、Llama3.1-70B 0.778。理由を書かせると正しさが上がり、多数決の票を増やすとさらに上がった。GPT-4o の問いごとの正しさを図 2 から読むと、直接答える 約 0.78 → 理由つき 0.826 → 理由つき 5 票 約 0.83 → 15 票 約 0.87（図から読んだ値。2026-11-16 に原典で確かめた）。
  - 出典: https://arxiv.org/abs/2410.03608 （2024）
- **BiGGen Bench**（Kim et al.、NAACL 2025）: 765 問それぞれに専用の採点基準（instance-specific rubric）を付けた。専用の基準は、大まかな基準や分野ごとの基準より人との相関が一貫して高かった。人との Pearson: GPT-4-Turbo 0.623、GPT-4-1106 0.597、Claude-3-Opus 0.578、Prometheus-2 8x7B 0.471、**同じ判定を 3 回とった Prometheus-2-BGB が 0.577 → 0.607**、5 つの評価モデルの多数決 0.627。
  - 出典: https://arxiv.org/abs/2406.05761 （2024〜2025）
- **FLASK**（Ye et al.、ICLR 2024）: 全体の好みを、問いごとに必要な技能の点に分けて付ける。技能ごとに分けると、人との相関が上がった（原典の表 1 で 2026-11-16 に確かめた）。
  - Spearman: GPT-4 0.641 → 0.680、GPT-3.5 0.360 → 0.424、Claude 0.352 → 0.432（Pearson は GPT-4 0.673 → 0.732）。
  - GPT-4 の FLASK から参照の答えを除くと 0.516、理由を除くと 0.634、技能ごとの採点基準を除くと 0.646 に下がった。参照の答えがいちばん効く。
  - BiGGen では、分野ごとの基準（FLASK 型）が大まかな基準より低く出ており、結果は食い違う。
  - 出典: https://arxiv.org/abs/2307.10928
- **DSG**（Cho et al.、ICLR 2024）: 画像の生成の評価で、文を最小の意味の単位の yes/no の問いに分け、問いの間に依存（親が no なら子を問わない）を付けた。問いの重複・抜け・幻覚を減らすため。
  - 出典: https://arxiv.org/abs/2310.18235
- **RubricEval**（Pan et al.、arXiv 2603.25133、2026-03）: 指示に従えたかを、採点基準の 1 項目ずつで判定する評価モデルの正しさを測るベンチマーク（3,486 件）。難しい組では GPT-4o でも 55.97%。項目ごとの判定はチェックリストの粒度より正しく、理由を書かせると正しさが上がり、両方で判定モデルの間のばらつきが減った（要旨で 2026-11-16 に確かめた。本文の表は読んでいない）。
  - 出典: https://arxiv.org/abs/2603.25133

#### 4-2. 理由を先に書かせるか、点を先にするか

- **Chiang & Lee（2023、EMNLP Findings）**: ChatGPT（gpt-3.5-turbo）で SummEval の一貫性（coherence）を採点。点だけ出させると Pearson 0.344、点の後に理由（rate-explain）で 0.557、先に分析してから点（analyze-rate）で 0.635。先か後かの差は有意でなく、**「理由を書かせること」自体が効く**。点だけの方式は temperature で相関が 0.356〜0.450 と動いたが、理由つきの方式は安定した。
  - 出典: https://arxiv.org/abs/2310.05657 （2023）
- Yancey（2023）では、例を入れた後は理由の効果がほぼ無かった。
- **Tam et al.（2024、EMNLP Industry）**: JSON などの厳しい形式の縛りは推論の課題の正しさを下げるが、分類の課題では下げない（上がることもある）。縛りが厳しいほど推論が落ちる。
  - 出典: https://aclanthology.org/2024.emnlp-industry.91 （2024）
- 当てはめ: 今の schema は引用（quote）を判定（verdict）より先に置き、表現は根拠（expressionBasis）を点より先に置いている。これは文献と合う。Claude の adaptive thinking は JSON の前に考えるので、形式の縛りによる推論の低下は起きにくい。安いモデルで thinking を減らすなら、項目ごとに短い根拠の欄を判定の前に置く価値がある。

#### 4-3. 基準の答えの例（few-shot の anchor）

- Yancey（2023）: 段階ごとに 1 例で GPT-4 の QWK 約 0.6 → 0.81。例は、評価の専門家 2 人が付けて一致した 180 本から選んだ。
- MT-Bench（2023）: 例を入れると位置の一貫性が上がり、弱いモデルほど大きい（Claude-v1 は 2.7 倍）。ただし GPT-4 の人との一致は上がらなかった（一貫性と正しさは別に動く）。
- PoLL（2024）: 例の入れ方の違いで κ が大きく動いた（0.518〜0.725）。
- Yoshida（2025）: 長い指示文で悪くなるモデルがある。
- 当てはめ: 例は「一貫性」を上げる手段として効く。正しさは人の判定で別に確かめる。例は指示文の固定の部分に置き、prompt caching で安くする。

#### 4-4. 同じ採点を何度か回して多数決（self-consistency）

- BiGGen（2024〜2025）: 3 回の多数決で Pearson +0.03（0.577 → 0.607）。5 回でも同じ。
- Chiang & Lee（2023）: 20 回（実験によって 5 回）の平均を使い、5 回以上で安定とした。
- Schroeder & Wood-Doughty（2024、arXiv 2412.12509）: 3 つの 7〜8B の判定モデルで、同じ問いを 100 回判定させた内的一貫性（McDonald の ω）は 0.42〜0.80 で、モデルと temperature で変わる。1 回の出力は分布からの 1 つの標本にすぎない。
  - 出典: https://arxiv.org/abs/2412.12509
- Yagubyan（2026、arXiv 2606.13685、単著の preprint）: GPT-4o-mini・GPT-4.1-mini の 2 択の判定は、同じ入力で平均 13.6% 反転し、多数決が 50 回の結果に 95% で一致するには平均 11 回、割れやすい問いでは 15 回要った。同じ意味の指示文の言い換えで、多数の結論が 25% 変わった。
  - 出典: https://arxiv.org/abs/2606.13685
- Bannò（2025）: 選択肢の並びを 3 通りに入れ替えて平均した。
- 当てはめ: 多数決は「同じ答えで同じ点」に効くが、偏り（いつも同じ方向に間違える）は直らない。並びの入れ替えで誤りの相関を下げられる。

#### 4-5. temperature・seed・構造化出力

- **Claude**: Anthropic の文書（Claude API の skill に同梱、2026-11-03 時点）によると、**Sonnet 5.5 と Haiku 5.5 は temperature・top_p・top_k を既定以外にすると 400**。**API の版 2026-10-21 では、どのモデルでも、既定の値でも、送ると 400**。seed の欄は文書に見当たらない。Haiku 5.5 の effort の既定は medium、Sonnet 5.5 は high。構造化出力（`output_config.format` の JSON schema）は、skill の記述では全モデルで使える。
  - 出典: https://platform.claude.com/docs/en/api/versioning 、https://platform.claude.com/docs/en/about-claude/pricing （skill の写しで確かめ、料金は 2026-11-16 に料金のページでも確かめた）
- **OpenAI の seed**: 「best effort で決定的に sample する。保証はしない」。裏側の構成が変わると `system_fingerprint` が変わる。
  - 出典: https://cookbook.openai.com/examples/reproducible_outputs_with_the_seed_parameter
- **Thinking Machines（Horace He ほか、2025-09-10）**: Qwen3-235B を temperature 0 で 1000 回、1000 token 生成すると、80 通りの答えが出た（最も多いものが 78 回、103 token 目で分かれた）。原因は、サーバーの混み具合で batch の大きさが変わり、計算の順が変わること。batch に依存しない kernel にすると 1000 回とも同じになった（遅くなる）。
  - 出典: https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/
- **Atil et al.（2024、arXiv 2408.04667）**: 5 つの LLM で temperature 0 の同じ入力を 5〜10 回、正しさが最大 10% 動いた。
  - 出典: https://arxiv.org/abs/2408.04667
- 当てはめ: どの会社の API を使っても、パラメタで決定的にはできない。Claude では手段そのものが無い。

#### 4-6. 点の調整（calibration）

- **LLM-Rubric**（Hashemi et al.、ACL 2024）: ルーブリックの 9 問それぞれに LLM が出した確率の分布を、小さなニューラルネットで人ごとの点に合わせた。1〜4 の満足度の予測で、二乗平均の誤差が 0.5 未満、調整しないものの約半分。
  - 出典: https://aclanthology.org/2024.acl-long.745
- Bannò（2025）・G-Eval（Liu et al. 2023、https://arxiv.org/abs/2303.16634 ）は、点の token の確率で重みを付けた期待値を使う。Claude の Messages API には token の確率を返す欄が無い（API の参照の「Create a Message」の要求と応答の欄に logprobs が無いことを、2026-11-16 に https://platform.claude.com/docs/en/api/messages/create.md で確かめた）。その代わりは、複数回の票の割合。

#### 4-7. 相対の比較（pairwise）と絶対の点

- **Liusie, Manakul & Gales（2024、EACL）**: FlanT5・Llama2（〜13B）で、点を直接付けさせる方式の Spearman が 0.01〜0.25 程度なのに対し、2 つを比べる方式は 0.2〜0.55。ただし最初の答えを選ぶ割合が 0.18〜0.68 とずれ、大きいモデルほど偏りやすかった。比べる数は答えの数の 2 乗で増える。
  - 出典: https://aclanthology.org/2024.eacl-long.8
- **LCES**（Shibata & Miyamura、2025、EMNLP）: 英作文で、直接の採点の QWK（TOEFL11）は Llama-3.1-8B 0.021、GPT-4o-mini 0.122 しかないが、2 つを比べて RankNet で点に直すと 0.633・0.658。ASAP でも 0.19〜0.51 → 0.62〜0.67。各組は順を入れ替えて 2 回問い、食い違えば引き分け。
  - 出典: https://arxiv.org/abs/2505.08498
- 当てはめ: **小さなモデルほど、総合の点を直接言わせるより、比べさせるほうがずっと安定する**。ただし、きろくに残す点は絶対の点である必要があり、比べる相手が部屋の 2〜4 人しかいないので、内容の点には使いにくい。使うなら、手元で表現の段階を調整するとき。

#### 4-8. 位置や長さの偏り

- 位置: MT-Bench（Claude-v1 は 75% で最初を選ぶ）、Wang et al.（2023〜2024、ACL 2024、https://arxiv.org/abs/2305.17926 ）は、入れ替えて両方を集計する（Balanced Position Calibration）と、根拠を複数書かせて合わせる（Multiple Evidence Calibration）で偏りを減らした。
- 長さ: MT-Bench の「言い換えを並べる」攻撃に、GPT-3.5・Claude-v1 は 91.3% 騙された。
- 当てはめ: 今のアプリは 1 人ずつ絶対の判定をするので、2 つを並べたときの位置の偏りは無い。ただし、チェックリストの項目や場面の物の並び順が判定に影響するかは測っていない。多数決をとるなら、票ごとに並びを入れ替える。長さは、F1 の適合率（P）が水増しを抑える仕組みになっている。

### 5. 採点専用の小さな評価用のモデル

- **Prometheus 2**（Kim et al.、EMNLP 2024）: Mistral-7B と Mixtral-8x7B を、ルーブリック（観点と 1〜5 の各点の説明）・参照の答え・答えを入れて、講評と 1〜5 の点を出すように学習（直接の採点 10 万件、比較 20 万件、重みを混ぜる）。
  - 直接の採点の Pearson（FLASK、人との）: Prometheus-2-7B 0.545、8x7B 0.555、Auto-J（13B）0.473、Llama2-70B 0.317。**GPT-4-1106 と人は 0.679**（原典の表 1 で 2026-11-16 に確かめた）。GPT-4 との相関なら 0.6〜0.7。比較の一致（MT Bench の人の判定、引き分けを除く）: 7B 70.8%、8x7B 72.0%、GPT-4 79.9%。
  - 出典: https://arxiv.org/abs/2405.01535
- **JudgeLM**（Zhu et al.、ICLR 2025）: 7B・13B・33B を GPT-4 の判定 10 万件で学習。教師の GPT-4 との一致 90% 超（人どうしの 82% より高い、と著者）。ただし教師との一致で、人との一致ではない。
  - 出典: https://arxiv.org/abs/2310.17631
- **Auto-J**（Li et al.、2023、ICLR 2024）: 13B の生成型の判定モデル。値は上の Prometheus 2 の表のとおり。
  - 出典: https://arxiv.org/abs/2310.05470 （ID は Prometheus 2 の文献表から。本体は未読）
- **Atla Selene Mini**（2025-01、8B）: 11 の分布外のベンチマークで GPT-4o-mini を上回ると著者は述べる。二値・1〜5・比較を指示で選べる。重みは公開。11 のベンチマークの課題の平均は Selene Mini 0.756、GPT-4o-mini 0.743、Prometheus-2-7B 0.520。絶対の採点の課題の平均は 0.648 対 0.640 で差は小さく、FLASK だけなら 0.613 対 0.615（原典の表 1 で 2026-11-16 に確かめた）。
  - 出典: https://arxiv.org/abs/2501.17195
- Thakur et al.（2024）でも、JudgeLM-7B は順位付けでは健闘したが、点の一致は大きいモデルに届かなかった。
- 当てはめ: これらは「指示への答え」を 1〜5 で付けるための汎用の評価モデル。このアプリの判定（場面の JSON と比べて、20 秒の文字起こしがチェックリストの各項目を言えたか）は、それより狭く、場面の情報を読む必要がある。汎用の評価モデルを入れても、安い API のモデル（Haiku 5.5）より良くなる根拠は見つからなかった。自分でホスティングする手間（Cloudflare Workers では大きなモデルを動かせない。Workers AI の文書にこれらのモデルは無く、自前の重みは対応する LLM の LoRA（rank 32 まで）を載せる形だけ。2026-11-16 に確かめた）もかかる。

### 6. 蒸留と採点専用の fine-tune

- **Ormerod & Kwako（2024、arXiv 2407.01873）**: ASAP の英作文（お題ごとの学習 434〜1,083 本）と短答（ASAS、お題ごとに約 1,000 件）で、4-bit・LoRA（r = 32）の小さな LLM を調整。英作文の平均 QWK: Llama-3-8B 0.789、Phi-3-mini 0.786、Mistral-7B 0.782、**BERT-base 0.758**、人どうし 0.752。短答: 0.749〜0.759、人どうし 0.874。24 GB の GPU 1 枚で学習でき、推論の時間は BERT-base の 18〜38 倍。
  - **英作文では、お題ごとに約 1,000 件の採点があれば、BERT 程度のエンコーダーでも人並みになる。** 小さな LLM の LoRA は少し上だが、重い。**短答（このアプリの項目の判定に近い）では、0.749〜0.759 で人どうしの 0.874 に届かなかった。**
  - 出典: https://arxiv.org/abs/2407.01873 （2024）
- Gayed（2026）: 480 本で調整した Gemma-3-27B が、見たことのないお題で QWK 0.70（上記）。
- Xiao et al.（2024、LAK 2025、arXiv 2401.06431）: 調整した LLM の速い採点（Fast）に、自信の低い答えだけ遅い推論（Slow）に回す仕組みを付けた。人と AI の共同の採点では、初心者の採点者の QWK が 0.5256 → 0.6609 に上がり（p < 0.01）、熟練者（0.7117）と有意な差が無くなった。熟練者は 0.7117 → 0.7734 に上がったが、有意ではなかった（p = 0.13）（原典の 6.2 節と表 3 で確かめた。前の版の「自信の低い答えを人に回す」は誤りで、回す先は遅い推論。2026-11-16 に原典で直した）。
  - 出典: https://arxiv.org/abs/2401.06431
- Latif et al.（arXiv 2312.15842）: 理科の記述式で、教師（調整した BERT）の柔らかいラベルから小さな生徒を学習し、教師並みの正しさを、桁違いに小さく速いモデルで得た。
  - 出典: https://arxiv.org/abs/2312.15842
- **Kaggle**（The Learning Agency Lab）: Feedback Prize - English Language Learning（2022、8〜12 年生の英語学習者の英作文、ELLIPSE、6 つの観点の点、評価は MCRMSE）と、Automated Essay Scoring 2.0（2024、QWK）。上位は DeBERTa-v3-large を中心にした ensemble だった、という報告が複数ある（25 位の解法の README など）。公開の leaderboard の 1 位は、ELL が MCRMSE 0.433356（小さいほど良い）、AES 2.0 が QWK 0.84128（kaggle CLI で 2026-11-16 に取得）。**最終の順位（private の leaderboard）の 1 位の点は、CLI でも頁でも取れず未確認**（Kaggle の頁は JavaScript で描き、API は公開の leaderboard だけを返す）。
  - 出典: https://www.kaggle.com/competitions/feedback-prize-english-language-learning 、https://www.kaggle.com/competitions/learning-agency-lab-automated-essay-scoring-2
- **SemEval-2013 Task 7**（学生の答えの分析）: 答えを正解・一部（不完全）・矛盾・無関係・分野外の 5 つに分ける課題で、このアプリの判定（correct / partial / contradiction / offtopic / absent）とよく似ている。当時の素性ベースの系では、SciEntsBank の 5 分類の macro-F1 が最高 0.380、平均 0.267（参加者の論文の表から）。細かい 5 つの区別は難しい課題。
  - 出典: https://huggingface.co/datasets/nkazi/SciEntsBank （データ）、https://preview.aclanthology.org/fix_video/S13-2097.pdf （参加者の論文）

### 7. LLM を抜き出しと判定に限り、点はコードで計算する（hybrid）

- **FActScore**（Min et al.、EMNLP 2023）: 生成文を最小の事実（atomic fact）に分け、それぞれを知識源で確かめ、支持された事実の割合を点にする。自動の推定は人の値との誤差 2% 未満と報告（原典の要旨で 2026-11-16 に確かめた）。
  - 出典: https://aclanthology.org/2023.emnlp-main.741
- **SAFE**（Wei et al.、2024、NeurIPS 2024）: LLM で事実に分け、検索で確かめ、**適合率と「K 個までの再現率」の調和平均 F1@K** を点にする。このアプリの F1 とほぼ同じ形。約 1.6 万の事実で、人（クラウドソーシング）の判定と 72% 一致し、食い違った 100 件では SAFE が 76% で正しかった（人は 19%）。費用は人の 1/20 以下（原典の 4 節で 2026-11-16 に確かめた）。
  - 出典: https://arxiv.org/abs/2403.18802
- **SPICE**（Anderson et al.、ECCV 2016）: 画像の説明文を、構文解析で場面グラフ（物・属性・関係の組）に直し、正解の説明の組との F 値で採点する。COCO で、システム単位の人の判定との相関 0.88。決まった規則（構文解析と同義語の一致）だけで点を出す。弱点は構文解析の誤り。
  - 出典: https://arxiv.org/abs/1607.08822
- **DSG**（上記）: 問いの依存で、矛盾した答えが広がらないようにする。
- 当てはめ: このアプリは既に「LLM で事実に分けて判定 → コードで F1」という FActScore・SAFE と同じ形。場面が JSON（物・関係）で構造化されているので、SPICE のように「場面グラフとの照合」をコードで行える余地が、一般の文章の評価より大きい。

### 8. 今のアプリの判定で、ぶれが出る所（repo を読んで）

1 回の呼び出しで、LLM は次の 5 つを同時にしている（`checklistGrade.ts` の `SYSTEM`、約 10,400 文字 ≒ 2,400 token）。

1. 発話を描写（claim）に分ける（分け方で P の分母が変わる）
2. 各描写の正誤（correct / contradiction / absent / offtopic / ignored）
3. 当たる項目（id）と、言えた / 一部
4. 表現の段階（0〜100 の整数）と根拠
5. 講評（次の一つ・言い直し）

点に効くぶれは次のとおり（数字は下の「数値の例」）。

| ぶれ | 点への効き方 | 2026-11-11 の実測で見えたもの |
| --- | --- | --- |
| 項目の「言えた ↔ 一部 ↔ 言えていない」 | R が重み ÷ 満点だけ跳ぶ。3級で大きい | 1 文が 2 項目に当たるとき片方にしか付かない（78 / 85） |
| 描写の分け方 | P の分母が変わる | 位置だけの誤りで文ごと矛盾（指示で直した） |
| correct ↔ ignored ↔ 誤り | P が変わる | 推測の扱い |
| その他の件数（0〜2） | R に最大 1 の重み | — |
| 表現の段階 | 表現が段階ごとに跳ぶ | 正しい英文に 0 点（呼び直しで対処） |

誤りの 3 種（contradiction・absent・offtopic）の間で割れても点は変わらない（P では同じ「誤り」）。点を動かすのは「項目の段階」「描写の数」「ignored との境目」の 3 つ。

---

## 数値の例（手で計算できる規模）

### 項目の判定が 1 つ割れたときの内容の点

内容 = 100 × 2PR / (P + R)。R = 言えた重み ÷ 満点の重み。重みは中心 2・理由 2・つながり 2・細部 1。P = 1（誤り無し）とする。

| 級（満点の重み） | 元（R） | 中心 1 つが 言えた → 一部 | 中心 1 つが 言えた → 言えていない |
| --- | --- | --- | --- |
| `eiken-3`（5） | 4/5 → 89 点 | 3/5 → 75 点（−14） | 2/5 → 57 点（−32） |
| `eiken-pre2`（10） | 8/10 → 89 点 | 7/10 → 82 点（−7） | 6/10 → 75 点（−14） |
| `eiken-2`（14） | 11/14 → 88 点 | 10/14 → 83 点（−5） | 9/14 → 78 点（−10） |

例: `eiken-3` で R = 4/5 = 0.8、P = 1 なら 2 × 1 × 0.8 / 1.8 = 0.889 → 89 点。中心の 1 つが一部になると、言えた重みが 4 → 3 で R = 0.6、2 × 0.6 / 1.6 = 0.75 → 75 点。

描写の正誤が 1 つ割れた場合: `eiken-3` で R = 0.8、5 つの描写のうち 1 つが correct → contradiction に割れると、P = 1 → 0.8、内容は 2 × 0.8 × 0.8 / 1.6 = 0.8 → 80 点（−9）。

**読み取れること**: 「同じ答えの 5 回の幅 5 点以内」は、`eiken-2` なら 1 項目の一部 ↔ 言えたの割れまで許せるが、`eiken-3` では中心の項目が 1 回でも割れると守れない。3級は項目が少なく、1 項目の重みが大きいため。安いモデルで最初に崩れるのは 3級になるはず。

### 多数決で割れる確率がどれだけ下がるか

ある項目で、1 回の判定が少数派の答えになる確率を p とし、票が独立だとする。3 票の多数決で少数派が勝つ確率は 3p²(1−p) + p³、5 票では 10p³(1−p)² + 5p⁴(1−p) + p⁵。

| 1 回の割れる確率 p | 3 票 | 5 票 |
| --- | --- | --- |
| 0.1 | 0.028 | 0.009 |
| 0.2 | 0.104 | 0.058 |
| 0.3 | 0.216 | 0.163 |

例: p = 0.2 なら 3 × 0.04 × 0.8 + 0.008 = 0.104。実際は同じ指示文・同じモデルの誤りは相関するので、これより下がりにくい。並びの入れ替えや、2 種類のモデルを混ぜる（PoLL）と相関を下げられる。

### 「5 回の幅」と標準偏差

正規分布から 5 個とったときの幅（最大 − 最小）の期待値は、標準偏差 σ の約 2.33 倍（品質管理の係数 d₂ = 2.326）。幅の平均を 5 点以内にするには σ ≒ 2.1 点以内。ただし、このアプリのぶれは上の表のように段で跳ぶので、正規分布の見方より「何回に 1 回、項目が割れるか」で見るほうが正しい。2026-11-09 の旧版の「平均 2.4 点・最大 10 点」は、ほとんどの答えは動かず、一部の答えだけが段で跳んだ形と読める。

### 測る件数と、一致の値の幅（95% の信頼区間）

- 相関 r = 0.8 の推定（Fisher の z、SE = 1/√(n−3)）: 30 件で 0.62〜0.90、50 件で 0.67〜0.88、100 件で 0.72〜0.86、200 件で 0.74〜0.85。
- 項目の判定の一致率 0.9 の推定（SE = √(0.9 × 0.1 / n)）: 100 判定で ±0.06、300 判定で ±0.03、600 判定で ±0.02。
- Cohen の κ（一致率 0.9・偶然の一致 0.5 の二値、大標本の近似 SE = √(p₀(1−p₀) / (n(1−pₑ)²))）: 300 判定で ±0.07、600 判定で ±0.05。
- 100 答え × 1 答えあたり約 6 項目 = 約 600 判定なら、κ を ±0.05 程度で比べられる。

### 費用の見積もり（1 人 1 回の採点）

- 指示文の長さ: `SYSTEM` 約 10,400 文字、試験用の場面（`checklist-eiken-pre2.json`）の本文約 4,200 文字。合わせて入力 約 3,400 token、出力 約 800 token（描写の一覧と講評、思考を除く）と見積もった。
- Sonnet 5.5（入力 2 USD・出力 10 USD / 100 万 token）: 3,400 × 2 + 800 × 10 = 約 0.015 USD（約 2.3 円）。2026-11-09 の実測は旧版で 120 回 0.92 USD（1 回 0.0077 USD）。
- Haiku 5.5（入力 0.10 USD・出力 0.50 USD / 100 万 token、10 万 token 以下）: 3,400 × 0.1 + 800 × 0.5 = 約 0.00074 USD（約 0.1 円）。思考の token が増えるので、実際は 2〜3 倍かもしれない（場面の生成の実測では Sonnet の 1/7 だった。PR #144）。
- **Haiku 5.5 で 5 票とっても、約 0.004〜0.01 USD で、Sonnet 1 回と同じかそれより安い**。待ち時間は 5 票を並列にすれば 1 回の最も遅いもの。Haiku 5.5 の high は 1 回 7〜8 秒だった（`wrangler.jsonc` の注記）ので、effort を下げた時間を測る必要がある。

---

## このアプリへの当てはめ（案ごと）

前提: 今の Sonnet 5.5（low）では、2026-11-11 の実測で 30 通り中 28 通りが幅 0 と、既にかなり安定している。目的は (a) Haiku 5.5 などの安いモデルに替えても幅 5 点以内を保つ、(b) 「AI が何を決め、コードが何を決めるか」をはっきりさせ、AI への依存を減らす、の 2 つ。

### 案 A. 項目ごとに固定の欄で判定させる（再現率を描写の分け方から切り離す）

- 中身: 今は「描写を分ける → 各描写に項目を付ける」で、項目の達成はコードが描写から集める（`itemResults`）。これを、**チェックリストの各項目を schema の必須の欄にし、項目ごとに「引用・段階」を必ず 1 つ返させる**形に変える。描写の一覧（P のため）は別の欄に残す。

```jsonc
// 出力の形の例（項目の id は場面ごとに schema に並べる。今の schemaFor が enum を作るのと同じ）
{
  "items": {
    "woman_wipe": { "quote": "a woman is wiping the table", "level": "full" },
    "why_wipe":   { "quote": "because of the juice",        "level": "full" },
    "plant":      { "quote": null,                           "level": "none" }
  },
  "claims": [ { "quote": "...", "verdict": "correct" } ]
}
```

- 効き目: CheckEval・TICK と同じ「全部の問いに必ず答える」形。2026-11-11 の指示を直す前の唯一の不合格（1 文が 2 項目に当たるのに片方にしか付かない、78 / 85 点）が起きにくくなる見込み（測って確かめる）。R が描写の分け方に依存しなくなる。説明でも「項目ごとに AI が引用を付けて判定し、点は式で計算」と言える。
- 手間: 中（schema・指示文・`checklist.ts` の集計・テスト・`measure-scoring-baseline.ts` の直し）。項目の判定と描写の判定が食い違う場合（項目は言えたなのに、その引用の描写が矛盾）の規則をコードに決める。
- 費用: 出力の token が少し増える程度。
- リスク: 「その他」（一覧に無い正しい描写）は描写の側に残るので、そこは今のぶれが残る。

### 案 B. 段階（言えた / 一部）を、小さな yes/no からコードで決める

- 中身: 今は指示文の長い規則（中心・細部・理由・つながりで「一部」の定義が違う）を LLM に読ませて full / partial を選ばせている。これを、**項目の種類ごとの yes/no を返させ、段階はコードの表で決める**。

| 項目の種類 | LLM が返す yes/no | コードの規則 |
| --- | --- | --- |
| 中心 | 動作を言った・誰がが合う・目的語が合う | 言えた = 動作 ∧ 誰が ∧（目的語 ∨ accept に目的語が無い）。一部 = 動作だけ |
| 細部 | その物を言った・位置や状態を言った | 言えた = 位置や状態。一部 = 物だけ（文で） |
| 理由 | 動作を言った・理由を言った・理由が場面と矛盾する | 言えた = 動作 ∧ 理由 ∧ ¬矛盾。一部 = 理由 ∧ ¬動作 |
| つながり | つながった段の数（0・1・2） | 言えた = 2、一部 = 1 |

- 効き目: 判断が二値になる（PoLL では参照つきの二値判定で小さなモデルが GPT-4 並み）。部分点の規則が指示文の言葉でなくコードの表になり、そのまま振り返りや審査の説明に出せる（「動作は言えたが、誰がが抜けた」）。指示文が短くなり、長い指示文で悪くなるモデル（Gemini Flash の例）にも移しやすい。
- 手間: 中。案 A と一緒に入れるのがよい。今の指示文の「Decide item and level by the kind of the item」の節を表に置き換える。
- 費用: 出力の token は少し増える。
- リスク: yes/no の 1 つ 1 つの誤りが掛け合わさる。規則の境目（「Someone is wiping the table」など）を表で決め切る必要がある（境目の決め方そのものは担当 1 のルーブリックの話）。

### 案 C. 場面との照合をコードに移す（SPICE の考え方）

- 中身: LLM には、発話を「主語・動詞・目的語・前置詞・場所の相手」の組に直させるだけにし、**主語と相手は場面の物の key（＋「その他: 語」）の enum から選ばせる**。正誤はコードが場面の JSON と照合して決める（場面に無い物 → absent、関係が違う → contradiction、合う → correct。左右・前後はどの向きからでもよい規則もコード）。項目への当たりは、項目の `refs` と、作り置きのときに作って固定した動詞の言い換えの一覧で決める。
- 効き目: 位置・数・物の有無の判定が決定的になる。「場面を AI が読み違えて、正しい描写を誤りにする」（ADR に書かれたトレードオフ）が、照合の部分では起きなくなる。チェックリストを作り置きで固定したのと同じ考え方で、判断を生成のときの固定のデータへ移せる。
- 手間: 大（抜き出しの schema、言い換えの一覧の生成と確かめ、照合のコード、作り置きの場面の作り直し、テスト）。理由とつながりの項目はコードでは判定しにくく、LLM に残る。
- 費用: 採点の呼び出しは安くなる方向。作り置きの生成で言い換えの一覧を作る分が増える。
- リスク: 言い換えの漏れで、正しい描写が当たらない（SPICE の弱点と同じ）。文字起こしの誤り（girl → car）が「場面に無い物」として P を下げ、不公平になる（担当 5 の文字起こしの信頼度と合わせて、自信の低い語は ignored にする等の扱いが要る）。**案 A・B の後に、細部の項目から一部だけ試す**のがよい。

### 案 D. 同じ入力の結果を保存して返す（memoize）

- 中身: （場面の ID・チェックリストの版・文字起こし・指示文の版・モデル）の hash を key に、判定の JSON を保存し、同じ入力なら保存したものを返す。
- 効き目: 全く同じ答えには必ず同じ点が返る（公平の説明に使える）。2 回目以降は費用 0。
- 手間: 小（Durable Object の storage や KV に置く）。
- 費用: ほぼ 0。
- リスク: 1 語でも違えば効かない（実際の答えは毎回少しずつ違う）ので、モデルのぶれそのものは減らない。**ぶれの測定（`measure-scoring-baseline.ts`）では保存を通さずに測ること**。説明で「AI が安定している」と言わないこと。

### 案 E. 安いモデルで 3〜5 票の多数決

- 中身: Haiku 5.5 を 3（または 5）回並列に呼び、**項目ごとの段階を多数決**（3 段階なので、最も多いもの。同数なら低いほう）。描写の一覧と講評は、多数決の結果に最も近い 1 回のもの（medoid）を使い、内訳と講評が食い違わないようにする。票ごとに、チェックリストの項目と場面の物の並びを入れ替える（Bannò の 3 通りの並びと同じ考え）。
- 効き目: 上の表のとおり、独立なら 1 回 20% の割れが 3 票で 10%、5 票で 6%。BiGGen では 3 票で相関 +0.03。票の割合を「自信」として残せる（割れた項目は振り返りで弱く出す、人の確認に回す、など）。
- 手間: 中（並列の呼び出し・集計・失敗した票の扱い・測定のスクリプト）。
- 費用: Haiku 5 票で Sonnet 1 回と同程度以下（上の見積もり）。
- リスク: 誤りの相関で効き目が小さい。待ち時間が最も遅い票で決まる（締め切りを過ぎた票は捨てて、残りで決める）。rate limit。**偏りは直らない**ので、案 F・人の判定との比較と合わせる。

### 案 F. 境目の例（anchor）を指示文の固定部分に入れ、prompt caching する

- 中身: 境目の答えと正しい判定の例を 4〜8 個、指示文の固定の部分に置く。例: 名前の並びだけ、位置だけの誤り、1 文で 2 項目、推測（ignored）、文法の誤りだけの答え、文字起こしの誤りらしい語。例の判定は、チームで 2 人が付けて一致したものにする（Yancey が専門家 2 人の一致したものから選んだのと同じ）。表現の段階も、級ごとに段階ごとの短い例を置く。
- 効き目: 一貫性が上がる。弱いモデルほど大きい（MT-Bench で Claude-v1 の一貫性 24% → 64%、Yancey で GPT-4 の QWK 約 0.6 → 0.81）。「専門家の基準を、決まったものとして LLM に渡す」いちばん直接の方法。
- 手間: 小〜中（例を選び、判定を付け、指示文に入れる）。
- 費用: 入力が 1,500〜3,000 token 増える。今の `gradeWithChecklist` は `cache_control` を付けていないので、付ければ固定の部分は安く読める（100 万 token あたり。Sonnet 5.5 のキャッシュの読み出しは 0.10 USD で入力の 1/20。Haiku 5.5 は、10 万 token 以下の入力で、読み出し 0.01 USD（入力の 1/10）、5 分の書き込み 0.125 USD、1 時間の書き込み 0.20 USD。キャッシュできる最小の長さは、どちらも 512 token。2026-11-16 に https://platform.claude.com/docs/en/about-claude/pricing と prompt caching の文書で確かめた）。
- リスク: 例に引きずられる（anchoring）。長い指示文で悪くなるモデルがある（Yoshida）。**モデルごとに、例あり・なしを同じ測り方で比べる**。

### 案 G. 表現の段階を、数字でなく決まった選択肢から選ばせる

- 中身: 表現の 0〜100 の整数を、6 つの段階の enum（0・20・40・60・80・100）にする。あるいは Bannò のように段階の説明文（A〜F）から選ばせる。根拠（expressionBasis）を先に書かせる今の形は保つ。さらに決定的にするなら、「完全な文の数」「誤りの一覧（種類つき）」を返させ、段階はコードで決める。
- 効き目: 選択肢が減り、段階の間の値（例: 70 と 75）のぶれが無くなる。表現は合計の 25%。
- 手間: 小（enum にするだけ）〜大（誤りの一覧からコードで決める）。
- 費用: ほぼ同じ。
- リスク: 段階の境目で 20 点跳ぶ（ぶれが「小さく頻繁」から「大きくまれ」に変わる）。段階の中身は担当 1。

### 案 H. 内容の判定と、表現・講評を別の呼び出しに分ける

- 中身: 1 回で 5 つの仕事をさせている呼び出しを、(1) 内容の判定（案 A・B の狭い構造化出力）と (2) 表現と講評、の 2 つに分けて並列に呼ぶ。(1) を安いモデル＋多数決、(2) を 1 回、のように別のモデルや票の数にできる。
- 効き目: 指示文が短くなり、安いモデルで崩れにくい。講評の生成が判定の邪魔をしない。今の「描写を書いたあと残りの欄を空で終える」応答（`incomplete` の呼び直し）も、欄が分かれて減るはず。
- 手間: 中。
- 費用: 場面の情報を 2 回送る分だけ入力が増える（キャッシュで小さくできる）。
- リスク: 講評が判定の結果と食い違う（講評の呼び出しに判定の結果を渡すと直列になり遅くなる。並列なら、`checkNextStep` のようにコードで確かめて差し替える）。

### 案 I. 採点専用の小さなモデル・蒸留（後回し）

- 中身: (文字起こし, 項目の accept, 種類) → 言えた / 一部 / 言えていない を出すエンコーダー（DeBERTa-v3 や ModernBERT の cross-encoder）を学習する。教師は Sonnet 5.5（high）の 5 票の多数決と、人が確かめた一部。
- データの量の目安: お題ごとの採点なら約 1,000 件で人並み（Ormerod & Kwako）。このアプリは場面が増え続けるので、場面をまたいで効く必要があり、NLI に近い。作り置きの 30〜50 場面 × 30 答え × 約 6 項目 ≒ 5,000〜9,000 の項目の判定。答えは LLM で、間違い・文字起こしの誤り・言いよどみを混ぜて作れる。Sonnet で 1,000 答え × 5 票の判定を付けると、1 回 0.015〜0.017 USD（2026-11-11 の実測の値）として約 75〜85 USD（3 票に減らせば約 45〜51 USD。high にすると思考の分だけ増える）。
- 効き目: 推論は決定的（同じ入力で同じ出力）で安い。「AI のモデルを、自分たちのデータで鍛えた」と説明できる。
- 手間: 大（データ作り・学習・評価・ホスティング。Workers の JS では PyTorch のモデルを動かせず、別の推論の置き場が要る。Workers AI に載せられる自前の重みは、対応する LLM の LoRA だけで、エンコーダーの分類器は載せられない。2026-11-16 に Workers AI の文書で確かめた）。
- リスク: 新しい種類の場面（苦手の場面でその場で作る部品）に弱い。教師の LLM の偏りをそのまま写す。保守の手間。**人の判定のデータ（下の測り方の 100 答え）が溜まってから考える。**

### 案 J. 汎用の評価モデル（Prometheus 2・Selene Mini など）を入れる（勧めない）

- 理由: 人との相関（FLASK で 0.55）が GPT-4（0.68）より低く、このアプリの狭い判定に合わせた学習でもない。ホスティングの手間がかかる。API の安いモデル（Haiku 5.5）を案 A・B・E・F で使うほうが、手間・費用・効き目のどれでも良いと見込む。

### 優先の順（提案）

1. 測り方を先に作る（下の「確かめ方」。今の `measure-scoring-baseline.ts` を、項目の判定の割れ率・モデル間の一致も出すように拡張する）
2. 案 A ＋ 案 B（判定の形を狭く・固定に）
3. 案 F（境目の例）と案 G（表現を enum に）
4. Haiku 5.5 に替えて測り、足りなければ案 E（多数決）
5. 案 D（保存）は公平の説明用に、いつでも
6. 案 C は細部の項目から一部だけ試す。案 H・I は必要になったら

### 確かめ方（何を、何件で）

| 測るもの | 中身 | 件数の目安 | 指標 | 合格の目安 |
| --- | --- | --- | --- | --- |
| 繰り返しのぶれ | 同じ答えを同じモデルで k 回 | 3 級 × 20 通り = 60 答え × 5 回 = 300 回 | 内容・表現の幅（最大 − 最小）、**項目の段階の割れ率**、描写の数の幅、ignored との境目の割れ | 内容の幅 5 点以内（ADR）。項目の割れは 3級で 0 に近いこと |
| モデル間の一致 | 同じ 60 答えを、候補のモデル（Haiku 5.5 の low / medium、多数決あり・なし）と参照（Sonnet 5.5 high の 5 票の多数決）で | 60 答え ≒ 360 の項目の判定 | 項目の段階の Cohen の κ（3 段階は重み付き）、内容の点の差の平均（MAE）、Spearman、**部屋の中の順位の一致**（同じ場面の 3〜4 答えの順位が入れ替わる割合） | κ と MAE は参照どうし（Sonnet の 5 票を 2 組）の値を上限として比べる |
| 人との一致 | チームの 2 人（できれば英語の先生 1 人）が、項目の段階と描写の正誤を付ける | 100 答え ≒ 600 の項目の判定（1 答え 1 分なら 1 人 100 分） | 人どうしの κ（上限）、モデルと人の κ、人の判定から計算した内容の点と、モデルの点の差 | モデルと人の κ が、人どうしの κ に近いこと |

- 答えの選び方: 今の 10 通りの型（見本どおり・正しい一文だけ・名前だけ・前置詞の誤り・文法の誤り・推測を足す・場面に無いこと・難しい語で的外れ など）に、**境目の答え**（1 文で 2 項目、Someone is ...、位置だけの誤り、言いよどみ、文字起こしの誤りらしい語）を足す。実際に遊んだ答え（記録があれば）も混ぜる。
- 繰り返しは保存（案 D）を通さずに測る。モデル間・人との比較は、同じ答えの集合で行う。
- 費用: Haiku 5.5 なら 300 回で 0.2〜0.7 USD 程度、Sonnet の参照（60 答え × 5 票 × 2 組 = 600 回）で約 9〜10 USD（1 回 0.015〜0.017 USD として。見積もり）。
- 何件で足りるか: 項目の判定の一致率は 600 判定で ±0.02、κ は ±0.05 程度で比べられる（上の数値の例）。部屋の順位は、60 答えを 15 部屋 × 4 人に組むと 90 組の対の比較になる。

---

## 不確かな点・残る問い

- **検索の上限**: 調査の途中で WebSearch の上限に達した。2026-11-16 に、RubricEval の中身・FLASK の数値・SAFE の人との一致・FActScore の誤差 2% 未満（原典の要旨）を原典で確かめた。まだ確かめていない: Kaggle の 2 つの大会の最終の順位の 1 位の点と解法（公開の leaderboard の 1 位だけ取れた）、ELLIPSE の件数。
- **Mizumoto & Eguchi（2023）の QWK の値**: 原典を読めず、二次の出典どうしで食い違う（0.388・0.682 など）。隣接一致 89.15% だけ、二次の出典で確かめた。2026-11-16 にも原典を開けなかった（ScienceDirect が 403）。
- **Uchida（2024）の数値**は、機関リポジトリの要旨で確かめた（本文の表は読んでいない）。
- **Haiku 5.5 がこの指示文でどれだけぶれるか**は、まだ測っていない。結論 4 の費用と割れ率の計算は、単価と独立の仮定からの見積もり。
- **多数決の効き目**は、票が独立なら、という仮定の計算。同じモデル・同じ指示文の誤りは相関するので、実測が要る。
- **Claude で token の確率（logprobs）を得られるか**: 得られない（Messages API の参照に欄が無い。2026-11-16 に確かめた）。確率の重み付けの代わりは、多数決の票の割合。
- **Haiku 5.5 の prompt caching**: 2026-11-16 に Anthropic の料金と prompt caching の文書で確かめた。10 万 token 以下の入力で、読み出し 0.01 USD・5 分の書き込み 0.125 USD・1 時間の書き込み 0.20 USD（100 万 token あたり）。キャッシュできる最小の長さは 512 token。
- **チェックリストの項目や場面の物の並び順が判定に影響するか**: 測っていない。多数決のときに入れ替える案は、影響があれば効く。
- **人どうしの一致の上限**: このアプリの項目の判定で、人どうしがどれだけ一致するかは分からない。上限が低ければ、モデルにそれ以上を求めても意味が無い。
- **日本の中高生の 20 秒の描写を LLM で採点した研究**は見つからなかった。英作文や他の国の話す試験の値を当てはめている。
- **母語による偏り**（Gayed 2026）が、表現の段階の採点で日本の学習者に出るか。部屋の中は全員日本語が母語なので順位には効きにくいが、「英検の観点に沿う」と説明するときの注意。
- **Workers AI で DeBERTa や Prometheus 2 を動かせるか**: 動かせない。Workers AI の文書のモデルに無く、自前の重みは対応する LLM の LoRA（rank 32 まで）だけ（2026-11-16 に https://developers.cloudflare.com/workers-ai/features/fine-tunes/loras/ で確かめた）。動かすなら Cloudflare Containers など別の置き場が要る。
- 2026 年の preprint（Gayed・Yagubyan）は単著で、査読前。

---

## 出典の一覧

### 英作文・話す答えの採点
- Mizumoto, A. & Eguchi, M. (2023). Exploring the potential of using an AI language model for automated essay scoring. Research Methods in Applied Linguistics 2(2), 100050. https://doi.org/10.1016/j.rmal.2023.100050 （著者のページ https://egumasa.github.io/publications/journal_articles/Mizumoto-2023a/index.html ）
- Iwanaka, T. (2026). Generative AI in Writing Evaluation: Where We Stand and What Lies Ahead. 山口県立大学学術情報 19. https://ypir.lib.yamaguchi-u.ac.jp/yp/1923/files/169365 （Mizumoto & Eguchi の数値の二次の出典）
- Yancey, K. P., LaFlair, G. T., Verardi, A. R. & Burstein, J. (2023). Rating Short L2 Essays on the CEFR Scale with GPT-4. BEA 2023. https://aclanthology.org/2023.bea-1.49
- Yoshida, L. (2025). Do We Need a Detailed Rubric for Automated Essay Scoring using Large Language Models? AIED 2025. https://arxiv.org/abs/2505.01035
- Pack, A., Barrett, A. & Escalante, J. (2024). Large language models and automated essay scoring of English language learner writing: Insights into validity and reliability. Computers and Education: AI 6. https://doaj.org/article/7b38bf3f0de448dc8f48ab09a9243db5
- Kundu, A. & Barbosa, D. (2024). Are Large Language Models Good Essay Graders? https://arxiv.org/abs/2409.13120
- Gayed, J. M. (2026). Investigating first-language bias in LLM-based automated essay scoring. https://arxiv.org/abs/2607.14605
- Uchida（2024）. 神戸大学の機関リポジトリ（ICNALE の話す答え・書いた答えと ChatGPT）. https://da.lib.kobe-u.ac.jp/da/kernel/0100487710/
- Bannò, S., Ma, R., Qian, M., Tang, S., Knill, K. & Gales, M. (2025). Natural Language-based Assessment of L2 Oral Proficiency using LLMs. SLaTE 2025. https://arxiv.org/abs/2507.10200
- Ma, R., Qian, M., Tang, S., Bannò, S., Knill, K. & Gales, M. (2025). Assessment of L2 Oral Proficiency using Speech Large Language Models. Interspeech 2025. https://arxiv.org/abs/2505.21148
- Bannò, S. et al. (2024). Can GPT-4 do L2 analytic assessment? BEA 2024. https://arxiv.org/abs/2404.18557

### 判定の信頼性・安定させる手法
- Zheng, L. et al. (2023). Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena. NeurIPS 2023. https://arxiv.org/abs/2306.05685
- Thakur, A. S. et al. (2024–2025). Judging the Judges: Evaluating Alignment and Vulnerabilities in LLMs-as-Judges. https://arxiv.org/abs/2406.12624
- Verga, P. et al. (2024). Replacing Judges with Juries: Evaluating LLM Generations with a Panel of Diverse Models. https://arxiv.org/abs/2404.18796
- Lee, Y. et al. (2024–2025). CheckEval: A reliable LLM-as-a-Judge framework for evaluating text generation using checklists. https://arxiv.org/abs/2403.18771
- Cook, J. et al. (2024). TICKing All the Boxes: Generated Checklists Improve LLM Evaluation and Generation. https://arxiv.org/abs/2410.03608
- Kim, S. et al. (2024–2025). The BiGGen Bench. NAACL 2025. https://arxiv.org/abs/2406.05761
- Ye, S. et al. (2024). FLASK: Fine-grained Language Model Evaluation based on Alignment Skill Sets. ICLR 2024. https://arxiv.org/abs/2307.10928
- Cho, J. et al. (2024). Davidsonian Scene Graph. ICLR 2024. https://arxiv.org/abs/2310.18235
- Chiang, C.-H. & Lee, H.-y. (2023). A Closer Look into Using Large Language Models for Automatic Evaluation. EMNLP Findings 2023. https://arxiv.org/abs/2310.05657
- Tam, Z. R. et al. (2024). Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of Large Language Models. EMNLP 2024 Industry. https://aclanthology.org/2024.emnlp-industry.91
- Schroeder, K. & Wood-Doughty, Z. (2024). Can You Trust LLM Judgments? Reliability of LLM-as-a-Judge. https://arxiv.org/abs/2412.12509
- Yagubyan, A. (2026). The Coin Flip Judge? Reliability and Bias in LLM-as-a-Judge Evaluation. https://arxiv.org/abs/2606.13685
- Atil, B. et al. (2024). Non-Determinism of "Deterministic" LLM Settings（旧題 LLM Stability）. https://arxiv.org/abs/2408.04667
- He, H. et al. (2025-09-10). Defeating Nondeterminism in LLM Inference. Thinking Machines Lab. https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/
- OpenAI Cookbook. Reproducible outputs with the seed parameter. https://cookbook.openai.com/examples/reproducible_outputs_with_the_seed_parameter
- Anthropic. API versions / Pricing（Claude API の skill の写し、2026-11-03 時点）. https://platform.claude.com/docs/en/api/versioning 、https://platform.claude.com/docs/en/about-claude/pricing
- Hashemi, H. et al. (2024). LLM-Rubric: A Multidimensional, Calibrated Approach to Automated Evaluation of Natural Language Texts. ACL 2024. https://aclanthology.org/2024.acl-long.745
- Liu, Y. et al. (2023). G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment. https://arxiv.org/abs/2303.16634 （方法の説明だけ。本文は読んでいない）
- Wang, P. et al. (2023–2024). Large Language Models are not Fair Evaluators. ACL 2024. https://arxiv.org/abs/2305.17926
- Liusie, A., Manakul, P. & Gales, M. (2024). LLM Comparative Assessment: Zero-shot NLG Evaluation through Pairwise Comparisons using Large Language Models. EACL 2024. https://aclanthology.org/2024.eacl-long.8
- Shibata, T. & Miyamura, Y. (2025). LCES: Zero-shot Automated Essay Scoring via Pairwise Comparisons Using Large Language Models. EMNLP 2025. https://arxiv.org/abs/2505.08498

### 評価用のモデル・蒸留・fine-tune
- Kim, S. et al. (2024). Prometheus 2: An Open Source Language Model Specialized in Evaluating Other Language Models. EMNLP 2024. https://arxiv.org/abs/2405.01535
- Zhu, L., Wang, X. & Wang, X. (2025). JudgeLM: Fine-tuned Large Language Models are Scalable Judges. ICLR 2025. https://arxiv.org/abs/2310.17631
- Li, J. et al. (2023). Generative Judge for Evaluating Alignment（Auto-J）. https://arxiv.org/abs/2310.05470
- Atla (2025). Atla Selene Mini: A General Purpose Evaluation Model. https://arxiv.org/abs/2501.17195
- Ormerod, C. & Kwako, A. (2024). Automated Text Scoring in the Age of Generative AI for the GPU-poor. https://arxiv.org/abs/2407.01873
- Xiao, C. et al. (2024). Human-AI Collaborative Essay Scoring: A Dual-Process Framework with LLMs. https://arxiv.org/abs/2401.06431
- Latif, E. et al. (2023–2024). Knowledge Distillation of LLM for Automatic Scoring of Science Education Assessments. https://arxiv.org/abs/2312.15842
- Kaggle. Feedback Prize - English Language Learning (2022). https://www.kaggle.com/competitions/feedback-prize-english-language-learning
- Kaggle. Learning Agency Lab - Automated Essay Scoring 2.0 (2024). https://www.kaggle.com/competitions/learning-agency-lab-automated-essay-scoring-2
- SemEval-2013 Task 7（SciEntsBank のデータ）. https://huggingface.co/datasets/nkazi/SciEntsBank 、参加者の論文 https://preview.aclanthology.org/fix_video/S13-2097.pdf

### 抜き出しと計算を分ける（hybrid）
- Min, S. et al. (2023). FActScore. EMNLP 2023. https://aclanthology.org/2023.emnlp-main.741
- Wei, J. et al. (2024). Long-form factuality in large language models（SAFE・F1@K）. https://arxiv.org/abs/2403.18802
- Anderson, P., Fernando, B., Johnson, M. & Gould, S. (2016). SPICE: Semantic Propositional Image Caption Evaluation. ECCV 2016. https://arxiv.org/abs/1607.08822

### 件数の目安
- Bujang, M. A. & Baharum, N. (2017). Guidelines of the minimum sample size requirements for Kappa agreement test. Epidemiology Biostatistics and Public Health. https://riviste.unimi.it/index.php/ebph/article/view/17614 （本文の信頼区間の幅は、Fisher の z と κ の大標本の近似で自分で計算した）

### repo（読んだもの。変更していない）
- `backend/src/scoring/checklistGrade.ts`、`backend/src/scoring/checklist.ts`、`backend/src/scoring/claude.ts`、`backend/scripts/measure-scoring-baseline.ts`、`backend/test/fixtures/checklist-eiken-pre2.json`、`backend/wrangler.jsonc`
- `docs/adr/20261110-score-content-with-checklist-f1.md`、`docs/adr/20261111-count-other-claims-as-bonus-and-require-actions-for-items.md`、`docs/feedback/20261115-award-day.md`
