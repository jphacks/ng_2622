// 部屋がスタートで場面を作るときと同じ呼び方（Sonnet 5.5・effort low・1 回だけ・10 秒まで）で場面を何度も作り、
// 1 回の時間と費用を測る。README の「費用」の数字はこれで出す。Claude を実際に呼ぶので費用がかかる。
//   CLAUDE_API_KEY=... pnpm tsx scripts/measure-scene-generation.ts [1 難易度あたりの回数（既定 20）] [結果の JSON の書き出し先]
// 料金は 100 万トークンあたりのドル（Sonnet 5.5。キャッシュの書き込みは 5 分の TTL で入力の 1.25 倍）。
import { writeFile } from "node:fs/promises";
import { type GenerateInput, generatePlan } from "../src/scenes/generate";
import { PARTS } from "../src/scenes/parts";

const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 };
// 部屋での生成と同じ（backend/src/durable-objects/room.ts の GENERATION_TIMEOUT_MS と maxAttempts）
const ROOM_TIMEOUT_MS = 10_000;
const DIFFICULTIES: GenerateInput["difficulty"][] = ["easy", "normal", "hard"];

type Run = {
  difficulty: string;
  index: number;
  ok: boolean;
  error?: string;
  ms: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  usd: number;
};

const n = Number(process.argv[2] ?? 20);
const out = process.argv[3];
const env = { CLAUDE_API_KEY: process.env.CLAUDE_API_KEY };
const runs: Run[] = [];

for (const difficulty of DIFFICULTIES) {
  for (let index = 0; index < n; index++) {
    const start = performance.now();
    try {
      const result = await generatePlan(
        env,
        PARTS,
        { difficulty },
        {},
        { timeoutMs: ROOM_TIMEOUT_MS, maxAttempts: 1 },
      );
      const u = result.usage[0];
      const t = {
        input: u.input_tokens,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens,
      };
      const usd =
        (t.input * PRICE.input +
          t.cacheWrite * PRICE.cacheWrite +
          t.cacheRead * PRICE.cacheRead +
          t.output * PRICE.output) /
        1e6;
      runs.push({
        difficulty,
        index,
        ok: true,
        ms: performance.now() - start,
        ...t,
        usd,
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      runs.push({
        difficulty,
        index,
        ok: false,
        error,
        ms: performance.now() - start,
        input: 0,
        cacheWrite: 0,
        cacheRead: 0,
        output: 0,
        usd: 0,
      });
    }
    const r = runs[runs.length - 1];
    console.error(
      `${difficulty} ${index + 1}/${n} ${r.ok ? "ok" : `失敗 ${r.error}`} ${(r.ms / 1000).toFixed(1)} 秒 $${r.usd.toFixed(4)}`,
    );
  }
}

if (out) await writeFile(out, `${JSON.stringify(runs, null, 2)}\n`);
console.log(JSON.stringify(runs));
