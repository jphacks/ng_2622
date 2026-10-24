# 2026/10/24 iOS アプリは xcodegen で作り、仮のデータと本物の API は scheme ごとのビルド構成で切り替える

## Status
- accepted

## Situation
- iOS のアプリは SwiftUI のネイティブアプリ、3D は RealityKit にすると決めている（[20261021-adopt-swiftui-app-and-cloudflare-workers-backend](./20261021-adopt-swiftui-app-and-cloudflare-workers-backend.md)）。
- Hack Day（2026-10-24・25）で、Mac を持つ 2 人がそれぞれ画面を足していく。署名には各自の個人のチームを使う。
- バックエンドの API はほかのメンバーが並行して作っていて、まだつなげない。アプリは仮のデータで先に画面を作る。
- 手元の iPhone は iOS 26 以上。デモに要るのは 2 台。

## Context
- `ios/` にアプリの土台を置くにあたり、プロジェクトファイルの持ち方、署名の設定の置き場所、仮のデータと本物の API の切り替え方、対応する iOS を先に決めておきたい。
- `.xcodeproj` をそのまま commit すると、複数人がファイルを足すたびに `project.pbxproj` が衝突する。
- bundle ID は Apple の全チームを通じて 1 つしか登録できないので、メンバーごとに変える必要がある。

## Material for decision
- issue #19 の「認識合わせ」（grill-me / grill-spec、2026-10-24 合意）
- 閉じた PR #16（結果画面の SwiftUI アプリ。xcodegen の `ios/project.yml` を使い、`*.xcodeproj` を ignore していた）
- [`docs/design/architecture.md`](../design/architecture.md)（PR ごとのプレビューのバックエンド）

## Decision
- iOS のアプリは `ios/` に置き、xcodegen でプロジェクトを作る。`ios/project.yml` を commit し、`.xcodeproj` は ignore する。
  - 理由: `project.pbxproj` の衝突を避けられる。PR #16 と同じやり方。
  - 見送った案: `.xcodeproj` を commit する（ファイルを足すたびに衝突する）。
- 署名のチーム ID と bundle ID は、各自の `ios/Config/Local.xcconfig`（ignore）に置く。ひな形は `ios/Config/Local.xcconfig.example`。
  - 理由: bundle ID は全チームで一意で、メンバーは各自の個人のチームで署名するため。
- 仮のデータと本物の API は、scheme ごとのビルド構成で切り替える。scheme「NG2622 Mock」と「NG2622 Live」を置き、xcconfig の `BACKEND_MODE`・`BACKEND_URL` を Info.plist に入れてアプリから読む。PR ごとのプレビューの URL は、`Local.xcconfig` で上書きできる。
  - 理由: ビルドに値が入るので、ホーム画面から開いても効く。
  - 見送った案: scheme の環境変数（Xcode から起動したときしか効かず、ホーム画面から開くと消える）。アプリ内のデバッグメニュー（開発用の UI がプロダクトに残る）。
- Mock の振る舞い（ほかの参加者の数、途中で切断する人を入れるか、参加者として入ったときにホストがスタートするまでの秒数）も、同じ道筋で xcconfig の `MOCK_*` から入れる。既定値は `Mock.xcconfig`、各自の変更は `Local.xcconfig` に書く（2026-10-24、issue #22）。アプリはホームから始まり、開発用の入り口の画面は置かない。
- 対応する iOS は 26 以上にする。手元の iPhone に合わせた。
- 3D は RealityKit の `RealityView` で描く。USDZ のモデルができるまでは箱を組んで作り、できたら読み込みに差し替える。
  - 追記（2026-10-24）: `assets/scenes/*.usdz` の読み込みに差し替え、箱の公園は消した。

## Consequences
- ファイルを足しても `project.pbxproj` の衝突が起きない。代わりに、Mac のメンバーは xcodegen を入れ、clone や `project.yml` の変更のあとに `(cd ios && xcodegen)` を打つ必要がある。
- 各メンバーは最初に一度、`Local.xcconfig.example` を `Local.xcconfig` に写して自分のチーム ID と bundle ID を書く。
- Mock と Live を scheme で選ぶだけで切り替えられ、iPhone に入れたあとも選んだ方のまま動く。切り替えるにはビルドし直す。
- iOS 26 より古い iPhone のメンバーは、アプリを入れられない。デモは iOS 26 以上の 2 台で足りる。
- 箱で組んだ 3D は見た目が仮のもので、USDZ ができたら差し替える手間が残る。
