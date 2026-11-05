# App Store への申請

ScenEnglish を App Store に出すための手順と、App Store Connect に入れる値。
初回の審査は時間がかかるので、ここまでの main で一度審査を通しておき、**承認されても自動では公開しない**（「手動でリリース」）。
公開したくなったら、そのときの main をアップデートとして出し、承認されたものを公開する。

## 前提

| 項目 | 値 |
|---|---|
| 配るアカウント | Apple Developer Program の個人チーム Kouta Takahashi（チーム ID `PHYJ4DL63M`）。販売者名にこの名前が出る |
| bundle ID | `jp.jphacks.ng2622.app`（後から変えられない） |
| ビルド構成 | `Release-Store`（[`ios/Config/Store.xcconfig`](../../ios/Config/Store.xcconfig)）。本番のバックエンドにつなぎ、各自の `Local.xcconfig` を読まない |
| scheme | `NG2622 Store` |
| アイコン | [`ios/NG2622/Assets.xcassets/AppIcon.appiconset/AppIcon.png`](../../ios/NG2622/Assets.xcassets/AppIcon.appiconset/AppIcon.png)（作り方は [`scripts/app-icon/build.py`](../../scripts/app-icon/build.py)） |
| プライバシーマニフェスト | [`ios/NG2622/App/PrivacyInfo.xcprivacy`](../../ios/NG2622/App/PrivacyInfo.xcprivacy) |
| プライバシーポリシー | <https://github.com/jphacks/ng_2622/blob/main/PRIVACY_POLICY.md>（[`PRIVACY_POLICY.md`](../../PRIVACY_POLICY.md)）。**提出より前に main に入っている必要がある** |
| スクリーンショット | [`screenshots/`](./screenshots/)（6.9 インチ、1320 × 2868） |

## 手順

### 1. App Store Connect にアプリを作る（初回だけ）

1. <https://appstoreconnect.apple.com> → アプリ → ＋ → 新規 App。
2. プラットフォーム iOS、名前 `ScenEnglish`、プライマリ言語 日本語、バンドル ID `jp.jphacks.ng2622.app`、SKU `ng2622`、ユーザアクセス フルアクセス。
   - バンドル ID が一覧に出ないときは、先に <https://developer.apple.com/account/resources/identifiers/list> で App ID `jp.jphacks.ng2622.app` を登録する（Capabilities は追加しない）。Xcode でアーカイブを上げると自動で登録されることもある。
   - 名前が使われていたら、`ScenEnglish - 英語で描写対戦` のように副題を足す。

### 2. ビルドを上げる

```sh
(cd ios && xcodegen)
open ios/NG2622.xcodeproj
```

1. scheme を `NG2622 Store`、行き先を `Any iOS Device (arm64)` にする。
2. Product → Archive。
3. Organizer で Distribute App → App Store Connect → Upload。署名は Automatically manage signing のまま。

コマンドで上げるときは、Xcode に Apple ID でサインインしたうえで:

```sh
xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Store" -destination 'generic/platform=iOS' \
  -archivePath build/NG2622.xcarchive -skipPackagePluginValidation -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath build/NG2622.xcarchive -exportPath build/export \
  -exportOptionsPlist docs/app-store/ExportOptions.plist -allowProvisioningUpdates
```

上げてから 10〜30 分ほどで App Store Connect の TestFlight にビルドが出る。暗号の申告は `ITSAppUsesNonExemptEncryption = NO` を入れてあるので聞かれない。

### スクリーンショットを撮り直す

UI テスト（[`ios/NG2622UITests/StoreScreenshots.swift`](../../ios/NG2622UITests/StoreScreenshots.swift)）が Mock で一人で 1 ラウンドを遊び、各画面を `screenshots/` に書き出す。6.9 インチのシミュレータ（iPhone 18 Pro Max、1320 × 2868）で撮る。

```sh
xcrun simctl boot "iPhone 18 Pro Max"
xcrun simctl status_bar "iPhone 18 Pro Max" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
TEST_RUNNER_SCREENSHOT_DIR=$PWD/docs/app-store/screenshots xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Mock" \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' -skipPackagePluginValidation -only-testing:NG2622UITests test
```

Mock の仮の結果（`MockResults.swift`）は公園の場面向けの文なので、`6-everyone.png` は場面と描写が合わない。申請には `1-home`・`2-lobby`・`3-play`・`4-waiting`・`5-ranking`・`7-review` の 6 枚を、この順で使う。

### 3. App の情報を入れる

下の「入れる値」を App Store Connect の各画面に写す。

### 4. 審査に出す

1. 「1.0 提出準備中」でビルドを選ぶ。
2. **バージョンのリリース → 「このバージョンを手動でリリースする」** を選ぶ（承認されても勝手に公開されない）。
3. 審査へ提出。

### アップデートを出すとき

1. `ios/project.yml` の `MARKETING_VERSION` を上げる（例 `1.0.0` → `1.1.0`）。同じ版でビルドを上げ直すときは `CURRENT_PROJECT_VERSION` だけを上げる。
2. 上の 2〜4 をもう一度。App Store Connect で新しいバージョン（＋ バージョン）を作ってからビルドを選ぶ。

## 入れる値

### App 情報

| 項目 | 値 |
|---|---|
| 名前 | ScenEnglish |
| サブタイトル（30 文字まで） | 3D の場面を英語で描写して対戦 |
| カテゴリ | プライマリ 教育、セカンダリ ゲーム（サブカテゴリ 教育 / Word） |
| コンテンツの権利 | 第三者のコンテンツを含まない（3D の部品は自作、文と講評は AI が生成） |
| 年齢制限 | 下の「年齢制限の質問」 |
| プライバシーポリシーの URL | <https://github.com/jphacks/ng_2622/blob/main/PRIVACY_POLICY.md> |

### 価格と配信

- 価格: 無料
- 配信する国: 日本（UI が日本語だけのため）。広げるのはアプリを英語にしてから。

### バージョン 1.0 の情報

**プロモーション用テキスト（170 文字まで）**

```
友達と同じ 3D の場面を同時に見て、英語で描写して点数を競おう。AI が毎回ちがう場面を作り、何を言えたか・どう言えたか・どう話せたかを採点します。
```

**説明（4000 文字まで）**

```
ScenEnglish（シーングリッシュ）は、友達と iPhone で同時に遊ぶ英語のスピーキングゲームです。

同じ 3D の場面をみんなで見て、そこで起きていることを英語で説明します。「公園で男の子が犬とボールで遊んでいる」「カフェで女性がコーヒーを注いでいる」――何をどう言うかは自由です。AI が採点して順位を発表し、全員の描写を並べて見比べられます。

■ 遊び方（1 ラウンド約 1 分）
1. 部屋に集まる：ホストが部屋を作り、ほかの人は 4 桁のコードか QR コードで入ります。一人でも遊べます。
2. 同時に見る：スタートすると AI がその場で 3D の場面を作り、全員の画面に同じ時刻に現れます。指で回して見回せます。
3. 同時に話す：見たものを英語で描写します（最長 20 秒）。
4. 結果発表：AI の採点で順位を発表。全員の描写と講評を見比べられます。
5. 振り返り：「できたこと」「次はこれ」「こう言い換える」「話し方のコツ」が出て、自分の声も聞き直せます。

■ 特長
・毎回ちがう場面：AI が部品を組み合わせて 3D の場面を作るので、同じ例文の繰り返しになりません。
・3 つの観点で採点：何を言えたか（内容）、どう言えたか（表現）、どう話せたか（発音・流暢さ）。
・次に伸ばす一つが分かる：講評は「次はこれ」の一つと、言い換えの例を示します。
・難易度を選べる：かんたん・ふつう・むずかしい。

■ ご注意
・採点のため、話した声をインターネット経由で採点のサービス（Microsoft Azure、Anthropic Claude）に送ります。録音は保存しません。
・マイクを使います。QR コードで部屋に入るときはカメラを使います。
```

**キーワード（100 文字まで、カンマ区切り）**

```
英会話,英語,スピーキング,発音,対戦,ゲーム,AI,採点,3D,描写,友達,パーティー,学習,勉強,English
```

**サポート URL**: <https://github.com/jphacks/ng_2622/issues>

**マーケティング URL**（任意）: <https://github.com/jphacks/ng_2622>

**著作権**: `2026 ScenEnglish Team`

### App Review に関する情報

- サインイン情報: 不要（アカウントが無い）。「サインインが必要」のチェックを外す。
- 連絡先: 自分の氏名・電話番号・メールアドレスを入れる（公開されない）。
- 画面収録: 実機（最新の iOS）で、アプリを起動するところから 1 ラウンドの終わりまでを録る（2026-11-03 の Guideline 2.1 Information Needed で求められた）。App Review に関する情報の「添付ファイル」に上げるか、限定公開の動画の URL をメモに書く。
- メモ（Apple が求めた 1〜6 の順に答える。審査員はふつう一人で見るので、一人で通しで遊べることを書く。4000 文字まで）:

```
1. Screen recording
A screen recording on a physical iPhone running the latest iOS is attached in the App Review Information attachments (it starts from launching the app and shows one full round). The app has no account registration, login, or paid content.
User-generated content is limited to the display name and the English description each player speaks; they are visible only to the players in the same private room (joined by a 4-digit code), and the room data is deleted automatically within 2 hours of inactivity.

2. Purpose and target audience
ScenEnglish is an English speaking game for Japanese learners of English (students and adults) who want to practice speaking with friends. Players look at the same 3D scene at the same time and describe it in English. The app scores what they said (content), how they said it (expression), and how they spoke (pronunciation and fluency), and shows one concrete thing to improve next. It solves the problem that speaking practice is boring and hard to start alone: describing a scene removes "what should I say?", and playing against friends makes it fun.

3. How to use the main features (no login is needed; one person can play alone)
1) On the home screen, enter any display name and tap "部屋を作る" (Create room).
2) In the lobby, choose a difficulty ("かんたん" = easy) and tap "スタート" (Start). Other players are not required.
3) The server generates a 3D scene with AI (about 10-20 seconds; a running character is shown while waiting).
4) After the countdown, describe the scene in English for up to 20 seconds (e.g. "There is a park. A boy is playing with a dog."), then tap "話し終えた" (Done). Please allow microphone access when asked.
5) After scoring (about 10-20 seconds), the ranking, everyone's descriptions, your score breakdown and feedback are shown. You can replay your voice and rate the scene.
"部屋に入る" (Join room) needs the 4-digit code or QR code of a room created on another device. The camera is used only to scan this QR code.

4. External services
- Cloudflare Workers and Durable Objects: our backend server (rooms, real-time sync, scoring requests).
- Microsoft Azure AI Speech: pronunciation and fluency assessment of the recorded voice.
- Anthropic Claude API: scoring content and expression, writing feedback, and generating 3D scene layouts.
- Apple Speech framework: on-device English transcription.
The voice recording is sent to our server only for scoring and is not stored.

5. Regional differences
The app is distributed in Japan only. The features and content are the same everywhere; the UI is in Japanese and the speaking practice is in English.

6. Regulated industry / third-party material
The app is not in a regulated industry. It contains no protected third-party material: the 3D models were made by our team, and the scene descriptions and feedback are generated by AI.
```

### App のプライバシー（App Store Connect の「App のプライバシー」）

[`PrivacyInfo.xcprivacy`](../../ios/NG2622/App/PrivacyInfo.xcprivacy) と揃える。

- データの収集: **はい、収集する**
- 収集するデータの種類:
  - **ユーザコンテンツ → オーディオデータ**: 用途 App の機能。ユーザに関連付けない。トラッキングに使わない。
  - **ユーザコンテンツ → その他のユーザコンテンツ**（表示名、場面の評価とコメント、文字にした英文）: 用途 App の機能。ユーザに関連付けない。トラッキングに使わない。
- それ以外（連絡先、位置情報、識別子、使用状況、診断など）は収集しない。

### 年齢制限の質問

| 質問 | 答え |
|---|---|
| 暴力・性的な内容・ギャンブル・薬物・恐怖など | すべて「なし」 |
| 医療・健康の情報 | なし |
| 制限のないウェブアクセス | いいえ |
| メッセージやチャット | いいえ（自由な文章のやり取りは無い） |
| ユーザ生成コンテンツ | はい（同じ部屋の参加者に、表示名と英語の描写が見える。部屋はコードを知る人だけが入れ、最長 2 時間で消える） |
| 広告 | いいえ |
| 年齢確認・ペアレンタルコントロール | いいえ |

結果は 4+ か 9+ になる見込み。

## 審査で気をつけること

- 本番のバックエンド（`https://ng-2622-backend.jphacks-ng2622.workers.dev`）が動いていないと審査に落ちる（2.1 アプリの完成度）。審査中は止めない・壊さない。Claude と Azure の支出上限に達していないかも確かめる（[`docs/design/cost-safety.md`](../design/cost-safety.md)）。
- 声を外部の AI（Azure・Claude）に送ることについて、アプリの中で同意を取る画面は置いていない（ガイドライン 5.1.2(i)）。説明文・審査メモ・プライバシーポリシーで知らせている。これを理由に却下されたら、初回に一度だけ同意を取る画面を足して出し直す。
- 「ユーザ生成コンテンツ」で 1.2（通報・ブロックの仕組み）を求められたら、結果の画面に参加者の通報の口を足す。
