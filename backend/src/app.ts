import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { openAPIOptions } from "./openapi";
import { devRoutes } from "./routes/dev";
import { healthRoutes } from "./routes/health";
import { roomRoutes } from "./routes/rooms";
import { roundRoutes } from "./routes/rounds";
import { type AppEnv, devOnly } from "./routes/shared";

// Worker の入口（index.ts）と OpenAPI の生成スクリプトの両方から読むので、Cloudflare の実行環境にしか無いもの（cloudflare:workers など）はここから import しない

const app = new Hono<AppEnv>()
  .route("/", healthRoutes)
  .route("/", roomRoutes)
  .route("/", roundRoutes)
  .route("/", devRoutes);

// API の説明は手元だけで見られるようにする（iOS は commit 済みの openapi.json を読む）
app.get("/openapi.json", devOnly, openAPIRouteHandler(app, openAPIOptions));
app.get("/docs", devOnly, swaggerUI({ url: "/openapi.json" }));

export default app;
