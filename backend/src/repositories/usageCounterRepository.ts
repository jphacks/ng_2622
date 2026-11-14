import type { TakeResult, UsageLimits } from "../durable-objects/usageCounter";

/**
 * 全体で 1 つの UsageCounter（Durable Object）。instance ごとに別に数える:
 * global は苦手の分析（POST /weak-points）、weak-scenes は苦手の場面（POST /weak-scenes）
 */
export const createUsageCounterRepository = (
  counter: CloudflareBindings["USAGE_COUNTER"],
  instance: "global" | "weak-scenes" = "global",
): UsageCounterRepository => ({
  take: (ip, limits) => counter.getByName(instance).take(ip, limits),
  takeDaily: (limits) => counter.getByName(instance).takeDaily(limits),
});

export type UsageCounterRepository = {
  take: (ip: string, limits: UsageLimits) => Promise<TakeResult>;
  takeDaily: (limits: Pick<UsageLimits, "daily">) => Promise<boolean>;
};
