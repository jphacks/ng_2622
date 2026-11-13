import { Hono } from "hono";
import { ensureParts, type PartOrder } from "../parts/workshop";
import { score } from "../scoring";
import type { AppEnv } from "./shared";

// 部屋なしで採点だけを試す（transcript を付けると、端末で文字起こしした発話として扱う）。
// ENABLE_DEV_ROUTES=true（手元の .dev.vars）のときだけ開き、OpenAPI には載せない
export const devRoutes = new Hono<AppEnv>()
  .post("/dev/score", async (c) => {
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
  })
  // 部品をその場で作るのを試す（ensureParts を直に呼ぶ）。本文は { orders: PartOrder[], maxNew?: number }。
  // 作った部品は手元の R2（.wrangler/state）に置かれ、GET /parts/{id}/{version}.usdz で取れる
  .post("/dev/parts", async (c) => {
    if (c.env.ENABLE_DEV_ROUTES !== "true") return c.notFound();
    const body = await c.req.json<{ orders?: PartOrder[]; maxNew?: number }>();
    if (!Array.isArray(body.orders)) {
      return c.json({ error: "orders（PartOrder の配列）が要る" }, 400);
    }
    return c.json(
      await ensureParts(c.env, body.orders, { maxNew: body.maxNew ?? 4 }),
    );
  });
