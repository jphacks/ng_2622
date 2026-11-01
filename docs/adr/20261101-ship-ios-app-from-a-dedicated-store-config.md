# 2026/11/01 App Store には専用のビルド構成で、高橋の個人チームから出す

## Status
- accepted

## Situation
- JPHACKS 2026 の Hack Day が終わり、作品をそのまま App Store に出せる状態にしておきたい。
- 初回の審査は時間がかかるので、ここまでの main で一度審査を通し、公開はアップデートを出してから行う。
- チームで Apple Developer Program に入っているのは高橋の個人チーム（`PHYJ4DL63M`）だけ。
- これまでのビルド構成（Mock・Live）は、各自の `Local.xcconfig` で bundle ID・チーム・つなぎ先を変えられる（[ADR](./20261024-build-ios-app-with-xcodegen-and-build-configs.md)）。

## Context
- ストアに出すビルドは、誰がアーカイブしても同じ bundle ID・チーム・本番のつなぎ先にならないといけない。Live の Release は `Local.xcconfig` を読むので、人によって bundle ID が `jp.jphacks.ng2622.<名前>` になり、つなぎ先も PR のプレビューに変わりうる。
- bundle ID はストアに出すと変えられない。

## Material for decision
- App Store Connect の申請に要るもの（アイコン、プライバシーマニフェスト、暗号の申告、プライバシーポリシーの URL、スクリーンショット、App のプライバシー）。
- App Review Guidelines 5.1.2(i)（外部の AI に個人データを送るときの開示と同意）。

## Decision
- ビルド構成 `Release-Store`（`ios/Config/Store.xcconfig`）と scheme `NG2622 Store` を足す。`Store.xcconfig` は `Shared.xcconfig` だけを読み、`Local.xcconfig` は読まない。bundle ID は `jp.jphacks.ng2622.app`、チームは `PHYJ4DL63M` を書いておく（チーム ID は秘密ではない）。
- 販売者は高橋の個人チームにする（ほかに入っている人がいない）。販売者名は Kouta Takahashi になる。
- 開発用のローカルネットワークの説明（`NSLocalNetworkUsageDescription`）は Debug の構成だけに入れ、ストアのビルドに残さない。
- 声を Azure と Claude に送ることへの同意の画面は、初回の申請では置かない。説明文・審査メモ・プライバシーポリシーで知らせ、却下されたら足す。
- 手順と App Store Connect に入れる値は [`docs/app-store/README.md`](../app-store/README.md) に置く。

## Consequences
- 誰がアーカイブしても同じものが上がる。ただし署名できるのは個人チームに入っている人（いまは高橋）だけ。
- 個人チームなので、販売者名がチーム名でなく個人名になる。組織に移すときはアプリの移管が要る。
- 同意の画面が無いことを理由に却下されうる（そのときは 1 画面を足して出し直す）。
