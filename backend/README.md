# backend

Hono on Cloudflare Workers のバックエンド。構成は [`docs/design/architecture.md`](../docs/design/architecture.md)。

## 手元で動かす

pnpm を使う（版は `package.json` の `packageManager` で固定。pnpm 10 以上なら自動でその版に切り替わる）。

```sh
pnpm install
pnpm dev              # http://localhost:8787/health が ok を返す
pnpm typecheck
pnpm openapi          # openapi.json を生成し直す
```

- API の画面（Swagger UI）: http://localhost:8787/docs
- OpenAPI: http://localhost:8787/openapi.json
- `/docs`・`/openapi.json`・`/dev/score` は `ENABLE_DEV_ROUTES=true` のときだけ開く。`pnpm dev` が自動で付けるので、手元では何もしなくてよい。本番とプレビューでは 404 になる。

## 採点（`src/scoring/`）

1 人分の音声（WAV）とシーン ID から、内容・表現・話し方の点数と講評を返す。部屋からは `score(env, wav, sceneId)` と `ScoreResult`（`src/scoring/types.ts`）だけを使う。

- 話し方: Azure の発音評価（REST、正解文なし）。Accuracy・Fluency・Prosody の平均。
- 内容・表現・講評・模範表現: Claude（既定は `claude-haiku-5-5`）に文字起こしとシーンの説明を渡す。
- 合計は `SCORE_WEIGHTS`（内容,表現,話し方。既定 `50,25,25`）で重み付けする。
- `SCORING_MODE=fixed` で外部 API を呼ばず固定の点数を返す。デプロイ先は `wrangler.jsonc` で fixed にしてある。
- シーンは仮で `src/scoring/scenes.json` に置いている。

### 手元で採点を試す

`backend/.dev.vars` に次を書いて `pnpm dev` する（値は repo 直下の `.env` と同じ）。

```sh
ENABLE_DEV_ROUTES=true
SCORING_MODE=live
AZURE_API_KEY=...
AZURE_LOCATION=...
CLAUDE_API_KEY=...
```

```sh
# 16 kHz・16 bit・モノラルの WAV を作って送る（1 回で Azure と Claude を 1 回ずつ呼ぶ）
say -o test.wav --data-format=LEI16@16000 "There is a red bench under a big tree."
curl -F audio=@test.wav -F sceneId=park http://localhost:8787/dev/score
```

`/dev/score` は `ENABLE_DEV_ROUTES=true` のときだけ開く（`pnpm dev` が自動で付ける）。デプロイ先には入れない。

## デプロイ

main に `backend/` の変更が入ると、GitHub Actions（`.github/workflows/deploy-backend.yml`）が自動でデプロイする。手で出すときは `pnpm run deploy`（要 `pnpm exec wrangler login`）。

## 部屋の仕組み

- 部屋ごとに 1 つの Durable Object（`src/durable-objects/room.ts` の `Room`）が、参加者と進行を持つ。部屋のコード（数字 4 桁）を名前にして取り出す。
- コードの置き場所:
  - `routes/`: HTTP の受け口（入力の検証、OpenAPI の説明、レスポンス）
  - `usecases/`: HTTP の処理の中身
  - `repositories/`: 部屋の Durable Object へのアクセス
  - `domain/`: 部屋のルール（参加・スタート・採点の受け付け・締め切り・退出の判定と状態の変化）。Cloudflare に依存しない
  - `durable-objects/`: Durable Object（保存と WebSocket の送受信。判定は `domain/` に任せる）
  - `schemas/`: API の型（zod）
- WebSocket は Hibernation API で受ける。メッセージが無い間は DO が休止してメモリが消えるので、状態は変えるたびに DO の保存領域（SQLite）に書く。
- 誰もつないでいない部屋は 2 時間で消える（DO の alarm）。
- 音声（`POST /rooms/{roomId}/rounds/{round}/audio`）は Worker が受け取り、部屋に「採点中」と記録してから 202 を返す。採点（`score()`）は `waitUntil` で応答の後に続け、終わったら部屋に書き込む。全員の採点がそろうか、ホストが `close` すると、部屋が `results` を配る。
- 選べるシーンは、採点と同じ `src/scoring/scenes.json` から読む（`src/domain/scenes.ts`）。

## API のスキーマ（OpenAPI）

API の型は zod で書き、[hono-openapi](https://hono.dev/examples/hono-openapi) が OpenAPI を生成する。iOS はリポジトリにある `backend/openapi.json` から型を作る。

- ルートは `src/routes/`、型は `src/schemas/` に置く。`.meta({ ref: "名前" })` を付けた型が、OpenAPI の `components.schemas` に名前付きで出る。
- WebSocket のメッセージは OpenAPI の paths では表せないので、`components.schemas` の `ClientMessage`（iPhone → 部屋）と `ServerMessage`（部屋 → iPhone）に型だけを載せている。どちらも `type` の値で種類を見分ける（`oneOf` ＋ `discriminator`）。
- ルートや型を変えたら `pnpm openapi` で `openapi.json` を生成し直し、一緒に commit する。PR では backend-checks が `pnpm openapi:check` で生成し忘れを検査する。
- `openapi.json` は生成物なので Biome の整形の対象から外している（`biome.json`）。

### HTTP の API を足す手順

1. `src/schemas/http.ts` に、リクエストとレスポンスの型を zod で書く。`.meta({ ref: "名前" })` を付ける。

   ```ts
   export const RoomSummary = z
     .object({ roomId: RoomId, playerCount: z.int().min(0) })
     .meta({ ref: "RoomSummary", description: "部屋に入る前の確認用" });
   ```

2. 処理の中身を `src/usecases/` に書く。部屋の Durable Object を使うときは `src/repositories/` を通す。
3. `src/routes/` にルートを書く。`describeRoute` に説明とレスポンスを、`validator` に入力の検証を書く。

   ```ts
   .get(
     "/rooms/:roomId",
     describeRoute({
       operationId: "getRoom", // iOS で生成される関数名になる
       tags: ["rooms"],
       summary: "部屋があるかを確かめる",
       responses: {
         200: { description: "ある", content: jsonContent(RoomSummary) },
         404: { description: "部屋が無い", content: jsonContent(ErrorResponse) },
       },
     }),
     roomIdParam, // validator("param", RoomIdParam, ...)
     async (c) => { /* usecase を呼んで c.json(...) を返す */ },
   )
   ```

4. 新しいファイルにルートを作ったときは、`src/app.ts` の `.route("/", ...)` でつなぐ。
5. `pnpm openapi` で `openapi.json` を作り直し、`pnpm dev` の `/docs` で見え方を確かめる。
6. `pnpm typecheck` を通し、`openapi.json` も一緒に commit する。

### WebSocket のメッセージを足す手順

1. `src/schemas/ws.ts` に、`type` を固定したメッセージの型を書く。

   ```ts
   export const LeaveMessage = z
     .object({ type: z.literal("leave") })
     .meta({ ref: "LeaveMessage", description: "待合から抜ける" });
   ```

2. iPhone → 部屋 なら `ClientMessage`、部屋 → iPhone なら `ServerMessage` の `discriminatedUnion` の配列に足す。
3. **同じところの `discriminator.mapping` にも 1 行足す**（例: `leave: "#/components/schemas/LeaveMessage"`）。足し忘れても型チェックは通るが、iOS で作る型が壊れる。
4. iPhone → 部屋 のメッセージなら、`src/durable-objects/room.ts` の `switch` に処理を足す。判定（してよいか、状態をどう変えるか）は `src/domain/` に書く。
5. `pnpm openapi` で `openapi.json` を作り直して commit する。

## PR ごとのプレビュー

`backend/` を変える PR を出すと、GitHub Actions（`.github/workflows/backend-preview.yml`）がその PR 専用のプレビュー `https://pr-<PR番号>-ng-2622-backend.<サブドメイン>.workers.dev` を作り、URL を PR にコメントする。push のたびに更新され、PR を閉じると消える。iPhone から merge 前の版を試すときはこの URL に向ける。

- 本番とは別の Worker として動き、Durable Objects の保存領域も PR ごとに分かれる。
- `wrangler.jsonc` の上の階層に書いた vars と Durable Objects の binding は引き継がれない。プレビューでも使うものは `previews` の中にも書く。

## secret

API キーはファイルに書かない。

- 本番: `pnpm exec wrangler secret put <名前>`
- プレビュー: `pnpm exec wrangler preview base-config secret put <名前>`（以後に作るプレビューに入る。作成済みのプレビューには `wrangler preview secret put <名前> --name pr-<PR番号>`）
- 手元: `backend/.dev.vars` に `名前=値` で書く（gitignore 済み）

## 型

binding（Durable Objects など）の型 `CloudflareBindings` は、`wrangler types` が `wrangler.jsonc` から `worker-configuration.d.ts` に作る。生成物だが commit しておく（clone してすぐエディタで型が見えるように）。`wrangler.jsonc` や wrangler の版を変えたら `pnpm cf-typegen` で作り直して一緒に commit する。PR では backend-checks が `pnpm cf-typegen:check` で作り直し忘れを検査する。Biome の整形の対象からは外している。
