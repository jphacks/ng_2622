import { Hono } from "hono";
import { type ScoringEnv, score } from "./scoring";

type Env = ScoringEnv & {
  // "true" のときだけ /dev/* を開く。手元の .dev.vars にだけ書き、デプロイ先には入れない
  ENABLE_DEV_ROUTES?: string;
};

const app = new Hono<{ Bindings: Env }>();

// 動いているかの確認用（デプロイ後の疎通確認にも使う）
app.get("/health", (c) => c.text("ok"));

// 部屋なしで採点だけを試す。multipart で audio（WAV）と sceneId を送る
app.post("/dev/score", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "true") return c.notFound();
  const form = await c.req.formData();
  const audio = form.get("audio");
  const sceneId = form.get("sceneId");
  if (!(audio instanceof File) || typeof sceneId !== "string") {
    return c.json({ error: "audio（ファイル）と sceneId が要る" }, 400);
  }
  return c.json(await score(c.env, await audio.arrayBuffer(), sceneId));
});

export default app;
