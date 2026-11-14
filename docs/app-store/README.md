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

Mock の仮の結果（`MockResults.swift`）は公園の場面向けの文なので、`6-everyone.png` は場面と描写が合わない。

きろくと苦手の画面は、別の UI テストで撮る（Mock の例の記録 `MOCK_SAMPLE_RECORDS` が出るビルドで、同じシミュレータで）。苦手の画面の文は Mock の決まった分析で、AI の実際の出力ではない。

```sh
TEST_RUNNER_RECORDS_SHOT_DIR=<出力先> xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Mock" \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' -skipPackagePluginValidation \
  -only-testing:NG2622UITests/WeakPointsScreens/testWeakPoints test
TEST_RUNNER_WEAK_SCENE_SHOT_DIR=<出力先> xcodebuild -project ios/NG2622.xcodeproj -scheme "NG2622 Mock" \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro Max' -skipPackagePluginValidation \
  -only-testing:NG2622UITests/WeakSceneScreens/testPracticeWeakScene test
```

申請（1.0.1）には、今の画面で撮った次の 8 枚を、この順で使う（上限は 10 枚）。

1. `1-home`（ホーム）
2. `2-lobby`（待合）
3. `3-play`（話している途中）
4. `4-waiting`（話し終えて採点を待つ）
5. `5-ranking`（結果の順位）
6. `7-review`（振り返り）
7. きろく（下に「苦手をぶっとばせ！」の入口つき）: `WeakPointsScreens/testWeakPoints` の `w1-records-entry`
8. 苦手の画面（「次はここ」と「この苦手の場面で練習する」）: `WeakSceneScreens/testPracticeWeakScene` の `s2-ready`

### 3. App の情報を入れる

下の「入れる値」を App Store Connect の各画面に写す。

### 4. 審査に出す

1. 「<版> 提出準備中」でビルドを選ぶ。1.0.1 では (5) を選ぶ（(4) は staging につなぐ版なので選ばない）。
2. **バージョンのリリース → 「このバージョンを手動でリリースする」** を選ぶ（承認されても勝手に公開されない）。
3. 審査へ提出。

### アップデートを出すとき

1. `ios/project.yml` の `MARKETING_VERSION` を上げる（例 `1.0.1` → `1.0.2`）。同じ版でビルドを上げ直すときは `CURRENT_PROJECT_VERSION` だけを上げる。
2. 上の 2〜4 をもう一度。App Store Connect で新しいバージョン（＋ バージョン）を作ってからビルドを選ぶ。
3. 前の版が承認済みで手動のリリース待ちのままだと、新しいバージョンを作れない。2026-11-14 は、1.0（承認済み・手動リリース待ち）を公開せずにその版で「このリリースをキャンセル」を押し、同じ版の番号を 1.0 から 1.0.1 に替え、ビルドを 1.0.1 (5)（main `7d17ce3` を `NG2622 Store` で Archive したもの）に替えて審査に出し直した。`ios/project.yml` の版の番号は 1.0.1 (5) に合わせてある。(5) の後の tree から 1.0.1 を上げ直すときは、`CURRENT_PROJECT_VERSION` を 6 以上にする。

### staging につなぐ TestFlight 版の作り方（Award Day 向け）

**Award Day に配った 1.0.1 (5) は、この作り方の staging の版ではない。** main `7d17ce3` を App Store の版と同じ `NG2622 Store` の構成で Archive し（版の番号だけをコマンドで上書きし、`BACKEND_URL` は上書きしない）、本番のバックエンドにつなぐ（[`docs/design/part-generation.md`](../design/part-generation.md) の 3）。同じビルドを TestFlight（当日のデモ）と App Store の審査の両方に使った。会場の 3D は、本番の `TITLE_CAMPAIGN` を 11/15 まで `jphacks-2026` にして出す（#141）。下は、staging につなぐ版を作るときの手順（1.0.1 (4) で使った）。

Award Day（2026-11-15）の会場向けに、1.0.1 (4) まで staging につないで作った版。App Store の版との違いは、つなぎ先が staging のバックエンドになることだけ。ホームの 3D を企業の 3D 広告の見本（ハッカソンの会場。[`assets/title/`](../../assets/title/README.md)、3D の下に「PR」の札と「JPHACKS」）にするのは、アプリではなく staging のバックエンドが決める（`GET /title`。当時は staging にだけ `TITLE_CAMPAIGN` を付けてデプロイした。手順は [`backend/README.md`](../../backend/README.md) の「staging だけで出す」、決め方は [ADR](../adr/20261113-decide-title-diorama-on-server-with-expiry.md) と [ADR](../adr/20261113-swap-title-diorama-in-place-and-label-as-pr.md)）。アプリは、起動時と前に戻ったときに確かめ、確かめが終わった時点でその場で会場に替え、期限（日本時間 11/15 23:59:59）を過ぎたら公園に戻す。scheme と構成は App Store の版と同じ `NG2622 Store` のまま、Archive のコマンドでつなぎ先と版の番号だけを上書きする（別の構成や scheme は作らない）。

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
- `MARKETING_VERSION`: 審査に出している版と別の番号にする。App Store Connect は、承認済みの版より低い番号を受け付けない。App Store に出す次の版は、この番号より上にする。`1.0.1` は 1.0.1 (5) で App Store の版にもなったので、次に staging の版を作るなら別の番号にする。
- `CURRENT_PROJECT_VERSION`: その `MARKETING_VERSION` で上げたことのある番号より大きい数（初めての版なら `1` でよい）。
- 上げたビルドは TestFlight のグループに入れて配る。App Store Connect の「提出準備中」の版には選ばない。
  - 当日の主は、デモの端末（内部テストのグループで入れたチームの端末）。
  - 来場者の自分の端末に入れてもらうのは、外部テストのグループ（公開リンク）の Beta App Review が通った場合だけ。通るまでは公開リンクから入れられないので、来場者が入れられるとは約束しない。
- 上書きが効いたかは、`build/NG2622-awardday.xcarchive/Products/Applications/NG2622.app/Info.plist` の `BackendURL`・`CFBundleShortVersionString`・`CFBundleVersion` で確かめられる（`plutil -p`）。
- 会場が出るかは、配る前に `curl -s <staging の URL>/title` で `title` が返ることを確かめる。
- アプリは、起動時と前に戻ったときに `GET /title` を確かめ、確かめが終わった時点で、ホームを見ている途中でもその場で会場に替える（短いクロスフェード）。初めて入れた端末では、公園が一瞬出てから会場に替わる。替わらないときは、アプリを裏に回して前に戻す（確かめ直す）。
- 配ってある 1.0.1 (4) は、前の決め（次にホームを開いたときから出す）のままで、タイトルの下に `caption` を字で出す。staging の `caption` を「JPHACKS」にしたあとは、1.0.1 (4) では「JPHACKS」の字だけが出る（「PR」の札は、この直しを入れた版から）。
- ストアの版（審査に出す版）にも、会場の 3D（`assets/title/hackathon.usdz`、2.4 MB）がアプリの中に入る。Mock でビルド設定 `TITLE_DIORAMA` のときに出すのと、Live でサーバーの 3D と中身が同じなら通信で取らずに写す（会場の回線で取り直さない）ためで、構成ごとに写し分けていない。本番の `GET /title` は普段は null で、ストアの版の画面には出ない。ただし Award Day の間は本番の `TITLE_CAMPAIGN` も `jphacks-2026`（#141）なので、日本時間 2026-11-15 23:59:59 まで、ストアの版（審査中の 1.0.1 (5) も）のホームに会場の 3D と「PR」の札・「JPHACKS」が出る。期限を過ぎるとサーバーは null を返し、アプリも公園に戻す。
  - 下の審査メモの 6. の「no protected third-party material」は、3D をチームが作ったことを言っている。この 3D には JPHACKS（本作品が出るハッカソンの主催）の名前の文字が入る（ロゴの画像は使わず、フォントの文字に色を付けたもの）。1.0.1 では、期限までホームに出ることを審査メモの最後の段落に書いた。
- 本番で `TITLE_CAMPAIGN` を入れて広告の 3D を出すときは、先に「年齢制限の質問」の「広告」の答えと、App Review に関する情報の審査メモを直す。1.0.1 の申請（2026-11-14）では、審査中に会場の 3D が見えうるので、広告を「はい」にし、審査メモに段落を足した。期限の後の次の版で、広告を「いいえ」に戻し、段落も外す。

## 入れる値

### App 情報

| 項目 | 値 |
|---|---|
| 名前 | ScenEnglish |
| サブタイトル（30 文字まで） | 3D の場面を英語で描写して対戦 |
| カテゴリ | プライマリ 教育、セカンダリ ゲーム（サブカテゴリ 教育 / Word） |
| コンテンツの権利 | 第三者のコンテンツを含まない（3D の部品は、チームが作った物と、私たちのサーバーが AI（Claude）の書いた部品表から組んだ物。場面の英文・講評・苦手の分析は AI が生成。ホームの会場の 3D もチームが作った物で、JPHACKS の名前をロゴの画像ではなく文字で入れている） |
| 年齢制限 | 下の「年齢制限の質問」 |
| プライバシーポリシーの URL | <https://github.com/jphacks/ng_2622/blob/main/PRIVACY_POLICY.md> |

### 価格と配信

- 価格: 無料
- 配信する国: 日本（UI が日本語だけのため）。広げるのはアプリを英語にしてから。

### バージョン 1.0.1 の情報

1.0 を公開せずに取り下げて出し直した版（上の「アップデートを出すとき」の 3.）。場面は部屋のスタートでは作らず、難易度ごとの作り置き（`backend/src/scenes/pool/`）から選ぶ（本番は `SCENE_GENERATION: "off"`）ので、「AI がその場で場面を作る」とは書かない。

**プロモーション用テキスト（170 文字まで）**

```
3D の場面を英語で描写して、友達と点数を競おう。何を言えたか・どう言えたか・どう話せたかを AI が採点。遊んだ記録から AI があなたの苦手を見つけ、その苦手を練習する場面も作ります。
```

**説明（4000 文字まで）**

```
ScenEnglish（シーングリッシュ）は、3D の場面を見て英語で描写する、スピーキングの練習ゲームです。友達と iPhone で同時に遊べて、一人でも遊べます。

同じ 3D の場面をみんなで見て、そこで起きていることを英語で説明します。「公園で男の子が犬とボールで遊んでいる」「カフェで女性がコーヒーを注いでいる」――何をどう言うかは自由です。AI が採点して順位を発表し、全員の描写を並べて見比べられます。遊んだ記録からは、AI があなたの苦手を見つけ、その苦手を練習する場面を作ります。

■ 遊び方（1 ラウンド約 1 分）
1. 部屋に集まる：「あそぶ」で自分の部屋ができます。友達も「あそぶ」を押し、待合の「他のルーム」で 4 桁のコードを打つか QR コードを読むと、同じ部屋に入れます。一人でも遊べます。
2. 同時に見る：難易度を選んでスタートすると、AI で作った 3D の場面が全員の画面に同じ時刻に現れます。指で回して見回せます。
3. 同時に話す：見たものを英語で描写します（最長 20 秒）。
4. 結果発表：AI の採点で順位を発表。全員の描写と講評を見比べられます。
5. 振り返り：場面のチェック（言えたこと・あと少しのこと）、次の一つ、見本の答え、言い直しの例、話し方の一言が出て、自分の声も聞き直せます。

■ きろくと苦手
・きろく：遊んだ回の採点と振り返り、自分の声を、場面ごとに見返せます。
・苦手の分析：採点できた回が 5 回たまると、きろくの「苦手をぶっとばせ！」から、AI が直近の記録からくり返している癖と、次の 1 回で試すことを教えてくれます。
・苦手の場面：分析のあと、その苦手を練習するための 3D の場面を AI が作ります。「この苦手の場面で練習する」で、その場面の部屋から遊べます。

■ 特長
・AI で作った場面：AI が 3D の部品を組み合わせて作った場面から、その部屋でまだ出ていない場面が出ます。
・3 つの観点で採点：何を言えたか（内容）、どう言えたか（表現）、どう話せたか（話し方：発音・流暢さ）。
・次に伸ばす一つが分かる：講評は「次の一つ」と、言い直しの例を示します。
・難易度を選べる：かんたん・ふつう・むずかしい。

■ ご注意
・採点のため、話した声をインターネット経由で採点のサービス（Microsoft Azure、Anthropic Claude）に送ります。録音はサーバーには保存しません。自分の結果と録音は、見返せるよう端末の中にだけ残ります（設定の「きろくと録音をすべて消す」か、アプリを消すと消えます）。
・苦手の分析では直近の記録の文字（文字にした英文と採点の結果。録音は除く）を、苦手の場面では級と苦手の種類と分析の一部を、Anthropic Claude に送ります。作った苦手の場面と 3D の部品は、あなたと結び付けずにサーバーに保存し、3D の部品はほかの人の場面にも使います。
・マイクを使います。QR コードで部屋に入るときはカメラを使います。
```

- 「英検」は入れていない（日本英語検定協会の登録商標。アプリの画面にも出していない）。入れるなら説明文だけに「英検®」と書き、キーワードには入れない（Guideline 2.3.7）。

**キーワード（100 文字まで、カンマ区切り）**

```
英会話,英語,スピーキング,発音,対戦,ゲーム,AI,採点,3D,描写,友達,パーティー,学習,勉強,English,苦手,練習,復習
```

**サポート URL**: <https://github.com/jphacks/ng_2622/issues>

**マーケティング URL**（任意）: <https://github.com/jphacks/ng_2622>

**著作権**: `2026 ScenEnglish Team`

### App Review に関する情報

- サインイン情報: 不要（アカウントが無い）。「サインインが必要」のチェックを外す。
- 連絡先: 自分の氏名・電話番号・メールアドレスを入れる（公開されない）。
- 画面収録: 実機（最新の iOS）で録り、App Review に関する情報の「添付ファイル」に上げる（2026-11-03 の Guideline 2.1 Information Needed で、起動から 1 ラウンドの終わりまでを求められた）。限定公開の動画の URL にするときは、メモの 1. の頭の「Attached: a recording」を「Video: <URL>. A recording」に替え、4000 文字を超えないか数え直す。1.0.1 では、新しい苦手の場面まで録る。苦手の画面は採点できた回が 5 回たまらないと出ないので、録画の前に遊んでおく。
  1. 本番につなぐ 1.0.1 (5)（TestFlight の同じビルドでよい）を入れた iPhone で、撮る前に 4 ラウンドを遊んでおく（採点できた回を 4 件。メモの 1. の「4 rounds were played beforehand」）。表示名は本名にしない。
  2. 録画を始め、アプリを起動 → ホーム →「あそぶ」→ 待合 →「スタート」→ 1 ラウンドを通す（話す → 採点 → 順位 →「自分の結果を振り返る」）→「退出する」。
  3. 「きろく」→「苦手をぶっとばせ！」→ AI の分析 →「苦手の場面を作っています…」→「この苦手の場面で練習する」→ 待合の「苦手の場面」→「スタート」→ ラウンドが始まるまで（結果まで録ってもよい）。長さは 4〜6 分ほどの見込み。
  - マイクの許可の確認は、遊んでおいたときに出ているので録画には出ない。許可を聞く時点はメモの 3. の 1) に書いてある。
  - 11/15 までに録ると、ホームに会場の 3D と「PR」の札が映る。メモの最後の段落と合うので、そのままでよい。
- メモ（Apple が求めた 1〜6 の順に答える。審査員はふつう一人で見るので、一人で通しで遊べることと、苦手の画面には採点できた回が 5 回要ることを書く。4000 文字まで。最後の段落を含めて 3923 文字（Python の `len()`、改行も 1 文字））:

```
1. Screen recording
Attached: a recording on a physical iPhone (latest iOS) from launch through one full round, then Records, the weak-point analysis and a round in a weak-point scene (4 rounds were played beforehand; see 3.6). No account, login or paid content.
User-generated content is only display names and spoken English descriptions, visible only to players in the same private room (4-digit code); room data is deleted within 2 hours of inactivity.

2. Purpose and target audience
An English speaking game for Japanese learners (students and adults). Players describe the same 3D scene in English; the app scores content, expression and pronunciation/fluency, shows one thing to improve, and (new) makes a 3D scene to practice repeated weak points. Scenes remove "what should I say?"; friends make it fun.

3. How to use (no login; one person can play alone)
1) Enter any name, tap "はじめる" (Start), then "あそぶ" (Play). This creates your room and asks for microphone access; please allow it.
2) In the lobby, choose "かんたん" (easy) and tap "スタート" (Start). The round starts at once with a 3D scene we generated with AI in advance.
3) After a 3-second countdown, describe the scene in English (up to 20 s) and tap "話し終えた" (Done).
4) After scoring (10-20 s), the ranking, all descriptions and your feedback are shown.
5) Records (new): tap "きろく" on the home screen to review past rounds (stored only on the device).
6) Weak points (new): "苦手をぶっとばせ！" appears at the bottom of Records only after 5 scored rounds; one round is not enough. Tap "同じ顔ぶれでもう一度" (Play again) on the ranking screen and "スタート" until 5 rounds are scored (about 1 min each; rounds showing "採点できませんでした" do not count). Then tap "退出する" (Leave), "きろく", "苦手をぶっとばせ！". The AI analysis appears in about 5-10 s.
7) Weak-point scene (new): the server then makes a practice scene with AI ("苦手の場面を作っています…", 5-30 s, up to 100 s). Tap "この苦手の場面で練習する" (Practice this scene); a new room opens showing the scene name. Tap "スタート". On failure (e.g. hourly limit) a banner "苦手の場面を作れませんでした" appears; reopening the screen retries.
To join another room, tap "他のルーム" in the lobby and enter the code or scan the QR code (the only use of the camera).

4. External services
- Cloudflare Workers, Durable Objects, R2: our backend (rooms, scoring requests, usage limits, generated scenes and 3D objects).
- Microsoft Azure AI Speech: pronunciation and fluency.
- Anthropic Claude API: scoring, feedback, weak-point analysis, and weak-point scenes with part tables (JSON) of new 3D objects, which our server builds into models. Normal scenes were generated in advance.
- Apple Speech framework: on-device transcription.
Recordings are used only for scoring and not stored on the server. Results and recordings stay only on the device (not backed up or uploaded). The analysis sends only text of recent rounds (no audio, name or device ID) and is not stored. The scene request sends only the level, weak item types and parts of the analysis. Generated scenes and objects are stored on our server without user identifiers; new objects are reused in other players' scenes.

5. Regional differences
Japan only. Same features everywhere; Japanese UI, English practice.

6. Regulated industry / third-party material
Not regulated. No protected third-party material: 3D models were made by our team or built by our server from AI-written part tables; scene text and feedback are AI-generated. Generated objects exclude people, animals, buildings and personal names; weapons, violence, sexual content, hate symbols, drugs, tobacco and alcohol are refused.

Until Nov 15, 2026 23:59 JST, the home screen shows a 3D hackathon venue labeled "PR" and "JPHACKS" (the hackathon where this app is presented), a sample of our planned sponsor slot, not a paid ad. Our team made it (the name is plain text, no logo image); no ad SDK, tracking, impression counting or links. Then the park scene returns.
```

- 最後の段落（Until Nov 15, …）は、本番の `TITLE_CAMPAIGN` が `jphacks-2026` の間（日本時間 11/15 23:59:59 まで）に審査されうるので足した（2026-11-14）。期限の後の次の版で外す。
- 苦手の場面がある版を審査に出す前に直すとしていた所（コンテンツの権利、メモの 1.・3.・4.・6.）は、1.0.1 で直した（2026-11-14）。あわせて、場面をその場で作るという 1.0 の説明（3. の 3)）を、作り置きからすぐ始まる今の振る舞いに直した。

### App のプライバシー（App Store Connect の「App のプライバシー」）

[`PrivacyInfo.xcprivacy`](../../ios/NG2622/App/PrivacyInfo.xcprivacy) と揃える。

- データの収集: **はい、収集する**
- 収集するデータの種類:
  - **ユーザコンテンツ → オーディオデータ**: 用途 App の機能。ユーザに関連付けない。トラッキングに使わない。
  - **ユーザコンテンツ → その他のユーザコンテンツ**（表示名、文字にした英文。以前の版は場面の評価とコメントも）: 用途 App の機能。ユーザに関連付けない。トラッキングに使わない。
    - 2026-11-13 に、結果の画面から場面の★評価を外し、アプリは評価とコメントを送らなくなった（理由: 結果の画面のノイズ。サーバーの口とデータは残してあり、戻せる）。今送るのは表示名と文字にした英文だけ。それでも「その他のユーザコンテンツ」には当たるので、ここの答えは変えない。評価のためだけに端末で作っていた乱数の ID も、今の版では作らず送らないので、「識別子」の申告は要らない。
  - **診断 → その他の診断データ**（1.0.1 の申請で足した。2026-11-14）: 用途 App の機能。ユーザに関連付けない。トラッキングに使わない。Cloudflare の動作の記録（ログ）に接続元の IP アドレスが最大 7 日残り、障害と使い過ぎの調べに使うため（下の苦手の場面の 3 つ目）。`PrivacyInfo.xcprivacy` にも足した（1.0.1 (5) のビルドには入っておらず、次のビルドから入る）。
- それ以外（連絡先、位置情報、識別子、使用状況など）は収集しない。
- 遊んだ記録（自分の結果と録音。[`docs/design/play-record.md`](../design/play-record.md)）を端末の中に保存することは、ここの答えを変えない（2026-11-12 に確かめた）。App Store の「収集」は、データを端末の外へ送り、その場の処理より長く持つこと。記録そのもの（録音を含む）は端末の外へ送らない。苦手の分析のときに送る文字は下のとおり。録音を採点のために送ることは、上の「オーディオデータ」でもう答えている。
- 苦手の分析（2026-11-13。[`docs/design/weak-point-analysis.md`](../design/weak-point-analysis.md)）では、直近の記録の文字（文字にした英文・採点の判定と講評・場面の見本の答え。録音は除く）を、分析のときだけサーバーを通して Claude へ送り、サーバーには残さない。ここの答えは変えない。送るのは文字にした英文とその採点の結果で、上の「その他のユーザコンテンツ」（文字にした英文）として申告済みのため。ユーザに関連付けず、トラッキングにも使わない。
- 苦手の場面（2026-11-14。[`docs/design/part-generation.md`](../design/part-generation.md)。苦手の場面がある版から）では、次の 3 つが新しく起きる。ここの答え（オーディオデータとその他のユーザコンテンツ）は変えないと判断した（2026-11-14）。
  - 級・項目の種類（言えた割合の低い順に、数えられた種類を全部）と、AI の分析の一部（くり返す癖の題と直し方・次に試すこと）を、サーバーを通して Claude へ送る。直し方には、本人の文を元に AI が書いた英語の例が入ることがある。癖の題と直し方・次に試すことはサーバーに残さない。級と狙った種類は、作った場面の情報として R2 に残る（ログにも級・狙った種類・癖の数が出る）。分析は本人の文字にした英文から作ったもので、上の「その他のユーザコンテンツ」に含まれる。録音・表示名・端末の ID は送らない。
  - 接続元の IP アドレスで、1 時間あたりの回数を数える。苦手の分析と同じく、日ごとの乱数を混ぜた形で回数だけを持ち、1 時間で消す。使い過ぎを防ぐためだけで、場所を推し量らない。判断の理由: Apple の App Privacy Details の Additional guidance は「You collect and store IP address from your users. Declare the relevant data types based on how you use IP address, such as precise location, coarse location, device ID, or diagnostics.」と、IP アドレスは使い方に合わせて申告するとしている（<https://developer.apple.com/app-store/app-privacy-details/>）。回数の数え方では使い過ぎを防ぐためだけに使い、場所・端末の識別には使わないので、この数え方のための申告は足さない。IP アドレスそのものは残さず、日ごとに変わる乱数で作った値（IP の HMAC）を、回数と一緒に最大 1 時間だけ持つ。苦手の分析の IP の数え方も同じ扱いになる。
  - ただし、Cloudflare の動作の記録（Workers Logs の呼び出しのログ）には、どの通信でもリクエストの見出しとして IP アドレスが入りうる（最大 7 日。障害と使い過ぎを調べるため。Cloudflare の文書は、呼び出しのログにリクエストの見出しが入るとし、IP を伏せるとは書いていない）。苦手の場面より前からある扱いで、プライバシーポリシーの「通信の情報」に書いた。ログを障害の調べに使うことは、上の「診断 → その他の診断データ」に当てると決め、1.0.1 の申請で足した（2026-11-14）。
  - 作った場面（英文・配置、級・狙った種類・作った時刻）と 3D の部品を、R2 に残す（消す時期は決めていない）。表示名・端末の ID を含めず、本人と結び付けない。場面の英文には、送った癖・直し方（本人の文を元にした AI の英語の例を含みうる）・次に試すことに沿った中身が表れうる。中身は送った文字から作ったものなので、上の「その他のユーザコンテンツ」（ユーザに関連付けない・トラッキングに使わない）の範囲とみる。
- 採点のログ（[`backend/src/scoring/index.ts`](../../backend/src/scoring/index.ts) の `scoring_timing`）には、Azure が声から文字にした英文（`azureTranscript`）が、場面の ID・語数・録音の大きさ・文字起こしの出どころ（端末か Azure か）・かかった時間・Claude の呼び直しの回数と一緒に入り、Workers Logs に最大 7 日残る。端末の文字起こしの精度を Azure と見比べるため。表示名・端末の ID は入れない。端末で文字にした英文も、音声を送る口の見出し `X-Transcript` に入るので、呼び出しのログに残りうる（Cloudflare の Tail Workers の文書の例では、ログの `request.headers` に独自の見出しも入っている。ダッシュボードで一度確かめる）。ログは変えず、プライバシーポリシーの表と「採点の記録」に書き足した（2026-11-14）。文字にした英文は上の「その他のユーザコンテンツ」で申告済みなので、ここの答えは変えない。用途は、文字起こしの方式を保つか戻すかを決める機能の改善のためなので、App の機能とみた。

### 年齢制限の質問

| 質問 | 答え |
|---|---|
| 暴力・性的な内容・ギャンブル・薬物・恐怖など | すべて「なし」 |
| 医療・健康の情報 | なし |
| 制限のないウェブアクセス | いいえ |
| メッセージやチャット | いいえ（自由な文章のやり取りは無い） |
| ユーザ生成コンテンツ | はい（同じ部屋の参加者に、表示名と英語の描写が見える。部屋はコードを知る人だけが入れ、最長 2 時間で消える。苦手の場面は本人の苦手から AI が作り、その部屋の参加者だけが遊ぶ。その場で作る 3D の部品は物だけで、人・動物・建物は作らず、人の名前・武器・暴力・性的な物・憎しみの記号・薬物・たばこ・酒は断る。作った部品はほかの人の苦手の場面にも使う） |
| 広告 | はい（1.0.1。本番の `TITLE_CAMPAIGN` が `jphacks-2026` の間、日本時間 2026-11-15 23:59:59 まで、ホームに会場の 3D と「PR」の札・「JPHACKS」が出るため。期限の後の次の版で「いいえ」に戻す） |
| 年齢確認・ペアレンタルコントロール | いいえ |

結果は 4+ か 9+ になる見込み。

## 審査で気をつけること

- 本番のバックエンド（`https://ng-2622-backend.jphacks-ng2622.workers.dev`）が動いていないと審査に落ちる（2.1 アプリの完成度）。審査中は止めない・壊さない。Claude と Azure の支出上限に達していないかも確かめる（[`docs/design/cost-safety.md`](../design/cost-safety.md)）。
- 声を外部の AI（Azure・Claude）に送ることについて、アプリの中で同意を取る画面は置いていない（ガイドライン 5.1.2(i)）。説明文・審査メモ・プライバシーポリシーで知らせている。これを理由に却下されたら、初回に一度だけ同意を取る画面を足して出し直す。
- 「ユーザ生成コンテンツ」で 1.2（通報・ブロックの仕組み）を求められたら、結果の画面に参加者の通報の口を足す。
