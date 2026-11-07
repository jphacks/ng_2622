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
      // GET /records の合言葉（Authorization: Bearer <合言葉>）。無ければ誰も読めない
      RECORDS_TOKEN?: string;
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

const encoder = new TextEncoder();

/** Authorization: Bearer <token> か。合言葉が設定されていなければ通さない */
export const hasBearerToken = (
  header: string | undefined,
  token: string | undefined,
) => {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = encoder.encode(header.slice("Bearer ".length));
  const b = encoder.encode(token);
  if (a.byteLength !== b.byteLength) return false;
  // 比べる時間が中身で変わらないよう、全部のバイトを見る（Workers の timingSafeEqual は Node のテストに無い）
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

/** ENABLE_DEV_ROUTES=true（pnpm dev が付ける）のときだけ通す。本番とプレビューでは 404 */
export const devOnly = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.ENABLE_DEV_ROUTES !== "true") return c.notFound();
  await next();
});
