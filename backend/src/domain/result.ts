import type { z } from "zod";
import type { ErrorCode } from "../schemas/common";

// ---------- 型 ----------

export type RoomError = { code: z.infer<typeof ErrorCode>; message: string };

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: RoomError };

// ---------- ドメインルール ----------

/** 成功と失敗（エラーコードと理由）を返すための補助 */
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (code: RoomError["code"], message: string) =>
  ({ ok: false, error: { code, message } }) as const;
