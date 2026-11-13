// 苦手の分析の回数を数える Durable Object（src/durable-objects/usageCounter.ts）のテスト
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { openCounter } from "./helpers/usage-counter-harness";

const HOUR = 60 * 60 * 1000;
// 2026-11-15 10:20（日本時間）= 01:20（UTC）
const START = Date.UTC(2026, 10, 15, 1, 20);
const limits = { perHour: 3, daily: 5 };

const clockAt = (start = START) => {
  const clock = { now: start };
  return { clock, read: () => clock.now };
};

test("IP ごとに 1 時間の回数を数え、上限を超えたら断る。ほかの IP は数えない", async () => {
  const { read } = clockAt();
  const { counter } = await openCounter(read);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await counter.take("203.0.113.7", limits), { ok: true });
  }
  assert.deepEqual(await counter.take("203.0.113.7", limits), {
    ok: false,
    reason: "ip_hourly",
  });
  assert.deepEqual(await counter.take("198.51.100.2", limits), { ok: true });
});

test("全体の 1 日の回数を数え、断った呼び出しは数えない", async () => {
  const { read } = clockAt();
  const { counter } = await openCounter(read);
  // 同じ IP で上限を超えた分（断られた分）は全体に数えない
  for (let i = 0; i < 5; i++) await counter.take("203.0.113.7", limits);
  for (const ip of ["a", "b"]) {
    assert.deepEqual(await counter.take(ip, limits), { ok: true });
  }
  assert.deepEqual(await counter.take("c", limits), {
    ok: false,
    reason: "daily",
  });
  // 呼び直しの分（takeDaily）も上限で断る
  assert.equal(await counter.takeDaily(limits), false);
});

test("呼び直しの分は全体の 1 日の回数にだけ足す", async () => {
  const { read } = clockAt();
  const { counter } = await openCounter(read);
  assert.equal(await counter.takeDaily({ daily: 2 }), true);
  assert.equal(await counter.takeDaily({ daily: 2 }), true);
  assert.equal(await counter.takeDaily({ daily: 2 }), false);
  // IP の回数は増えていない
  assert.deepEqual(await counter.take("a", { perHour: 1, daily: 3 }), {
    ok: true,
  });
});

type Saved = {
  ips: Record<string, number>;
  daily: number;
  secret: string;
};

test("IP はそのまま覚えず、DO が日ごとに作る乱数を鍵にした HMAC で覚える", async () => {
  const { read } = clockAt();
  const { counter, storage } = await openCounter(read);
  await counter.take("203.0.113.7", limits);
  assert.ok(!JSON.stringify([...storage.values()]).includes("203.0.113.7"));
  const state = storage.get("weak-points") as Saved;
  assert.equal(state.secret.length, 64);
  const expected = createHmac("sha256", Buffer.from(state.secret, "hex"))
    .update("203.0.113.7")
    .digest("hex")
    .slice(0, 32);
  assert.deepEqual(Object.keys(state.ips), [expected]);
  // ただのハッシュではない
  const plain = createHash("sha256").update("203.0.113.7").digest("hex");
  assert.ok(!plain.startsWith(expected));
});

test("1 時間の区切りが過ぎたら IP の回数を消し（alarm）、日が変わったら鍵を捨てる", async () => {
  const { clock, read } = clockAt();
  const { counter, storage, alarm } = await openCounter(read);
  await counter.take("203.0.113.7", limits);
  // 区切りの終わり（02:00 UTC）に alarm を置く
  assert.equal(alarm.at, Date.UTC(2026, 10, 15, 2, 0));

  clock.now = alarm.at as number;
  await counter.alarm();
  let state = storage.get("weak-points") as Saved;
  assert.deepEqual(state.ips, {});
  // 日ごとの回数と、その日の鍵は残る。次は日本時間の 0 時（15:00 UTC）に鍵を捨てる
  assert.equal(state.daily, 1);
  assert.notEqual(state.secret, "");
  assert.equal(alarm.at, Date.UTC(2026, 10, 15, 15, 0));

  clock.now = alarm.at as number;
  await counter.alarm();
  state = storage.get("weak-points") as Saved;
  assert.equal(state.secret, "");
  assert.equal(state.daily, 0);
});

test("次の 1 時間には IP の回数を数え直す。日が変わると同じ IP でも覚える値が変わる", async () => {
  const { clock, read } = clockAt();
  const { counter, storage } = await openCounter(read);
  for (let i = 0; i < 3; i++) await counter.take("203.0.113.7", limits);
  const ids = () => Object.keys((storage.get("weak-points") as Saved).ips);
  const before = ids();
  clock.now += HOUR;
  assert.deepEqual(await counter.take("203.0.113.7", limits), { ok: true });
  assert.deepEqual(ids(), before);
  clock.now += 24 * HOUR;
  assert.deepEqual(await counter.take("203.0.113.7", limits), { ok: true });
  assert.equal(ids().length, 1);
  assert.notEqual(ids()[0], before[0]);
});

test("1 日の回数は日本時間の 0 時で数え直す", async () => {
  // 2026-11-15 23:50（日本時間）= 14:50（UTC）
  const { clock, read } = clockAt(Date.UTC(2026, 10, 15, 14, 50));
  const { counter } = await openCounter(read);
  const daily = { perHour: 100, daily: 1 };
  assert.deepEqual(await counter.take("a", daily), { ok: true });
  assert.deepEqual(await counter.take("b", daily), {
    ok: false,
    reason: "daily",
  });
  // 日本時間の 11/16 0:00 を過ぎた
  clock.now = Date.UTC(2026, 10, 15, 15, 0);
  assert.deepEqual(await counter.take("b", daily), { ok: true });
});

test("作り直しても（休止のあと）保存した回数から続ける", async () => {
  const { read } = clockAt();
  const first = await openCounter(read);
  for (let i = 0; i < 3; i++) await first.counter.take("203.0.113.7", limits);
  const again = await openCounter(read, first.storage);
  assert.deepEqual(await again.counter.take("203.0.113.7", limits), {
    ok: false,
    reason: "ip_hourly",
  });
});

test("同時に届いても、上限の数だけを通す（同じ IP・違う IP・takeDaily を混ぜる）", async () => {
  const { read } = clockAt();
  const sameIp = await openCounter(read);
  const same = await Promise.all(
    Array.from({ length: 20 }, () =>
      sameIp.counter.take("203.0.113.7", { perHour: 3, daily: 100 }),
    ),
  );
  assert.equal(same.filter((r) => r.ok).length, 3);

  const manyIps = await openCounter(read);
  const many = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      manyIps.counter.take(`198.51.100.${i}`, { perHour: 3, daily: 5 }),
    ),
  );
  assert.equal(many.filter((r) => r.ok).length, 5);
  assert.equal(
    (manyIps.storage.get("weak-points") as { daily: number }).daily,
    5,
  );

  const mixed = await openCounter(read);
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0
        ? mixed.counter
            .take(`192.0.2.${i}`, { perHour: 3, daily: 4 })
            .then((r) => r.ok)
        : mixed.counter.takeDaily({ daily: 4 }),
    ),
  );
  assert.equal(results.filter(Boolean).length, 4);
  assert.equal(
    (mixed.storage.get("weak-points") as { daily: number }).daily,
    4,
  );
});
