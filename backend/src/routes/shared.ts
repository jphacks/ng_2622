import { createMiddleware } from "hono/factory";
import { resolver } from "hono-openapi";
import type { z } from "zod";
import type { ErrorCode } from "../schemas/common";
import type { ScoringEnv } from "../scoring";

// secrets（API キー）と /dev 用の値は wrangler.jsonc に無いので、CloudflareBindings に足す
export type AppEnv = {
  Bindings: CloudflareBindings & ScoringEnv & { ENABLE_DEV_ROUTES?: string };
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
