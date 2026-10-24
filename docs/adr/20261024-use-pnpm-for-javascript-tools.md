# 2026/10/24 JavaScript の道具は repo 全体で pnpm で入れる

## Status
- accepted

## Situation
- バックエンド（`backend/`）は pnpm で依存を入れている（`packageManager` で版を固定、#5）。
- repo の直下には、Biome を入れるための `package.json` が npm（`package-lock.json`）で置かれた（#6、[20261023-format-with-biome](./20261023-format-with-biome.md)）。
- 1 つの repo で npm と pnpm を使い分けると、どこでどちらを使うかを覚える必要があり、ロックファイルも 2 種類になる。

## Context
- 各メンバーが最初に入れる道具と、手元・CI で打つコマンドを 1 つにそろえたい。

## Material for decision
- `backend/package.json` の `packageManager`（pnpm 10.34.7）と、backend の CI（pnpm/action-setup）
- 直下の `package.json`・`lefthook.yml`・`.github/workflows/format-check.yml`

## Decision
- repo の直下も pnpm にする。版は backend と同じ 10.34.7 を `packageManager` で固定する。
- 直下と `backend/` は別々のプロジェクトのままにし、ロックファイルもそれぞれに置く（pnpm の workspace にはしない）。backend の CI と手順を変えずに済むため。
- lefthook の pre-commit と format-check の CI は、`pnpm exec biome` で Biome を呼ぶ。

## Consequences
- 各メンバーが最初に入れるのは pnpm だけになり、コマンドも `pnpm install`・`pnpm format` にそろう。
- npm で `npm install` 済みのメンバーは、`node_modules` を消して `pnpm install` し直す必要がある。
- [20261023-format-with-biome](./20261023-format-with-biome.md) の Consequences にある「`npm install` が要る」は、この ADR で `pnpm install` に読み替える。Biome を使う決定そのものは変わらない。
