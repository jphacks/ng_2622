// 実験用（2026-11-14、PR は merge しない）: 苦手の場面の生成（部品の生成も含む）を、Claude の代わりに OpenRouter のモデルで試す。
// 指示・JSON の形・裏取り・作り直し・締め切りは今のコードのまま。Claude を呼ぶ関数（CreateMessage）だけを OpenRouter につなぐ関数に差し替える。
// 費用は OpenRouter が返す実際の値（usage.cost）を足す（ログの sceneUsd は Claude の単価で数えるので当てにしない）。
//   OPENROUTER_API_KEY=... MODEL=deepseek/deepseek-v4-pro [REASONING=off] [NO_TIMEOUT=1] pnpm tsx scripts/try-openrouter-weak-scenes.ts <出力のフォルダ> [場面の数（既定 4）] [費用の上限ドル（既定 1）]
// 出力: <フォルダ>/result.json（場面ごとの結果と呼び出しごとの記録）、<n>-<級>.json（配置）、parts/<id>/<版>.usdz（作った部品）
// 4 通りの入力は measure-weak-scenes.ts と同じ。
// NO_TIMEOUT=1 なら締め切り（全体 90 秒・1 回 45 秒）を外す（考えるモデルが、時間さえあれば裏取りを通るかを見るため。本番のコードは変えない）。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { ensureParts, lookupPart } from "../src/parts/workshop";
import type { WeakSceneRecord } from "../src/repositories/weakSceneRepository";
import type { CreateMessage } from "../src/scenes/generate";
import type { Workshop } from "../src/scenes/generate-v2";
import { WeakSceneRequest } from "../src/schemas/http";
import { makeWeakScene, type WeakSceneInput } from "../src/usecases/weakScenes";

const [outDir, countArg, capArg] = process.argv.slice(2);
const KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.MODEL ?? "deepseek/deepseek-v4-pro";
if (!outDir || !KEY) {
  console.error(
    "使い方: OPENROUTER_API_KEY=... MODEL=... pnpm tsx scripts/try-openrouter-weak-scenes.ts <出力のフォルダ> [場面の数] [費用の上限ドル]",
  );
  process.exit(2);
}
const count = Number(countArg ?? 4);
const cap = Number(capArg ?? 1);
const NO_TIMEOUT = process.env.NO_TIMEOUT === "1";
// 締め切りを外すときの 1 回の上限と、場面 1 つの上限
const LOOSE_CALL_MS = 600_000;
const LOOSE_BUDGET_MS = 3_600_000;
// makeWeakScene は CLAUDE_API_KEY が無いと止まるので、形だけ入れる（実際の呼び出しは下の orCreate が受ける）
const env = { CLAUDE_API_KEY: "openrouter" };

// measure-weak-scenes.ts と同じ 4 通り
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
  {
    difficulty: "eiken-3",
    kinds: ["reason", "center", "detail"],
    habits: [
      {
        viewpoint: "content",
        title: "人の動作を言わない",
        fix: "誰が何をしているかを先に言う。例: A boy is running.",
      },
    ],
  },
].map((c) => WeakSceneRequest.parse(c));

type Call = {
  scene: number;
  kind: string;
  ms: number;
  prompt: number;
  cached: number;
  completion: number;
  reasoning: number;
  usd: number;
  finish: string;
  error?: string;
};
const calls: Call[] = [];
let sceneNo = 0;

// system の書き出しで、どの呼び出しかを見分ける
const kindOf = (system: string) =>
  system.startsWith("You design small 3D props")
    ? "part"
    : system.startsWith("You write the English side")
      ? "sentence"
      : system.startsWith("You build small 3D scenes")
        ? "items"
        : "other";

/** Claude の要求を OpenRouter（OpenAI 互換）に直して呼び、答えを Claude の形に戻す */
const orCreate: CreateMessage = async (params, options) => {
  const system = Array.isArray(params.system)
    ? params.system.map((b) => b.text).join("\n\n")
    : (params.system ?? "");
  const messages = [
    { role: "system", content: system },
    ...params.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"),
    })),
  ];
  const format = params.output_config?.format;
  const effort = params.output_config?.effort;
  const body = {
    model: MODEL,
    messages,
    // OpenRouter では考えたトークンも max_tokens に入るので、余裕を持たせる
    max_tokens: Math.max(params.max_tokens, 32000),
    ...(format?.type === "json_schema"
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "output",
              strict: true,
              schema: format.schema,
            },
          },
        }
      : {}),
    // REASONING=off なら考えさせない（速さを見るため）。それ以外は Claude の effort をそのまま渡す
    ...(process.env.REASONING === "off"
      ? { reasoning: { enabled: false } }
      : effort
        ? {
            reasoning: {
              effort: effort === "low" || effort === "medium" ? effort : "high",
            },
          }
        : {}),
    usage: { include: true },
    provider: { require_parameters: true },
  };
  const kind = kindOf(system);
  const started = Date.now();
  const record = (c: Partial<Call>) =>
    calls.push({
      scene: sceneNo,
      kind,
      ms: Date.now() - started,
      prompt: 0,
      cached: 0,
      completion: 0,
      reasoning: 0,
      usd: 0,
      finish: "",
      ...c,
    });
  const timeout = NO_TIMEOUT ? LOOSE_CALL_MS : options.timeout;
  const signals = [AbortSignal.timeout(timeout), options.signal].filter(
    (s): s is AbortSignal => s !== undefined,
  );
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
  } catch (e) {
    record({ error: `connection: ${String(e)}` });
    if (e instanceof DOMException && e.name === "TimeoutError")
      throw new Anthropic.APIConnectionTimeoutError();
    throw new Anthropic.APIConnectionError({ cause: e as Error });
  }
  // OpenRouter は本文より先に 200 とヘッダーを返すので、時間切れはたいてい本文を読む途中で起きる。
  // 握りつぶすと「空の成功」になるので、時間切れは Claude と同じ時間切れの例外にする
  //（止めた呼び出しも OpenRouter は最後まで処理して請求するので、費用はキーの利用額で確かめる）
  // biome-ignore lint/suspicious/noExplicitAny: OpenRouter の応答の形は緩く読む
  let json: any;
  try {
    json = await res.json();
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      record({ error: "timeout（本文を読む途中）" });
      throw new Anthropic.APIConnectionTimeoutError();
    }
    record({ error: `本文が JSON でない: ${String(e)}` });
    throw Anthropic.APIError.generate(
      502,
      undefined,
      "本文が JSON でない",
      res.headers,
    );
  }
  if (!res.ok || json.error) {
    const status = res.ok ? Number(json.error?.code) || 502 : res.status;
    record({ error: `${status}: ${json.error?.message ?? res.statusText}` });
    throw Anthropic.APIError.generate(
      status,
      json,
      json.error?.message ?? res.statusText,
      res.headers,
    );
  }
  const choice = json.choices?.[0];
  const text = String(choice?.message?.content ?? "")
    .replace(/^\s*```(?:json)?\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
  const u = json.usage ?? {};
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const finish = String(choice?.finish_reason ?? "");
  record({
    prompt: u.prompt_tokens ?? 0,
    cached,
    completion: u.completion_tokens ?? 0,
    reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0,
    usd: Number(u.cost ?? 0),
    finish,
  });
  return {
    id: json.id ?? "openrouter",
    type: "message",
    role: "assistant",
    model: MODEL,
    content: [{ type: "text", text, citations: null }],
    stop_reason:
      finish === "length"
        ? "max_tokens"
        : finish === "content_filter"
          ? "refusal"
          : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: (u.prompt_tokens ?? 0) - cached,
      output_tokens: u.completion_tokens ?? 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
};

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
  return { objects, bucket: bucket as unknown as R2Bucket };
};

await mkdir(path.join(outDir, "parts"), { recursive: true });
const results: unknown[] = [];
let spent = 0;
for (const [i, input] of CASES.slice(0, count).entries()) {
  if (spent >= cap) {
    console.log(`費用の上限（${cap} USD）に達したので止める`);
    break;
  }
  sceneNo = i + 1;
  const { objects, bucket } = memoryBucket();
  const partsEnv = { BUCKET: bucket, CLAUDE_API_KEY: env.CLAUDE_API_KEY };
  const workshop: Workshop = {
    lookup: (id) => lookupPart(partsEnv, id),
    ensure: (orders, opts) =>
      ensureParts(partsEnv, orders, { ...opts, deps: { create: orCreate } }),
  };
  const put: WeakSceneRecord[] = [];
  const started = Date.now();
  const outcome = await makeWeakScene(env, input, {
    create: orCreate,
    ...(NO_TIMEOUT ? { budgetMs: LOOSE_BUDGET_MS } : {}),
    workshop,
    store: {
      put: async (r) => {
        put.push(r);
      },
      find: async () => null,
    },
  });
  const mine = calls.filter((c) => c.scene === sceneNo);
  const usd = mine.reduce((a, c) => a + c.usd, 0);
  spent += usd;
  const body = outcome.ok ? outcome.body : null;
  if (body?.layout) {
    await writeFile(
      path.join(outDir, `${sceneNo}-${input.difficulty}.json`),
      `${JSON.stringify(body.layout, null, 2)}\n`,
    );
  }
  for (const [key, value] of objects) {
    if (!key.startsWith("parts/")) continue;
    const file = path.join(outDir, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value);
  }
  const row = {
    scene: sceneNo,
    grade: input.difficulty,
    kinds: input.kinds,
    ok: outcome.ok,
    error: outcome.ok ? null : outcome.message,
    seconds: (Date.now() - started) / 1000,
    usd: Number(usd.toFixed(4)),
    calls: mine.length,
    name: body?.name,
    pitch: body?.pitch,
    focus: body?.focus,
    createdParts: body?.createdParts,
  };
  results.push(row);
  console.log(JSON.stringify(row));
}
await writeFile(
  path.join(outDir, "result.json"),
  `${JSON.stringify({ model: MODEL, reasoning: process.env.REASONING ?? "effort", noTimeout: NO_TIMEOUT, results, calls }, null, 2)}\n`,
);
console.log(
  `モデル ${MODEL}、費用の合計 ${spent.toFixed(4)} USD、呼び出し ${calls.length} 回`,
);
