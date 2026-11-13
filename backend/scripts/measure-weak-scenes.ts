// 苦手の場面（src/usecases/weakScenes.ts の makeWeakScene）を、本物の Claude と部品を作る口（ensureParts）で 1 回ずつ作り、
// 時間・費用・作った部品を測る。続けて、その回の Claude の応答を記録したものを渡して同じ生成をもう一度（2 回）なぞり、
// 1 回の要求の中で使う CPU（裏取り・座標の計算・部品の組み立て・JSON の読み書き。Claude を待つ時間は入らない）を測る
// （WeakSceneMaker の Durable Object の CPU の上限と比べるため）。R2 はメモリの偽物（本番の置き場に書かない）。
// 上限（UsageCounter）は通さない。Claude を実際に呼ぶので費用がかかる（1 回約 0.07〜0.3 USD）。上限に達したらそこで止める。
//   CLAUDE_API_KEY=... pnpm tsx scripts/measure-weak-scenes.ts <結果の JSON> [場面の数（既定 3）] [費用の上限ドル（既定 2）]
import { writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { ensureParts, lookupPart } from "../src/parts/workshop";
import { costOf } from "../src/parts/write";
import type { WeakSceneRecord } from "../src/repositories/weakSceneRepository";
import type { CreateMessage } from "../src/scenes/generate";
import type { Workshop } from "../src/scenes/generate-v2";
import { WeakSceneRequest } from "../src/schemas/http";
import {
  makeWeakScene,
  type WeakSceneInput,
  type WeakSceneOutcome,
} from "../src/usecases/weakScenes";

const [out, countArg, capArg] = process.argv.slice(2);
if (!out || !process.env.CLAUDE_API_KEY) {
  console.error(
    "使い方: CLAUDE_API_KEY=... pnpm tsx scripts/measure-weak-scenes.ts <結果の JSON> [場面の数] [費用の上限ドル]",
  );
  process.exit(2);
}
const count = Number(countArg ?? 3);
const cap = Number(capArg ?? 2);
const env = { CLAUDE_API_KEY: process.env.CLAUDE_API_KEY };

// 級ごとに 1 つずつ（苦手の種類・癖を変える）
const CASES: WeakSceneInput[] = [
  {
    difficulty: "eiken-3",
    kinds: ["detail", "center"],
    habits: [
      {
        viewpoint: "expression",
        title: "場所の前置詞が抜ける",
        fix: "on・under・next to で場所を言う。例: The cat is under the table.",
      },
    ],
  },
  {
    difficulty: "eiken-pre2",
    kinds: ["link", "reason", "detail"],
    habits: [
      {
        viewpoint: "content",
        title: "理由をつけずに終わる",
        fix: "because で理由を足す。例: He is running because it is raining.",
      },
    ],
    nextTry: {
      viewpoint: "content",
      text: "見えている原因を because で 1 つ足してみよう。",
    },
  },
  {
    difficulty: "eiken-2",
    kinds: ["link", "center"],
    habits: [
      {
        viewpoint: "content",
        title: "目的を言わない",
        fix: "to + 動詞で目的を足す。例: She is running to catch the bus.",
      },
    ],
  },
].map((c) => WeakSceneRequest.parse(c));

/** メモリの R2（部品の置き場の get・put・list だけ） */
const memoryBucket = () => {
  const objects = new Map<string, string | Uint8Array>();
  const bucket = {
    get: async (key: string) => {
      const v = objects.get(key);
      if (v === undefined) return null;
      return {
        json: async () => JSON.parse(String(v)),
        text: async () => String(v),
      };
    },
    put: async (key: string, value: string | Uint8Array) => {
      objects.set(key, value);
    },
    list: async ({ prefix }: { prefix: string }) => ({
      objects: [...objects.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key })),
      truncated: false,
    }),
  };
  return bucket as unknown as R2Bucket;
};

/** 応答を、呼び出しの中身（system・messages・形）で引けるように記録する */
const keyOf = (params: Anthropic.MessageCreateParamsNonStreaming) =>
  JSON.stringify([params.system, params.messages, params.output_config]);

const client = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
  maxRetries: 0,
});

type Run = {
  outcome: WeakSceneOutcome;
  ms: number;
  usd: number;
  cpu?: { totalMs: number; partsMs: number };
};

const run = async (
  input: WeakSceneInput,
  create: CreateMessage,
  measureCpu: boolean,
): Promise<Run> => {
  const bucket = memoryBucket();
  const partsEnv = { BUCKET: bucket, CLAUDE_API_KEY: env.CLAUDE_API_KEY };
  let usd = 0;
  let partsCpu = 0;
  const counted: CreateMessage = async (params, options) => {
    const response = await create(params, options);
    usd += costOf(response.usage);
    return response;
  };
  const workshop: Workshop = {
    lookup: (id) => lookupPart(partsEnv, id),
    ensure: async (orders, opts) => {
      const before = process.cpuUsage();
      const result = await ensureParts(partsEnv, orders, {
        ...opts,
        deps: { create: counted },
      });
      const used = process.cpuUsage(before);
      partsCpu += (used.user + used.system) / 1000;
      return result;
    },
  };
  const put: WeakSceneRecord[] = [];
  const started = Date.now();
  const before = process.cpuUsage();
  const outcome = await makeWeakScene(env, input, {
    create: counted,
    workshop,
    store: {
      put: async (r) => {
        put.push(r);
      },
      find: async () => null,
    },
  });
  const used = process.cpuUsage(before);
  return {
    outcome,
    ms: Date.now() - started,
    usd,
    ...(measureCpu
      ? {
          cpu: {
            totalMs: Math.round((used.user + used.system) / 100) / 10,
            partsMs: Math.round(partsCpu * 10) / 10,
          },
        }
      : {}),
  };
};

const results: unknown[] = [];
let spent = 0;
for (const input of CASES.slice(0, count)) {
  if (spent >= cap) {
    console.log(`費用の上限（${cap} USD）に達したので止める`);
    break;
  }
  // 1 回目: 本物の Claude。応答を記録する
  const recorded = new Map<string, Anthropic.Message>();
  const live = await run(
    input,
    async (params, options) => {
      const response = await client.messages.create(params, options);
      recorded.set(keyOf(params), response);
      return response;
    },
    false,
  );
  spent += live.usd;
  // 2・3 回目: 記録した応答でなぞり、CPU を測る（2 回目は JIT が冷えた状態、3 回目は温まった状態）
  const replay: CreateMessage = async (params) => {
    const response = recorded.get(keyOf(params));
    if (!response) throw new Error("記録に無い呼び出し");
    return response;
  };
  const cold = await run(input, replay, true);
  const warm = await run(input, replay, true);
  const body = live.outcome.ok ? live.outcome.body : null;
  const row = {
    grade: input.difficulty,
    kinds: input.kinds,
    ok: live.outcome.ok,
    error: live.outcome.ok ? null : live.outcome.message,
    seconds: live.ms / 1000,
    usd: Number(live.usd.toFixed(4)),
    focus: body?.focus,
    name: body?.name,
    pitch: body?.pitch,
    createdParts: body?.createdParts,
    replayOk: cold.outcome.ok === live.outcome.ok,
    cpuMs: { cold: cold.cpu, warm: warm.cpu },
    layout: body?.layout,
  };
  results.push(row);
  console.log(JSON.stringify({ ...row, layout: undefined }));
}
await writeFile(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(`費用の合計 ${spent.toFixed(3)} USD`);
