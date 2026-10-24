import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppEnv } from "./shared";

export const healthRoutes = new Hono<AppEnv>().get(
  "/health",
  describeRoute({
    operationId: "getHealth",
    tags: ["system"],
    summary: "動いているかの確認",
    responses: {
      200: {
        description: "ok",
        content: { "text/plain": { schema: { type: "string" } } },
      },
    },
  }),
  (c) => c.text("ok"),
);
