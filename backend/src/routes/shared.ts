import { createMiddleware } from "hono/factory";
import { resolver } from "hono-openapi";
import type { z } from "zod";
import type { ErrorCode } from "../schemas/common";
import type { ScoringEnv } from "../scoring";

// secrets（API キー）と /dev 用の値は wrangler.jsonc に無いので、CloudflareBindings に足す
export type AppEnv = {
  Bindings: CloudflareBindings &
    ScoringEnv & {
      ENABLE_DEV_ROUTES?: string;
      // POST /scenes/generate の合言葉（Authorization: Bearer <合言葉>）
      SCENE_WRITE_TOKEN?: string;
      // POST /scenes/generate のモデルと effort（既定 claude-sonnet-5-5 の low）
      CLAUDE_SCENE_MODEL?: string;
      CLAUDE_SCENE_EFFORT?: string;
    };
};

export const jsonContent = (schema: Parameters<typeof resolver>[0]) => ({
  "application/json": { schema: resolver(schema) },
});

export const errorBody = (
  code: z.infer<typeof ErrorCode>,
  message: string,
) => ({
  error: { code, message },
});

/** ENABLE_DEV_ROUTES=true（pnpm dev が付ける）のときだけ通す。本番とプレビューでは 404 */
export const devOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.ENABLE_DEV_ROUTES !== "true") return c.notFound();
  await next();
});
