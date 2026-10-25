import { Hono } from "hono";
import { score } from "../scoring";
import type { AppEnv } from "./shared";

// 部屋なしで採点だけを試す（transcript を付けると、端末で文字起こしした発話として扱う）。
// ENABLE_DEV_ROUTES=true（手元の .dev.vars）のときだけ開き、OpenAPI には載せない
export const devRoutes = new Hono<AppEnv>().post("/dev/score", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "true") return c.notFound();
  const form = await c.req.formData();
  const audio = form.get("audio");
  const sceneId = form.get("sceneId");
  const transcript = form.get("transcript");
  if (!(audio instanceof File) || typeof sceneId !== "string") {
    return c.json({ error: "audio（ファイル）と sceneId が要る" }, 400);
  }
  return c.json(
    await score(
      c.env,
      await audio.arrayBuffer(),
      sceneId,
      typeof transcript === "string" ? transcript : undefined,
    ),
  );
});
