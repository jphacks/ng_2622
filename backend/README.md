# backend

Hono on Cloudflare Workers のバックエンド。構成は [`docs/design/architecture.md`](../docs/design/architecture.md)。

## 手元で動かす

```sh
npm install
npm run dev          # http://localhost:8787/health が ok を返す
npm run typecheck
```

## デプロイ

main に `backend/` の変更が入ると、GitHub Actions（`.github/workflows/deploy-backend.yml`）が自動でデプロイする。手で出すときは `npm run deploy`（要 `npx wrangler login`）。

## secret

API キーはファイルに書かない。

- 本番: `npx wrangler secret put <名前>`
- 手元: `backend/.dev.vars` に `名前=値` で書く（gitignore 済み）

## 型

binding（Durable Objects など）を `wrangler.jsonc` に足したら `npm run cf-typegen` で型を作り直し、`new Hono<{ Bindings: CloudflareBindings }>()` で使う。
