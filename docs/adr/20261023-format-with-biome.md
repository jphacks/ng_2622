# 2026/10/23 TypeScript は Biome で整形し、commit 時に自動でかける

## Status
- accepted

## Situation
- 言語は iOS が Swift（SwiftUI）、バックエンドが TypeScript（[20261021-adopt-swiftui-app-and-cloudflare-workers-backend](./20261021-adopt-swiftui-app-and-cloudflare-workers-backend.md)）。
- Hack Day（2026-10-24・25）では 5 人が各自 AI を使って同時にコードを書く。整形のルールが無いと、書き方の違いだけの差分や衝突が増える。
- リポジトリにはまだアプリ・バックエンドのコードが無く、整形のルールは `.editorconfig`（スペース 2 など）だけだった。

## Context
- コードを書き始める前に、フォーマッターと、それを自動でかける仕組みを決めておきたい。

## Material for decision
- Biome の Getting Started と Git Hooks の recipe（lefthook の設定例）
- 既存の lefthook（commit-msg・pre-push）と pr-checks の構成

## Decision
- TypeScript・JSON などは Biome（2.6.2、`package.json` で版を固定）で整形と lint をする。設定は `biome.json`。
  - 1 つの道具で整形と lint がそろい、設定が少なく速いため（Prettier ＋ ESLint の組み合わせより手間が少ない）。
  - Markdown は対象外にする。Biome の Markdown 整形は frontmatter の `---` を崩すため。
- インデントはスペース 2 にし、`.editorconfig` とそろえる。
- Swift のフォーマッター・linter は入れない。
- lefthook の pre-commit で、stage したファイルだけを自動で整形し、stage し直す。
- GitHub Actions の format-check で整形し忘れを検査する。ruleset の merge の条件には入れない。

## Consequences
- TypeScript では書き方の違いによる差分が減り、レビューで整形を指摘しなくて済む。
- 各メンバーは最初に一度 `npm install` が要る（Biome を node_modules に入れるため）。
- format-check は merge の条件ではないので、落ちたまま merge できてしまう。整形し忘れが目立ったら REQUIRED_CHECK に足す。
- Swift の整形はそろわない。必要になったら別の ADR で決める。
