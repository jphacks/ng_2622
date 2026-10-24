# backend

Hono on Cloudflare Workers のバックエンド。構成は [`docs/design/architecture.md`](../docs/design/architecture.md)。

## 手元で動かす

pnpm を使う（版は `package.json` の `packageManager` で固定。pnpm 10 以上なら自動でその版に切り替わる）。

```sh
pnpm install
pnpm dev              # http://localhost:8787/health が ok を返す
pnpm typecheck
```

## デプロイ

main に `backend/` の変更が入ると、GitHub Actions（`.github/workflows/deploy-backend.yml`）が自動でデプロイする。手で出すときは `pnpm run deploy`（要 `pnpm exec wrangler login`）。

## secret

API キーはファイルに書かない。

- 本番: `pnpm exec wrangler secret put <名前>`
- 手元: `backend/.dev.vars` に `名前=値` で書く（gitignore 済み）

## 型

binding（Durable Objects など）を `wrangler.jsonc` に足したら `pnpm cf-typegen` で型を作り直し、`new Hono<{ Bindings: CloudflareBindings }>()` で使う。
