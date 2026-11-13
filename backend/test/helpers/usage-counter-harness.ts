// 回数を数える Durable Object（src/durable-objects/usageCounter.ts）を Node で動かす。保存領域は Map でまねる
import "./workers-hooks";

const { UsageCounter } = await import("../../src/durable-objects/usageCounter");

export { UsageCounter };

/** DO の ctx のまね。blockConcurrencyWhile は待ってから返す（作った直後に呼べるよう、openCounter で待つ） */
export const fakeCounterContext = (storage = new Map<string, unknown>()) => {
  const alarm = { at: null as number | null };
  const pending: Promise<unknown>[] = [];
  const ctx = {
    storage: {
      get: async (key: string) => structuredClone(storage.get(key)),
      put: async (key: string, value: unknown) => {
        storage.set(key, structuredClone(value));
      },
      setAlarm: async (at: number) => {
        alarm.at = at;
      },
    },
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => {
      const p = fn();
      pending.push(p);
      return p;
    },
  };
  return { ctx, storage, alarm, pending };
};

/** 数える DO を作る。clock で時刻を決める。同じ storage を渡すと作り直し（休止のまね）になる */
export const openCounter = async (
  clock: () => number,
  storage = new Map<string, unknown>(),
) => {
  const fake = fakeCounterContext(storage);
  // biome-ignore lint/suspicious/noExplicitAny: テストのまねなので型を合わせない
  const counter = new UsageCounter(fake.ctx as any, {} as any);
  counter.clock = clock;
  await Promise.all(fake.pending);
  return { counter, ...fake };
};
