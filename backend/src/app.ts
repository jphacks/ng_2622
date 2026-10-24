import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { buildOpenAPISpec } from "./openapi";
import { devRoutes } from "./routes/dev";
import { healthRoutes } from "./routes/health";
import { roomRoutes } from "./routes/rooms";
import { roundRoutes } from "./routes/rounds";
import { sceneRoutes } from "./routes/scenes";
import { type AppEnv, devOnly } from "./routes/shared";

// Worker の入口（index.ts）と OpenAPI の生成スクリプトの両方から読むので、Cloudflare の実行環境にしか無いもの（cloudflare:workers など）はここから import しない

const app = new Hono<AppEnv>()
  .route("/", healthRoutes)
  .route("/", roomRoutes)
  .route("/", roundRoutes)
  .route("/", sceneRoutes)
  .route("/", devRoutes);

// API の説明は手元だけで見られるようにする（iOS は commit 済みの openapi.json を読む）
// backend/openapi.json と同じ形（null を許す項目の書き換えも含む）で返す。一度作ったら使い回す
let spec: Awaited<ReturnType<typeof buildOpenAPISpec>> | undefined;
app.get("/openapi.json", devOnly, async (c) => {
  spec ??= await buildOpenAPISpec(app);
  return c.json(spec);
});
app.get("/docs", devOnly, swaggerUI({ url: "/openapi.json" }));

export default app;
