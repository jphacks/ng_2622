import Anthropic from "@anthropic-ai/sdk";
import { ensureParts, lookupPart, type PartsEnv } from "../parts/workshop";
import { costOf } from "../parts/write";
import type { CreateMessage } from "../scenes/generate";
import type { Workshop } from "../scenes/generate-v2";

/**
 * 部品を作る口（backend/src/parts/workshop.ts）を、場面の生成が使う形にする。
 * 部品を作る Claude の呼び出しを数え、作れなかった部品の分も含めた費用（usd）を返す
 *（Claude の呼び方は部品を作る口の既定と同じ。SDK の再送はしない）
 */
export const workshopOf = (env: PartsEnv): Workshop => {
  const client = env.CLAUDE_API_KEY
    ? new Anthropic({ apiKey: env.CLAUDE_API_KEY, maxRetries: 0 })
    : undefined;
  return {
    lookup: (id) => lookupPart(env, id),
    ensure: async (orders, opts) => {
      let usd = 0;
      const create: CreateMessage | undefined = client
        ? async (params, options) => {
            const response = await client.messages.create(params, options);
            usd += costOf(response.usage);
            return response;
          }
        : undefined;
      const result = await ensureParts(env, orders, {
        ...opts,
        ...(create ? { deps: { create } } : {}),
      });
      return { ...result, usd };
    },
  };
};
