import type { z } from "zod";
import {
  type AnalysisEnv,
  AnalysisError,
  type AnalyzeDeps,
  analyzeWeakPoints,
  type WeakPointInput,
} from "../analysis/weakPoints";
import type { UsageLimits } from "../durable-objects/usageCounter";
import type { UsageCounterRepository } from "../repositories/usageCounterRepository";
import type { WeakPointResponse } from "../schemas/http";

// 苦手の分析の口（POST /weak-points）の中身。止めるスイッチ・回数の上限を見てから Claude を呼ぶ。
// 本文（記録の文字）は保存せず、ログにも出さない。ログに残すのは件数・落ちた理由・時間・トークンだけ

export type WeakPointEnv = AnalysisEnv & {
  // "on" のときだけ分析する。PR のプレビューは off（wrangler.jsonc の previews）
  WEAK_POINT_ANALYSIS?: string;
  // IP ごとの 1 時間の回数・全体の 1 日の回数（呼び直しも数える）・本文の大きさ（バイト）
  WEAK_POINT_IP_PER_HOUR?: string;
  WEAK_POINT_DAILY_LIMIT?: string;
  WEAK_POINT_MAX_BODY_BYTES?: string;
};

// vars が無い・読めないときの値（docs/design/weak-point-analysis.md の 8 の「普段」）
const DEFAULTS = { perHour: 10, daily: 200, maxBodyBytes: 204_800 };

const count = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 0
    ? n
    : fallback;
};

/** 止めるスイッチ。on のときだけ動かす（変数が無い・on 以外なら止める） */
export const weakPointsEnabled = (env: WeakPointEnv) =>
  env.WEAK_POINT_ANALYSIS === "on";

export const weakPointLimits = (
  env: WeakPointEnv,
): UsageLimits & { maxBodyBytes: number } => ({
  perHour: count(env.WEAK_POINT_IP_PER_HOUR, DEFAULTS.perHour),
  daily: count(env.WEAK_POINT_DAILY_LIMIT, DEFAULTS.daily),
  maxBodyBytes: count(env.WEAK_POINT_MAX_BODY_BYTES, DEFAULTS.maxBodyBytes),
});

export type WeakPointResult =
  | { ok: true; body: z.infer<typeof WeakPointResponse> }
  | {
      ok: false;
      code: "rate_limited" | "analysis_failed" | "analysis_unavailable";
      status: 429 | 502 | 503;
      message: string;
    };

/**
 * 回数の上限を数えてから分析する。ip は接続元の IP（CF-Connecting-IP）。usage が数える場所（UsageCounter）。
 * 分析が呼び直すときは、全体の 1 日の回数をもう 1 つ数え、上限なら呼び直さない
 */
export async function analyzeWithLimits(
  env: WeakPointEnv,
  usage: UsageCounterRepository,
  ip: string,
  input: WeakPointInput,
  deps: Pick<AnalyzeDeps, "create" | "now"> = {},
): Promise<WeakPointResult> {
  if (!env.CLAUDE_API_KEY && !deps.create) {
    return {
      ok: false,
      code: "analysis_unavailable",
      status: 503,
      message: "苦手の分析は止めてある（CLAUDE_API_KEY が無い）",
    };
  }
  const limits = weakPointLimits(env);
  const taken = await usage.take(ip, limits);
  if (!taken.ok) {
    console.log(
      JSON.stringify({ event: "weak_points_limited", reason: taken.reason }),
    );
    return {
      ok: false,
      code: "rate_limited",
      status: 429,
      message:
        taken.reason === "ip_hourly"
          ? "苦手の分析の回数が、この 1 時間の上限に達した"
          : "苦手の分析の回数が、今日の上限に達した",
    };
  }
  try {
    const outcome = await analyzeWeakPoints(env, input, {
      ...deps,
      beforeRetry: () => usage.takeDaily(limits),
    });
    const { habits, improvement, nextTry } = outcome.analysis;
    console.log(
      JSON.stringify({
        event: "weak_points_analyzed",
        model: outcome.model,
        rounds: input.rounds.length,
        habits: habits.length,
        improvement: improvement !== null,
        nextTry: nextTry !== null,
        retries: outcome.retries,
        retrySkipped: outcome.retrySkipped ?? null,
        attempts: outcome.attempts.map((a) => ({
          ...a.stats,
          elapsedMs: a.elapsedMs,
          usage: a.usage,
        })),
        elapsedMs: outcome.elapsedMs,
      }),
    );
    return {
      ok: true,
      body: { habits, improvement, nextTry, retries: outcome.retries },
    };
  } catch (e) {
    if (!(e instanceof AnalysisError)) throw e;
    console.error(
      JSON.stringify({ event: "weak_points_failed", message: e.message }),
    );
    return {
      ok: false,
      code: "analysis_failed",
      status: 502,
      message: `分析できませんでした: ${e.message}`,
    };
  }
}
