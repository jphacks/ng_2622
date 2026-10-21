# Azure Pronunciation Assessment（発音評価）の仕様メモ

> 話し方（流暢さ・発音・抑揚）の採点に使う（2026-10-21 に決定）。この文書は 2026-10-21 時点の公式ドキュメントと料金 API の調査結果をまとめたもの。数値は変わりうるので、使う前に出典を見直す。

## 使い方の前提

- 各プレイヤーの iPhone で、最長 20 秒の英語の自由発話（正解文なし）を評価する。
- 本番は 2 台で同時に評価する（無理なら 1 台）。

## 使うもの（名前と設定）

| 項目 | 使うもの |
| --- | --- |
| サービス | Azure AI Speech（Microsoft Learn では「Foundry Tools」の一部として案内されている） |
| Azure に作るリソース | Speech のリソース、価格レベルは S0（F0 は同時 1 セッションのため使わない） |
| 機能 | Pronunciation Assessment（発音評価）の unscripted（正解文なし）評価と、prosody（抑揚）評価 |
| 認識モデル | 名前を選ぶ仕組みは無い。発音評価は「標準の音声認識とは別の、発音評価用の音声認識モデル」を使うと書かれているだけで、モデル名は公開されていない |
| 言語 | `en-US`（抑揚の評価は en-US だけ） |
| iOS の SDK | Speech SDK（Swift からは `SPX` で始まるクラスを使う）。1.35.0 以上 |

設定（`PronunciationAssessmentConfig`。Swift では `SPXPronunciationAssessmentConfiguration`）:

| パラメータ | 設定する値 | 理由 |
| --- | --- | --- |
| `ReferenceText` | `""`（空） | 空にすると正解文なしの評価になる |
| `GradingSystem` | `HundredMark`（Swift: `.hundredMark`） | 既定は `FivePoint`（0〜5 点）なので、0〜100 点にするには明示が要る |
| `Granularity` | `Phoneme`（Swift: `.phoneme`） | 全体・単語・音節・音素の点数がそろう。既定も `Phoneme` |
| `EnableMiscue` | `false` | 正解文と比べて言い落としを判定する機能で、正解文なしでは使わない |
| `EnableProsodyAssessment` | 呼ぶ（Swift: `enableProsodyAssessment()`） | 呼ぶと `ProsodyScore` が返る |

Swift の呼び方（公式の例の形）:

```swift
let recognizer = try SPXSpeechRecognizer(speechConfiguration: speechConfig, language: "en-US", audioConfiguration: audioConfig)
let pronConfig = try SPXPronunciationAssessmentConfiguration("", gradingSystem: .hundredMark, granularity: .phoneme, enableMiscue: false)
pronConfig.enableProsodyAssessment()
try pronConfig.apply(to: recognizer)
// 結果は SPXPronunciationAssessmentResult(result)、JSON は result.properties の speechServiceResponseJsonResult
```

- 録音の取り方: 公式の例は 1 回だけ認識する `recognizeOnce()` を使っている。ただしこれは発話の切れ目（無音）で止まるので、20 秒の自由発話で途中に間が空くと、そこで評価が終わるおそれがある（推測）。連続認識（`startContinuousRecognition`）で区切りごとの結果を受け取り、最後にまとめる形が安全（推測）。公式のサンプルにも、連続認識での発音評価（`continuousPronunciationAssessment`）がある。
- 文字起こしを前段に足す構成に切り替える場合の候補（Azure の中で選ぶなら）: 標準の音声認識、LLM Speech（ファイル用、GA）、MAI-Transcribe-2（preview）。他社なら ElevenLabs Scribe v2 など（[`speech-scoring-research.md`](./speech-scoring-research.md)）。

## 費用

| 項目 | 単価 | 出典 |
| --- | --- | --- |
| 音声認識（リアルタイム、S0） | 1.00 USD / 音声 1 時間（秒単位の課金） | 料金ページ、Azure Retail Prices API |
| 発音評価の基本部分（正確さ・流暢さなど） | 上乗せなし（音声認識と同じ料金） | pronunciation-assessment-tool |
| 抑揚（prosody）の評価 | +0.30 USD / 時間（追加機能として課金） | 料金ページの「Pronunciation Assessment (prosody)」 |
| 合計 | 約 1.30 USD / 時間 | — |

- 計算例: 1 ラウンド 2 人 × 20 秒 = 40 秒。`1.30 USD ÷ 3600 秒 × 40 秒 ≈ 0.0144 USD`（約 2 円）。100 ラウンド遊んでも約 1.4 USD。
- 無料枠（F0）は音声 5 時間 / 月までだが、**同時に 1 セッションまで**で引き上げできない。2 台の同時プレイには使えないので、有料（S0）にする。
- 料金ページ上のメーター名「S1」がポータルの S0 に当たること、prosody の課金メーターの対応は、名前からの推定。

## 制限

| 項目 | 値 |
| --- | --- |
| 同時接続 | F0: 1（引き上げ不可）。S0: 既定で 100（リソースごと、申請で引き上げ可） |
| 上限を超えたとき | HTTP 429（SDK では `TooManyRequests`）。上限内でも、Azure 側の準備が追いつくまで 429 が出ることがあり、リトライが推奨されている |
| 抑揚の評価の対象言語 | en-US のみ |
| 正解文なしの評価 | en-US を含む対応ロケールで使える。`ReferenceText` を空にすると正解文なしの評価になる |
| 音声の長さ | 30 秒を超える音声は連続認識モードで処理する（今回は最長 20 秒なので不要） |
| SDK の版 | 抑揚の評価には Speech SDK 1.35.0 以上が必要 |

## 返る値（正解文なしの場合）

- 文字起こし: `Display`（表示用）、`Lexical`（読みのまま）
- 全体の点数（0〜100）:
  - `AccuracyScore`: 発音の正確さ
  - `FluencyScore`: 流暢さ
  - `ProsodyScore`: 抑揚（強勢・イントネーション・話速・リズムの総合）
  - `PronScore`: 上の点数をまとめた総合点
- 単語ごと:
  - `AccuracyScore`
  - `ErrorType`: `Mispronunciation`（発音の誤り）、`UnexpectedBreak` / `MissingBreak`（不自然な区切り / 区切りが無い）、`Monotone`（平板）
  - `Feedback.Prosody`: 区切り（`Break`）と抑揚（`Intonation`）の詳細
- 音節・音素ごとの点数（音素の推定は en-US のみ）
- 正解文なしでは返らないもの: `CompletenessScore`（正解文に対してどれだけ言えたか）
- 語彙・文法・話題を評価する内容評価（content assessment）は廃止済み。内容と表現の採点は LLM で行う。

## 呼び方

- iOS: 公式の Speech SDK（Swift Package Manager で入る。Objective-C のブリッジで Swift から使う）。発音評価と抑揚の評価に対応する。
- 認証: API キーはサーバー（TypeScript のバックエンド）だけに置く。バックエンドが 10 分有効の認可トークンを発行し、iPhone はそのトークンで Azure に直接つなぐ。トークンは 9 分ごとの更新が推奨されている。
- TypeScript: Node 用の Speech SDK（`microsoft-cognitiveservices-speech-sdk`）もある。音声をバックエンドに送って評価する構成も取れる。
- 正解文なしの評価は、通常の音声認識とは別の認識モデルを使う。Microsoft は、文字起こしの精度が要るなら、先に音声認識で文字にし、それを正解文にして評価する方法も勧めている。

## 応答時間

- **公式の数値は無い。** 発話の終わりから発音評価の結果が返るまでの時間を示した文書は見つからなかった。
- 参考: 第三者の計測（Artificial Analysis）で、Azure の標準の音声認識（ストリーミング）は話し終わりから確定まで 0.62 秒。発音評価を付けたときの時間ではない。
- **Hack Day の前に実測する。** 20 秒の発話で、「話し終えた」を押してから点数が返るまでの時間を測る。目安は、結果発表まで数秒以内に収まること。

## 精度について分かっていること

- 抑揚の点数と人の評価との相関は 0.84（中国語話者の英語の音読、著者は Microsoft 所属）。
- 第三者の評価（日本人を含む大学生の音読）では、人の評価との順位相関が発音 0.76、流暢さ 0.63、抑揚 0.74。順位はよく合うが、点数の水準は人とずれる。点数をそのまま見せるなら補正を考える。
- 日本人の自由発話での精度は、どこにも数値が無い。

## 出典

- 発音評価の使い方: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment
- 制限: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits
- 対応言語: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment
- 料金: https://azure.microsoft.com/en-us/pricing/details/speech/ 、https://prices.azure.com/api/retail/prices 、https://learn.microsoft.com/en-us/azure/ai-services/speech-service/pronunciation-assessment-tool
- iOS の導入: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/quickstarts/setup-platform?pivots=programming-language-swift
- 認可トークン: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short
- 精度: arXiv 2503.11229、arXiv 2610.26406
- 第三者の遅延計測: https://artificialanalysis.ai/speech-to-text/streaming
