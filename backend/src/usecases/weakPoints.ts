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
const DEFAULTS = { perHour: 10, daily: 200, maxBodyBytes: 65_536 };

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
 * IP ごとの回数を数えるときの IP の形。IPv4 はそのまま、IPv6 は先頭の /64（1 つの回線や端末が持つ範囲）にまとめる。
 * IPv4 を埋め込んだ IPv6（::ffff:192.0.2.1）は IPv4 として数える。読めない値はそのまま使う
 */
export const rateKeyOf = (ip: string): string => {
  const raw = ip.trim().toLowerCase().split("%")[0];
  if (!raw.includes(":")) return raw;
  const mapped = raw.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  // 末尾の IPv4（::1.2.3.4 など）は 16 bit の 2 つに直す
  let text = raw;
  const v4 = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return raw;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array(Math.max(fill, 0)).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) {
    return raw;
  }
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(":")}::/64`;
};

/**
 * 回数の上限を数えてから分析する。ip は接続元の IP（CF-Connecting-IP）。usage が数える場所（UsageCounter）。
 * 分析が呼び直すときは、全体の 1 日の回数をもう 1 つ数え、上限なら呼び直さない。
 * 数える場所が失敗したら、初めの数え（take）は 503 にし（数えずに Claude を呼ばない）、
 * 呼び直しの前の数え（takeDaily）は「呼び直さない」として 1 回目の結果を返す
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
  let taken: Awaited<ReturnType<UsageCounterRepository["take"]>>;
  try {
    taken = await usage.take(rateKeyOf(ip), limits);
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "weak_points_counter_failed",
        step: "take",
        name: e instanceof Error ? e.name : "Error",
      }),
    );
    return {
      ok: false,
      code: "analysis_unavailable",
      status: 503,
      message: "苦手の分析の回数を数えられなかった",
    };
  }
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
      beforeRetry: async () => {
        try {
          return await usage.takeDaily(limits);
        } catch (e) {
          console.error(
            JSON.stringify({
              event: "weak_points_counter_failed",
              step: "takeDaily",
              name: e instanceof Error ? e.name : "Error",
            }),
          );
          return false;
        }
      },
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
