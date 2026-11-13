import type { TakeResult, UsageLimits } from "../durable-objects/usageCounter";

const INSTANCE = "global";

/** 全体で 1 つの UsageCounter（Durable Object）。苦手の分析の回数を数える */
export const createUsageCounterRepository = (
  counter: CloudflareBindings["USAGE_COUNTER"],
): UsageCounterRepository => ({
  take: (ip, limits) => counter.getByName(INSTANCE).take(ip, limits),
  takeDaily: (limits) => counter.getByName(INSTANCE).takeDaily(limits),
});

export type UsageCounterRepository = {
  take: (ip: string, limits: UsageLimits) => Promise<TakeResult>;
  takeDaily: (limits: Pick<UsageLimits, "daily">) => Promise<boolean>;
};
