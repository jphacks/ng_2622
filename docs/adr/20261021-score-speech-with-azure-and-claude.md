# 2026/10/21 話し方と文字起こしは Azure の発音評価、内容・表現と講評は Claude で採点する

## Status
- accepted
- 部分 supersede: 内容・表現について「点数は専用の評価と採点基準で出し、LLM には講評を書かせる」とした分担は、[20261025-score-content-with-layout-and-rubric-bands](./20261025-score-content-with-layout-and-rubric-bands.md) で「場面の配置の情報を渡し、Claude が採点基準の段階で 0〜100 を付ける」に置き換えた。3 項目と重み、話し方と文字起こしを Azure で採ることは存続する。

## Situation
- 作品は、日本人の英語学習者が約 20 秒の自由発話で場面を描写し、その発話を AI が採点して競うもの（[`docs/design/usecase.md`](../design/usecase.md)）。
- 開発時間は約 14 時間で、採点の仕組みを作り込む時間は無い。
- Azure は @kameiryohei の GitHub Student Developer Pack のクレジット、Claude は @TEIKOTA の 100 USD 分のクレジットを使う。

## Context
- 理想は、音声そのものを AI に渡し、抑揚やイントネーションまで採点に含めること。
- 音声を入力できる LLM（Gemini・GPT など）で足りるのか、専用の発音評価サービスが要るのかを決める必要があった。

## Material for decision
- [`docs/design/speech-scoring-research.md`](../design/speech-scoring-research.md)（音声を入力できる LLM、発音評価 API、文字起こしの精度、音響特徴を LLM に渡す案の比較）
- [`docs/design/azure-pronunciation-assessment.md`](../design/azure-pronunciation-assessment.md)（費用、制限、返る値、設定）
- 音声を入力できる LLM のゼロショットの採点は、人手評価との相関が低い（GPT-4o の抑揚 0.41、Qwen2-Audio 0.14。arXiv 2503.11229、2601.16230）。Azure の発音評価は抑揚 0.84。
- Claude の API は音声入力に対応していない（入力はテキストと画像）。

## Decision
- 採点は内容・表現・話し方の 3 項目にし、重み付きの合計で順位を決める。重みは最初 内容 50%・表現 25%・話し方 25% とし、遊びながら調整する。
- 話し方（流暢さ・発音・抑揚）と文字起こしは、Azure AI Speech の発音評価（正解文なし、抑揚の評価あり、en-US）を使う。
  - 文字起こしは、まず発音評価で返るものをそのまま使う。誤りが目立てば、精度の高い文字起こし AI を前段に足す。
- 内容（場面に合っているか）・表現（語彙や文の組み立て）の採点と、講評・模範表現は Claude が書く。まず Claude Haiku 5.5（effort `high`）で作り、質が足りなければ Claude Sonnet 5.5（effort `medium`）に上げる。点数と講評は構造化出力（JSON スキーマ）で受け取る。
- 点数は専用の評価と採点基準で出し、LLM には講評を書かせる、という分担を基本にする。LLM に自由に点数を付けさせると高い点に偏るため。

## Consequences
- 根拠のある専用の評価で話し方を採点でき、費用も小さい（Azure は 1 ラウンド 2 人で約 0.014 USD、Claude は Haiku 5.5 で 1 人 1 回約 0.0005 USD）。
- サービスが 2 社になり、それぞれのクレジットとキーを管理する。
- 「音声そのものを LLM に渡して抑揚まで採点する」理想は、今回は採らない。
- Azure の点数は、人の評価と順位は合うが水準はずれる。そのまま見せるなら補正を考える。
- 日本人の自由発話での精度は、どの候補も数値が無い。Hack Day の前に、チームで録音して確かめる。
