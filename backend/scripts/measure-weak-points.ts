// 苦手の分析（src/analysis/weakPoints.ts の analyzeWeakPoints）を、癖を仕込んだ記録の組で何度も回し、
// 仕込んだ癖を当てられるか・引用の確かめの通過率・ぶれ・時間・費用を測る（docs/design/weak-point-analysis.md の 10）。
// 記録の組は scripts/make-weak-point-fixtures.ts が作った test/fixtures/weak-points/person-*.json。本番と同じ確かめ
// （verify.ts）と呼び直し・25 秒の締め切りを通す。回数の上限（UsageCounter）は通さない。Claude を実際に呼ぶので費用がかかる
// （1 回約 0.05 USD。3 組 × 5 回で約 0.75 USD）。上限に達したらそこで止める。
//   CLAUDE_API_KEY=... pnpm tsx scripts/measure-weak-points.ts <結果の JSON> [1 組あたりの回数（既定 5）] [費用の上限ドル（既定 2）]
// 合格の目安（案）: 仕込んだ癖に当たる回が 5 回中 4 回以上、確かめる前の実例の引用が見つかった割合 95% 以上、
// 数字の確かめに当たる件数 0、時間の第 3 四分位数 15 秒以内。合格しなければ終了コード 1
import { readdir, readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import {
  type AnalysisOutcome,
  analyzeWeakPoints,
  type CreateMessage,
  type WeakPointInput,
} from "../src/analysis/weakPoints";

// 100 万トークンあたりのドル（Sonnet 5.5）
const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 };
// wrangler.jsonc の本番と同じ（既定の Sonnet 5.5 の low）
const env = { CLAUDE_API_KEY: process.env.CLAUDE_API_KEY };

type Planted = {
  key: string;
  label: string;
  viewpoint: string;
  pattern: string;
  rounds: number[];
};
type Fixture = {
  id: string;
  label: string;
  planted: Planted[];
  improvement: { label: string; pattern: string } | null;
  oneOff?: { label: string; pattern: string; rounds: number[] };
  injection?: { label: string; pattern: string };
  request: WeakPointInput;
};

const [out, runsArg, capArg] = process.argv.slice(2);
if (!out || !process.env.CLAUDE_API_KEY) {
  console.error(
    "使い方: CLAUDE_API_KEY=... pnpm tsx scripts/measure-weak-points.ts <結果の JSON> [1 組あたりの回数] [費用の上限ドル]",
  );
  process.exit(2);
}
const runs = Number(runsArg ?? 5);
const cap = Number(capArg ?? 2);

const dir = new URL("../test/fixtures/weak-points/", import.meta.url);
const files = (await readdir(dir))
  .filter((f) => /^person-\d+\.json$/.test(f))
  .sort();
const fixtures = await Promise.all(
  files.map(
    async (f) => JSON.parse(await readFile(new URL(f, dir), "utf8")) as Fixture,
  ),
);
if (fixtures.length === 0) {
  console.error(
    "記録の組が無い（先に scripts/make-weak-point-fixtures.ts を回す）",
  );
  process.exit(2);
}

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
  maxRetries: 0,
});
const create: CreateMessage = (params, options) =>
  client.messages.create(params, options);

const costOf = (o: AnalysisOutcome) =>
  o.attempts.reduce(
    (sum, a) =>
      sum +
      (a.usage.input * PRICE.input +
        a.usage.cacheWrite * PRICE.cacheWrite +
        a.usage.cacheRead * PRICE.cacheRead +
        a.usage.output * PRICE.output) /
        1e6,
    0,
  );

const q3 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const pos = (s.length - 1) * 0.75;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
};

type Run = {
  fixture: string;
  run: number;
  ok: boolean;
  error?: string;
  elapsedMs: number;
  usd: number;
  outcome?: AnalysisOutcome;
};

const results: Run[] = [];
let usd = 0;
let stopped = false;
for (const fixture of fixtures) {
  for (let run = 1; run <= runs; run++) {
    if (usd >= cap) {
      stopped = true;
      break;
    }
    const started = Date.now();
    try {
      const outcome = await analyzeWeakPoints(env, fixture.request, { create });
      const cost = costOf(outcome);
      usd += cost;
      results.push({
        fixture: fixture.id,
        run,
        ok: true,
        elapsedMs: outcome.elapsedMs,
        usd: cost,
        outcome,
      });
      console.log(
        `${fixture.id} ${run} 回目: 癖 ${outcome.analysis.habits.length}（確かめる前 ${outcome.attempts[0].stats.habits}）・呼び直し ${outcome.retries}・${(outcome.elapsedMs / 1000).toFixed(1)} 秒・${cost.toFixed(3)} USD`,
      );
    } catch (e) {
      // 失敗した回の費用は分からないので、多めに 0.05 USD と数える
      usd += 0.05;
      const error = e instanceof Error ? e.message : String(e);
      results.push({
        fixture: fixture.id,
        run,
        ok: false,
        error,
        elapsedMs: Date.now() - started,
        usd: 0.05,
      });
      console.log(`${fixture.id} ${run} 回目: 失敗 ${error}`);
    }
  }
  if (stopped) break;
}

const textOf = (h: { title?: string; what?: string; fix?: string }) =>
  `${h.title ?? ""} ${h.what ?? ""} ${h.fix ?? ""}`;
const matches = (pattern: string, text: string) =>
  new RegExp(pattern, "i").test(text);

const rows = fixtures.map((fixture) => {
  const mine = results.filter((r) => r.fixture === fixture.id);
  const done = mine.filter((r) => r.ok && r.outcome) as (Run & {
    outcome: AnalysisOutcome;
  })[];
  const attempts = done.flatMap((r) => r.outcome.attempts);
  const sum = (f: (a: (typeof attempts)[number]) => number) =>
    attempts.reduce((s, a) => s + f(a), 0);
  const planted = fixture.planted.map((p) => ({
    key: p.key,
    label: p.label,
    // 画面に出る（確かめを通った）癖で当たった回の数
    hits: done.filter((r) =>
      r.outcome.analysis.habits.some((h) => matches(p.pattern, textOf(h))),
    ).length,
    // 確かめる前の癖で当たった回の数（1 回目の応答）
    rawHits: done.filter((r) =>
      (r.outcome.attempts[0].raw.habits ?? []).some((h) =>
        matches(p.pattern, textOf(h)),
      ),
    ).length,
  }));
  const improvements = done.map((r) => r.outcome.analysis.improvement);
  const improvementHits = fixture.improvement
    ? improvements.filter(
        (i) =>
          i &&
          matches((fixture.improvement as { pattern: string }).pattern, i.text),
      ).length
    : null;
  const rawImprovements = attempts.filter((a) => a.raw.improvement).length;
  const keptImprovements = attempts.filter(
    (a) => a.stats.improvement === "kept",
  ).length;
  const oneOffHits = fixture.oneOff
    ? done.filter((r) =>
        r.outcome.analysis.habits.some((h) =>
          matches((fixture.oneOff as { pattern: string }).pattern, textOf(h)),
        ),
      ).length
    : null;
  const injectionHits = fixture.injection
    ? done.filter((r) =>
        matches(
          (fixture.injection as { pattern: string }).pattern,
          JSON.stringify(r.outcome.analysis),
        ),
      ).length
    : null;
  const numberHits = sum(
    (a) =>
      a.stats.dropped.number +
      (a.stats.improvement === "number" ? 1 : 0) +
      (a.stats.nextTry === "number" ? 1 : 0),
  );
  const viewpoints = { content: 0, expression: 0 };
  for (const r of done)
    for (const h of r.outcome.analysis.habits) viewpoints[h.viewpoint]++;
  return {
    fixture: fixture.id,
    label: fixture.label,
    runs: mine.length,
    failed: mine.length - done.length,
    planted,
    examples: {
      total: sum((a) => a.stats.examples.total),
      found: sum((a) => a.stats.examples.found),
    },
    habitsBefore: sum((a) => a.stats.habits),
    habitsDroppedByQuote: sum((a) => a.stats.dropped.quote),
    habitsDropped: sum((a) =>
      Object.values(a.stats.dropped).reduce((x, y) => x + y, 0),
    ),
    habitsAfter: done.reduce((s, r) => s + r.outcome.analysis.habits.length, 0),
    habitCounts: done.map((r) => r.outcome.analysis.habits.length),
    viewpoints,
    improvement: {
      raw: rawImprovements,
      kept: keptImprovements,
      shown: improvements.filter(Boolean).length,
      hits: improvementHits,
      statuses: attempts.map((a) => a.stats.improvement),
      // 人が読んで根拠のある内容かを確かめる（とくに良くなった点を仕込まない組）
      texts: improvements.filter(Boolean),
    },
    nextTryShown: done.filter((r) => r.outcome.analysis.nextTry).length,
    numberHits,
    retries: done.reduce((s, r) => s + r.outcome.retries, 0),
    retrySkipped: done.map((r) => r.outcome.retrySkipped).filter(Boolean),
    oneOffHits,
    injectionHits,
    elapsedMs: done.map((r) => r.elapsedMs),
    q3Ms: q3(done.map((r) => r.elapsedMs)),
    tokens: {
      input: sum((a) => a.usage.input),
      output: sum((a) => a.usage.output),
      cacheRead: sum((a) => a.usage.cacheRead),
    },
    usd: mine.reduce((s, r) => s + r.usd, 0),
  };
});

const pct = (a: number, b: number) =>
  b === 0 ? "—" : `${((100 * a) / b).toFixed(0)}%`;
console.log(
  "\n| 組 | 回 | 失敗 | 仕込んだ癖に当たった回（確かめの後 / 前） | 実例の引用が見つかった | 2 回以上で落ちた癖 | 癖（前 → 後） | 良くなった点（出た / 当たった） | 数字 | 呼び直し | 1 回だけの誤り・指示の文 | 時間 Q3 | 費用 |",
);
console.log(
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
);
for (const r of rows) {
  const planted = r.planted
    .map((p) => `${p.label} ${p.hits}/${r.runs - r.failed}（前 ${p.rawHits}）`)
    .join("、");
  const improvement = `${r.improvement.shown}${r.improvement.hits === null ? "（仕込まない）" : ` / ${r.improvement.hits}`}`;
  const extra =
    [
      r.oneOffHits === null ? null : `1 回だけ ${r.oneOffHits}`,
      r.injectionHits === null ? null : `指示 ${r.injectionHits}`,
    ]
      .filter(Boolean)
      .join("・") || "—";
  console.log(
    `| ${r.fixture} | ${r.runs} | ${r.failed} | ${planted} | ${r.examples.found}/${r.examples.total}（${pct(r.examples.found, r.examples.total)}） | ${r.habitsDroppedByQuote}/${r.habitsBefore} | ${r.habitsBefore} → ${r.habitsAfter}（${r.habitCounts.join("・")}） | ${improvement} | ${r.numberHits} | ${r.retries} | ${extra} | ${(r.q3Ms / 1000).toFixed(1)} 秒 | ${r.usd.toFixed(3)} USD |`,
  );
}

const allExamples = rows.reduce(
  (s, r) => ({
    total: s.total + r.examples.total,
    found: s.found + r.examples.found,
  }),
  {
    total: 0,
    found: 0,
  },
);
const allElapsed = rows.flatMap((r) => r.elapsedMs);
const checks = {
  plantedHits: rows.every((r) =>
    r.planted.every((p) => p.hits >= Math.ceil(((r.runs - r.failed) * 4) / 5)),
  ),
  quoteFound:
    allExamples.total > 0 && allExamples.found / allExamples.total >= 0.95,
  numberHits: rows.every((r) => r.numberHits === 0),
  q3: q3(allElapsed) <= 15_000,
  noFailures: rows.every((r) => r.failed === 0),
  complete: !stopped,
};
const passed = Object.values(checks).every(Boolean);
console.log(
  `\n全体: 実例の引用 ${pct(allExamples.found, allExamples.total)}・時間 Q3 ${(q3(allElapsed) / 1000).toFixed(1)} 秒・費用 ${usd.toFixed(3)} USD${stopped ? `（上限 ${cap} USD で止めた）` : ""}`,
);
console.log(`${passed ? "合格" : "不合格"}: ${JSON.stringify(checks)}`);

await writeFile(
  out,
  `${JSON.stringify({ runs, cap, usd, checks, passed, rows, results }, null, 2)}\n`,
);
console.log(`結果を ${out} に書いた`);
process.exit(passed ? 0 : 1);
