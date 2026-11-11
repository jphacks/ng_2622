// 英文を先に書く 2 段の場面の生成（src/scenes/generate-v2.ts）を級ごとに何度も動かし、
// 各回の時間（1 回目・2 回目・合計）と裏取りの結果を記録して、級ごとの第 3 四分位数を出す。
// 部屋での生成の上限（10 秒）に収まるかを見るためのもの。Claude を実際に呼ぶので費用がかかる。
//   CLAUDE_API_KEY=... pnpm tsx scripts/measure-scene-generation-v2.ts [1 級あたりの回数（既定 20）] [結果の JSON の書き出し先]
// 各段は 1 回だけ呼び（やり直さない）、裏取りで落ちても作り直さない（部屋での生成と同じ条件）。
// 失敗した回は、理由と種類、形が違う応答なら Claude の生の本文の先頭を JSON に残す。
// 時間の分布を見るため、各段の timeout は 10 秒で切らず 60 秒にしてある。
// 料金は 100 万トークンあたりのドル（Sonnet 5.5。キャッシュの書き込みは 5 分の TTL で入力の 1.25 倍）。
import { writeFile } from "node:fs/promises";
import { composeLayoutV2 } from "../src/scenes/compose-v2";
import { SceneGenerationError, THEMES } from "../src/scenes/generate";
import { generateSceneV2, SceneResponseError } from "../src/scenes/generate-v2";
import { newSceneId } from "../src/scenes/id";
import { PARTS } from "../src/scenes/parts";
import { GRADE_IDS, type ScenePlanV2 } from "../src/scenes/types";

const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 };
// 部屋での生成の上限（backend/src/durable-objects/room.ts の GENERATION_TIMEOUT_MS）
const ROOM_LIMIT_MS = 10_000;
const STAGE_TIMEOUT_MS = 60_000;

type Run = {
  grade: string;
  index: number;
  theme: string;
  /** Claude が 2 段とも答えたか（裏取りの結果は problems） */
  ok: boolean;
  /** 失敗した理由と種類（refused・invalid・unavailable） */
  error?: string;
  errorKind?: string;
  /** 形が違う・JSON でない応答のときの、Claude の生の本文の先頭（500 文字） */
  raw?: string;
  /** 裏取りで落ちた理由。空なら通った */
  problems: string[];
  /** 座標に直せたか（composeLayoutV2 が例外を投げなかったか） */
  composed: boolean;
  sentencesMs: number;
  itemsMs: number;
  totalMs: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  usd: number;
  plan?: ScenePlanV2;
};

/** 分位数（間を直線でつなぐ）。q = 0.75 が第 3 四分位数 */
const quantile = (values: number[], q: number) => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
};
const sec = (ms: number) => (ms / 1000).toFixed(2);

const n = Number(process.argv[2] ?? 20);
const out = process.argv[3];
const env = {
  CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
  CLAUDE_SCENE_MODEL: process.env.CLAUDE_SCENE_MODEL,
  CLAUDE_SCENE_EFFORT: process.env.CLAUDE_SCENE_EFFORT,
};
const runs: Run[] = [];

for (const grade of GRADE_IDS) {
  for (let index = 0; index < n; index++) {
    // テーマは一覧を順に回す（どの級も同じ並び）
    const theme = THEMES[index % THEMES.length];
    const start = performance.now();
    const run: Run = {
      grade,
      index,
      theme,
      ok: false,
      problems: [],
      composed: false,
      sentencesMs: 0,
      itemsMs: 0,
      totalMs: 0,
      input: 0,
      cacheWrite: 0,
      cacheRead: 0,
      output: 0,
      usd: 0,
    };
    try {
      const result = await generateSceneV2(
        env,
        PARTS,
        { grade, theme },
        {},
        { timeoutMs: STAGE_TIMEOUT_MS, maxAttempts: 1 },
      );
      run.ok = true;
      run.problems = result.problems.map((p) => p.message);
      run.sentencesMs = result.ms.sentences;
      run.itemsMs = result.ms.items;
      run.totalMs = result.ms.total;
      for (const u of result.usage) {
        run.input += u.input_tokens;
        run.cacheWrite += u.cache_creation_input_tokens ?? 0;
        run.cacheRead += u.cache_read_input_tokens ?? 0;
        run.output += u.output_tokens;
      }
      run.usd =
        (run.input * PRICE.input +
          run.cacheWrite * PRICE.cacheWrite +
          run.cacheRead * PRICE.cacheRead +
          run.output * PRICE.output) /
        1e6;
      run.plan = result.plan;
      try {
        composeLayoutV2(result.plan, PARTS, { id: newSceneId(), grade });
        run.composed = true;
      } catch (e) {
        run.problems.push(
          `座標に直せない: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } catch (e) {
      run.error = e instanceof Error ? e.message : String(e);
      if (e instanceof SceneGenerationError) run.errorKind = e.kind;
      if (e instanceof SceneResponseError) run.raw = e.raw;
      run.totalMs = performance.now() - start;
    }
    runs.push(run);
    const verdict = !run.ok
      ? `失敗 ${run.error}`
      : run.problems.length === 0
        ? "裏取り 通った"
        : `裏取り 落ちた（${run.problems.join(" / ")}）`;
    console.error(
      `${grade} ${index + 1}/${n} ${theme} 1 回目 ${sec(run.sentencesMs)} 秒 + 2 回目 ${sec(run.itemsMs)} 秒 = ${sec(run.totalMs)} 秒 $${run.usd.toFixed(4)} ${verdict}`,
    );
  }
}

// 級ごとのまとめ。時間は Claude が 2 段とも答えた回だけで出す
const summary = GRADE_IDS.map((grade) => {
  const all = runs.filter((r) => r.grade === grade);
  const done = all.filter((r) => r.ok);
  const q = (pick: (r: Run) => number, at: number) =>
    Math.round(quantile(done.map(pick), at));
  return {
    grade,
    runs: all.length,
    failed: all.length - done.length,
    verified: done.filter((r) => r.problems.length === 0).length,
    rejected: done.filter((r) => r.problems.length > 0).length,
    overLimit: done.filter((r) => r.totalMs > ROOM_LIMIT_MS).length,
    sentencesMs: {
      median: q((r) => r.sentencesMs, 0.5),
      q3: q((r) => r.sentencesMs, 0.75),
    },
    itemsMs: {
      median: q((r) => r.itemsMs, 0.5),
      q3: q((r) => r.itemsMs, 0.75),
    },
    totalMs: {
      median: q((r) => r.totalMs, 0.5),
      q3: q((r) => r.totalMs, 0.75),
      max: Math.round(Math.max(...done.map((r) => r.totalMs))),
    },
    usdPerRun: done.reduce((a, r) => a + r.usd, 0) / (done.length || 1),
  };
});

console.error(
  "\n| 級 | 回数 | 失敗 | 裏取りを通った | 落ちた | 1 回目の Q3 | 2 回目の Q3 | 合計の中央値 | 合計の Q3 | 最大 | 10 秒を超えた |",
);
console.error(
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
);
for (const s of summary) {
  console.error(
    `| ${s.grade} | ${s.runs} | ${s.failed} | ${s.verified} | ${s.rejected} | ${sec(s.sentencesMs.q3)} 秒 | ${sec(s.itemsMs.q3)} 秒 | ${sec(s.totalMs.median)} 秒 | ${sec(s.totalMs.q3)} 秒 | ${sec(s.totalMs.max)} 秒 | ${s.overLimit} |`,
  );
}
for (const s of summary) {
  if (s.totalMs.q3 > ROOM_LIMIT_MS) {
    console.error(
      `${s.grade}: 合計の第 3 四分位数が 10 秒を超えている（部屋での生成を動かす前に扱いを決める）`,
    );
  }
}

const result = { summary, runs };
if (out) await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
