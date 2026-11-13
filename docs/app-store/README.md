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

### Award Day の TestFlight 版の作り方

Award Day（2026-11-15）の会場で使う版。App Store の版との違いは、つなぎ先が staging のバックエンドになることだけ。ホームの 3D を企業の 3D 広告の見本（ハッカソンの会場。[`assets/title/`](../../assets/title/README.md)、3D の下に「PR」の札と「JPHACKS」）にするのは、アプリではなく staging のバックエンドが決める（`GET /title`。staging にだけ `TITLE_CAMPAIGN` を付けてデプロイする。手順は [`backend/README.md`](../../backend/README.md) の「staging だけで出す」、決め方は [ADR](../adr/20261113-decide-title-diorama-on-server-with-expiry.md) と [ADR](../adr/20261113-swap-title-diorama-in-place-and-label-as-pr.md)）。アプリは、起動時と前に戻ったときに確かめ、確かめが終わった時点でその場で会場に替え、期限（日本時間 11/15 23:59:59）を過ぎたら公園に戻す。scheme と構成は App Store の版と同じ `NG2622 Store` のまま、Archive のコマンドでつなぎ先と版の番号だけを上書きする（別の構成や scheme は作らない）。

**この版は App Store の審査に出さない。** TestFlight で配るだけにする。使い捨ての staging のつなぎ先が入っているため。App Store Connect で審査に出すビルドを選ぶときに取り違えないよう、版の番号を App Store の版と分ける。

```sh
(cd ios && xcodegen)
xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Store" -destination 'generic/platform=iOS' \
  -archivePath build/NG2622-awardday.xcarchive -skipPackagePluginValidation -allowProvisioningUpdates \
  BACKEND_URL='<staging の URL>' MARKETING_VERSION=<版> CURRENT_PROJECT_VERSION=<ビルド番号> archive
xcodebuild -exportArchive -archivePath build/NG2622-awardday.xcarchive -exportPath build/export-awardday \
  -exportOptionsPlist docs/app-store/ExportOptions.plist -allowProvisioningUpdates
```

- `BACKEND_URL`: staging の Worker の URL（`https://…workers.dev`）。コマンドの引数なので、xcconfig と違い `https:/$()/` と書かなくてよい。
- `TITLE_DIORAMA` は付けない。Live（ストアの構成も）では使わず、サーバーが決める（`TITLE_DIORAMA` は Mock だけで効く）。
- `MARKETING_VERSION`: 審査に出している版と別の番号にする（例 `1.0.1`）。App Store Connect は、承認済みの版より低い番号を受け付けない。App Store に出す次の版は、この番号より上にする。
- `CURRENT_PROJECT_VERSION`: その `MARKETING_VERSION` で上げたことのある番号より大きい数（初めての版なら `1` でよい）。
- 上げたビルドは TestFlight のグループに入れて配る。App Store Connect の「提出準備中」の版には選ばない。
  - 当日の主は、デモの端末（内部テストのグループで入れたチームの端末）。
  - 来場者の自分の端末に入れてもらうのは、外部テストのグループ（公開リンク）の Beta App Review が通った場合だけ。通るまでは公開リンクから入れられないので、来場者が入れられるとは約束しない。
- 上書きが効いたかは、`build/NG2622-awardday.xcarchive/Products/Applications/NG2622.app/Info.plist` の `BackendURL`・`CFBundleShortVersionString`・`CFBundleVersion` で確かめられる（`plutil -p`）。
- 会場が出るかは、配る前に `curl -s <staging の URL>/title` で `title` が返ることを確かめる。
- アプリは、起動時と前に戻ったときに `GET /title` を確かめ、確かめが終わった時点で、ホームを見ている途中でもその場で会場に替える（短いクロスフェード）。初めて入れた端末では、公園が一瞬出てから会場に替わる。替わらないときは、アプリを裏に回して前に戻す（確かめ直す）。
- 配ってある 1.0.1 (4) は、前の決め（次にホームを開いたときから出す）のままで、タイトルの下に `caption` を字で出す。staging の `caption` を「JPHACKS」にしたあとは、1.0.1 (4) では「JPHACKS」の字だけが出る（「PR」の札は、この直しを入れた版から）。
- ストアの版（審査に出す版）にも、会場の 3D（`assets/title/hackathon.usdz`、2.4 MB）がアプリの中に入る。Mock でビルド設定 `TITLE_DIORAMA` のときに出すのと、Live でサーバーの 3D と中身が同じなら通信で取らずに写す（会場の回線で取り直さない）ためで、構成ごとに写し分けていない。本番の `GET /title` は null なので、ストアの版の画面には出ない。
  - 下の審査メモの「no protected third-party material」は、3D をチームが作ったことを言っている。この 3D には JPHACKS（本作品が出るハッカソンの主催）の名前の文字が入る（ロゴの画像は使わず、フォントの文字に色を付けたもの）。画面に出ないファイルでも審査で気になるなら、ストアの構成では写さない（`ios/project.yml` の Copy title dioramas を構成で分ける）か、審査メモに一言足す。
- 本番で `TITLE_CAMPAIGN` を入れて広告の 3D を出すときは、先に「年齢制限の質問」の「広告」の答えと、App Review に関する情報の審査メモを直す。

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
・採点のため、話した声をインターネット経由で採点のサービス（Microsoft Azure、Anthropic Claude）に送ります。録音はサーバーには保存しません。自分の結果と録音は、見返せるよう端末の中にだけ残ります（アプリを消すと消えます）。
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
- メモ（Apple が求めた 1〜6 の順に答える。審査員はふつう一人で見るので、一人で通しで遊べることを書く。4000 文字まで）。2026-11-13 に場面の★評価をアプリから外したので、3. の 5) の末尾の「and rate the scene」を消した:

```
1. Screen recording
A screen recording on a physical iPhone running the latest iOS is attached in the App Review Information attachments (it starts from launching the app and shows one full round). The app has no account registration, login, or paid content.
User-generated content is limited to the display name and the English description each player speaks; they are visible only to the players in the same private room (joined by a 4-digit code), and the room data is deleted automatically within 2 hours of inactivity.

2. Purpose and target audience
ScenEnglish is an English speaking game for Japanese learners of English (students and adults) who want to practice speaking with friends. Players look at the same 3D scene at the same time and describe it in English. The app scores what they said (content), how they said it (expression), and how they spoke (pronunciation and fluency), and shows one concrete thing to improve next. It solves the problem that speaking practice is boring and hard to start alone: describing a scene removes "what should I say?", and playing against friends makes it fun.

3. How to use the main features (no login is needed; one person can play alone)
1) On the home screen, enter any display name and tap "部屋を作る" (Create room). The app asks for microphone access at this point. Please allow it, because your spoken description is recorded and scored in step 4.
2) In the lobby, choose a difficulty ("かんたん" = easy) and tap "スタート" (Start). Other players are not required.
3) The server generates a 3D scene with AI (about 10-20 seconds; a running character is shown while waiting).
4) After the countdown, describe the scene in English for up to 20 seconds (e.g. "There is a park. A boy is playing with a dog."), then tap "話し終えた" (Done).
5) After scoring (about 10-20 seconds), the ranking, everyone's descriptions, your score breakdown and feedback are shown. You can replay your voice.
"部屋に入る" (Join room) needs the 4-digit code or QR code of a room created on another device. The camera is used only to scan this QR code.

4. External services
- Cloudflare Workers and Durable Objects: our backend server (rooms, real-time sync, scoring requests).
- Microsoft Azure AI Speech: pronunciation and fluency assessment of the recorded voice.
- Anthropic Claude API: scoring content and expression, writing feedback, and generating 3D scene layouts.
- Apple Speech framework: on-device English transcription.
The voice recording is sent to our server only for scoring and is not stored on the server. The player's own result and recording are kept only on the device (in the app's own storage, excluded from backups) so that the player can look back at past rounds; they are never uploaded and are removed when the app is deleted.

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
    - 2026-11-13 に、結果の画面から場面の★評価を外し、アプリは評価とコメントを送らなくなった（理由: 結果の画面のノイズ。サーバーの口とデータは残してあり、戻せる）。今送るのは表示名と文字にした英文だけ。それでも「その他のユーザコンテンツ」には当たるので、ここの答えは変えない。評価のためだけに端末で作っていた乱数の ID も、今の版では作らず送らないので、「識別子」の申告は要らない。
- それ以外（連絡先、位置情報、識別子、使用状況、診断など）は収集しない。
- 遊んだ記録（自分の結果と録音。[`docs/design/play-record.md`](../design/play-record.md)）を端末の中に保存することは、ここの答えを変えない（2026-11-12 に確かめた）。App Store の「収集」は、データを端末の外へ送り、その場の処理より長く持つこと。記録そのもの（録音を含む）は端末の外へ送らない。苦手の分析のときに送る文字は下のとおり。録音を採点のために送ることは、上の「オーディオデータ」でもう答えている。
- 苦手の分析（2026-11-13。[`docs/design/weak-point-analysis.md`](../design/weak-point-analysis.md)）では、直近の記録の文字（文字にした英文・採点の判定と講評・場面の見本の答え。録音は除く）を、分析のときだけサーバーを通して Claude へ送り、サーバーには残さない。ここの答えは変えない。送るのは文字にした英文とその採点の結果で、上の「その他のユーザコンテンツ」（文字にした英文）として申告済みのため。ユーザに関連付けず、トラッキングにも使わない。

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
