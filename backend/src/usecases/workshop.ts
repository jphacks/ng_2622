import { ensureParts, lookupPart, type PartsEnv } from "../parts/workshop";
import type { Workshop } from "../scenes/generate-v2";

/** 部品を作る口（backend/src/parts/workshop.ts）を、場面の生成が使う形にする */
export const workshopOf = (env: PartsEnv): Workshop => ({
  lookup: (id) => lookupPart(env, id),
  ensure: (orders, opts) => ensureParts(env, orders, opts),
});
