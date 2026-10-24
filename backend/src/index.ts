import { Hono } from "hono";

const app = new Hono();

// 動いているかの確認用（デプロイ後の疎通確認にも使う）
app.get("/health", (c) => c.text("ok"));

export default app;
