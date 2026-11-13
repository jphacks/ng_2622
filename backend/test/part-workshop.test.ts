// 部品をその場で作る口（src/parts/workshop.ts の ensureParts・lookupPart）。
// R2 は miniflare の本物に近い偽物、Claude は偽の応答
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { ensureParts, lookupPart } from "../src/parts/workshop";
import type { CreateMessage } from "../src/scenes/generate";

type Answer = { decision: "build" | "refuse"; reason: string; ops: unknown[] };

// 傘立て: 筒と、底の板（つながっている）
const STAND: Answer = {
  decision: "build",
  reason: "a cylinder on a base plate",
  ops: [
    {
      op: "cyl",
      r1: 0.12,
      r2: 0.13,
      depth: 0.5,
      loc: [0, 0, 0.27],
      mat: "metal",
      segs: 20,
    },
    { op: "box", size: [0.3, 0.3, 0.04], loc: [0, 0, 0.02], mat: "dark" },
  ],
};
// 底の板から 30 cm 浮いた球が付いた、落ちる答え
const FLOATING: Answer = {
  ...STAND,
  ops: [...STAND.ops, { op: "sphere", r: 0.03, loc: [0, 0, 0.6], mat: "ball" }],
};

let mf: Miniflare;
let bucket: R2Bucket;

before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch: () => new Response(null) }",
      r2Buckets: ["BUCKET"],
    }),
  );
  bucket = (await mf.getR2Bucket("BUCKET")) as unknown as R2Bucket;
});

after(() => mf.dispose());

/** 偽の Claude。answers を順に返し、受け取った messages を残す */
const fakeClaude = (answers: Answer[]) => {
  const calls: Anthropic.MessageParam[][] = [];
  const create: CreateMessage = async (params) => {
    calls.push(structuredClone(params.messages));
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(answer) }],
      usage: {
        input_tokens: 3000,
        output_tokens: 1500,
        cache_read_input_tokens: 4000,
        cache_creation_input_tokens: 0,
      },
    } as unknown as Anthropic.Message;
  };
  return { create, calls };
};

const order = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  category: "thing" as const,
  label: "傘立て",
  words: ["umbrella stand"],
  size: [0.3, 0.5, 0.3] as [number, number, number],
  description: "A round metal umbrella stand on a dark square base.",
  ...extra,
});

test("無い部品は Claude に部品表を書かせて組み、R2 に置く。2 回目は作らずに R2 から返す", async () => {
  const claude = fakeClaude([STAND]);
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const first = await ensureParts(env, [order("umbrella_stand")], {
    maxNew: 4,
    deps: { create: claude.create },
  });
  assert.deepEqual(first.failed, []);
  assert.equal(first.parts.length, 1);
  const part = first.parts[0];
  assert.equal(part.id, "umbrella_stand");
  assert.equal(part.version, 1);
  assert.equal(part.file, "parts/umbrella_stand/1.usdz");
  assert.deepEqual(part.words, [{ word: "umbrella stand", pos: "noun" }]);
  assert.deepEqual(part.size, [0.3, 0.52, 0.3]);
  assert.equal(part.anchors, undefined);
  assert.equal(claude.calls.length, 1);

  // R2 の 3 つの置き場
  const usdz = await bucket.get("parts/umbrella_stand/1.usdz");
  assert.equal(usdz?.httpMetadata?.contentType, "model/vnd.usdz+zip");
  assert.deepEqual(
    await (await bucket.get("parts/umbrella_stand/1.json"))?.json(),
    part,
  );
  const recipe = (await (
    await bucket.get("recipes/umbrella_stand/1.json")
  )?.json()) as { ops: unknown[]; attempts: unknown[] };
  assert.equal(recipe.ops.length, 2);
  assert.equal(recipe.attempts.length, 1);

  const again = await ensureParts(env, [order("umbrella_stand")], {
    maxNew: 4,
    deps: { create: claude.create },
  });
  assert.deepEqual(again.parts, [part]);
  assert.equal(claude.calls.length, 1);
  assert.deepEqual(await lookupPart(env, "umbrella_stand"), part);
  assert.deepEqual(await lookupPart(env, "umbrella_stand", 1), part);
  assert.equal(await lookupPart(env, "umbrella_stand", 2), null);
  assert.equal(await lookupPart(env, "no_such_part"), null);
});

test("形の違う注文・同梱の ID・上限を超えた注文は作らずに失敗として返す", async () => {
  const claude = fakeClaude([STAND]);
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const result = await ensureParts(
    env,
    [
      order("chair"),
      order("Person_A"),
      order("person_stand_man_a"),
      order("lunch_box", { size: [0.2, 0, 0.1] }),
      order("globe_small", { top: true }),
      order("globe_large"),
    ],
    { maxNew: 1, deps: { create: claude.create } },
  );
  assert.deepEqual(
    result.parts.map((p) => p.id),
    ["globe_small"],
  );
  assert.deepEqual(
    result.failed.map((f) => f.id),
    ["chair", "Person_A", "person_stand_man_a", "lunch_box", "globe_large"],
  );
  assert.match(result.failed[0].reason, /同梱/);
  assert.match(result.failed[4].reason, /上限/);
  // 上に置ける物は anchors.top（筒の上のふち）
  assert.equal(result.parts[0].anchors?.top, 0.52);
  assert.equal(claude.calls.length, 1);
});

test("検査に落ちたら、落ちた理由を付けて 1 回だけ書き直させる", async () => {
  const claude = fakeClaude([FLOATING, STAND]);
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const result = await ensureParts(env, [order("trash_can")], {
    maxNew: 4,
    deps: { create: claude.create },
  });
  assert.deepEqual(result.failed, []);
  assert.equal(claude.calls.length, 2);
  const retry = claude.calls[1];
  assert.equal(retry.length, 3);
  assert.equal(retry[1].role, "assistant");
  assert.match(String(retry[2].content), /#2 .*do not touch/);
  const recipe = (await (
    await bucket.get("recipes/trash_can/1.json")
  )?.json()) as { attempts: { problems: { code: string }[] }[] };
  assert.deepEqual(
    recipe.attempts.map((a) => a.problems.map((p) => p.code)),
    [["floating"], []],
  );
});

test("2 回とも検査に落ちたら失敗として返し、R2 には置かない", async () => {
  const claude = fakeClaude([FLOATING]);
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const result = await ensureParts(env, [order("flower_vase")], {
    maxNew: 4,
    deps: { create: claude.create },
  });
  assert.deepEqual(result.parts, []);
  assert.equal(result.failed[0].id, "flower_vase");
  assert.match(result.failed[0].reason, /^invalid: 検査に落ちた/);
  assert.equal(claude.calls.length, 2);
  assert.equal(await bucket.head("parts/flower_vase/1.usdz"), null);
});

test("Claude が断った注文（人の名前など）は失敗として返す", async () => {
  const claude = fakeClaude([
    { decision: "refuse", reason: "It is a real person.", ops: [] },
  ]);
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const result = await ensureParts(
    env,
    [order("doll_tanaka", { words: ["doll"], label: "田中さんの人形" })],
    { maxNew: 4, deps: { create: claude.create } },
  );
  assert.deepEqual(result.parts, []);
  assert.match(result.failed[0].reason, /^refused: .*real person/);
  assert.equal(claude.calls.length, 1);
});

test("作らない物の語（武器・酒・たばこなど）を含む注文は、Claude を呼ばずに断る。包丁は作る", async () => {
  const claude = fakeClaude([STAND]);
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const result = await ensureParts(
    env,
    [
      order("sword", { words: ["sword"] }),
      order("bottle_green", { words: ["bottle"], label: "ビールの瓶" }),
      order("box_small", { description: "A small box of cigarettes." }),
      order("toy_gun", { words: ["toy"] }),
      order("kitchen_knife", { words: ["kitchen knife"], label: "包丁" }),
    ],
    { maxNew: 4, deps: { create: claude.create } },
  );
  assert.deepEqual(
    result.failed.map((f) => [f.id, f.reason]),
    [
      ["sword", "refused: 作らない物の語（sword）を含む"],
      ["bottle_green", "refused: 作らない物の語（ビール）を含む"],
      ["box_small", "refused: 作らない物の語（cigarettes）を含む"],
      ["toy_gun", "refused: 作らない物の語（gun）を含む"],
    ],
  );
  assert.deepEqual(
    result.parts.map((p) => p.id),
    ["kitchen_knife"],
  );
  assert.equal(claude.calls.length, 1);
});

test("注文の label・description・top の型が違えば作らない", async () => {
  const claude = fakeClaude([STAND]);
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const result = await ensureParts(
    env,
    [
      order("lamp", { label: 3 }),
      order("lamp_desk", { description: undefined }),
      order("lamp_floor", { top: "yes" }),
      order("lamp_wall", { label: "あ".repeat(41) }),
    ] as never,
    { maxNew: 4, deps: { create: claude.create } },
  );
  assert.deepEqual(
    result.failed.map((f) => f.reason),
    [
      "label は 1〜40 文字",
      "description は 1〜300 文字",
      "top は true か false",
      "label は 1〜40 文字",
    ],
  );
  assert.equal(claude.calls.length, 0);
});

test("同じ ID を別の所で同時に作って版 1 が先に取られていたら、版を上げて置き、前の版は書き換えない", async () => {
  // 別の Durable Object が版 1 の usdz を置いた直後（json はまだ）
  const theirs = new Uint8Array([1, 2, 3]);
  await bucket.put("parts/kite_red/1.usdz", theirs);
  const claude = fakeClaude([STAND]);
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const result = await ensureParts(env, [order("kite_red")], {
    maxNew: 4,
    deps: { create: claude.create },
  });
  assert.deepEqual(result.failed, []);
  const part = result.parts[0];
  assert.equal(part.version, 2);
  assert.equal(part.file, "parts/kite_red/2.usdz");
  assert.deepEqual(
    new Uint8Array(
      await (
        (await bucket.get("parts/kite_red/1.usdz")) as R2ObjectBody
      ).arrayBuffer(),
    ),
    theirs,
  );
  assert.deepEqual(
    await (await bucket.get("parts/kite_red/2.json"))?.json(),
    part,
  );
  const recipe = (await (
    await bucket.get("recipes/kite_red/2.json")
  )?.json()) as { version: number };
  assert.equal(recipe.version, 2);
  assert.equal(await bucket.head("parts/kite_red/1.json"), null);
});

test("savePart を同時に 2 回呼ぶと、別々の版に置く（後の方が前の版を上書きしない）", async () => {
  const { savePart } = await import("../src/parts/store");
  const { metaOf } = await import("../src/parts/make");
  const meta = (h: number) =>
    metaOf(order("tent", { size: [1, h, 1] }), 1, [1, h, 1], undefined);
  const record = (h: number) =>
    ({ id: "tent", version: 1, ops: [], attempts: [], tris: h }) as never;
  const [a, b] = await Promise.all([
    savePart(bucket, meta(0.5), new Uint8Array([5]), record(5)),
    savePart(bucket, meta(0.6), new Uint8Array([6]), record(6)),
  ]);
  assert.deepEqual([a.version, b.version].sort(), [1, 2]);
  for (const placed of [a, b]) {
    const json = (await (
      await bucket.get(`parts/tent/${placed.version}.json`)
    )?.json()) as { size: number[] };
    assert.deepEqual(json.size, placed.size);
    const usdz = new Uint8Array(
      await (
        (await bucket.get(`parts/tent/${placed.version}.usdz`)) as R2ObjectBody
      ).arrayBuffer(),
    );
    assert.deepEqual([...usdz], [placed.size[1] === 0.5 ? 5 : 6]);
  }
});

test("先の注文が止めて作れなかったら、同じ ID を待っていた後の注文は自分で作り直す", async () => {
  // signal が付いた呼び出しは止められるまで返さず、付いていない呼び出しはすぐ答える偽の Claude
  let calls = 0;
  const create: CreateMessage = async (_params, options) => {
    calls++;
    if (options.signal) {
      const signal = options.signal;
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    }
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(STAND) }],
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Message;
  };
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const controller = new AbortController();
  const first = ensureParts(env, [order("drum")], {
    maxNew: 4,
    signal: controller.signal,
    deps: { create },
  });
  const second = ensureParts(env, [order("drum")], {
    maxNew: 4,
    deps: { create },
  });
  setTimeout(() => controller.abort(), 20);
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a.failed, [{ id: "drum", reason: "止めた" }]);
  assert.deepEqual(b.failed, []);
  assert.equal(b.parts[0]?.id, "drum");
  assert.equal(calls, 2);
});

test("JSON でない・途中で止まった答えの回も、費用と理由を記録に残す", async () => {
  let calls = 0;
  const create: CreateMessage = async () => {
    calls++;
    const usage = { input_tokens: 1000, output_tokens: 1000 };
    if (calls === 1)
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "not json" }],
        usage,
      } as unknown as Anthropic.Message;
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(STAND) }],
      usage,
    } as unknown as Anthropic.Message;
  };
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const result = await ensureParts(env, [order("lantern")], {
    maxNew: 4,
    deps: { create },
  });
  assert.deepEqual(result.failed, []);
  assert.equal(result.logs[0].attempts, 2);
  assert.equal(result.logs[0].usd, 0.024);
  const recipe = (await (
    await bucket.get("recipes/lantern/1.json")
  )?.json()) as { attempts: { problems: { code: string }[] }[] };
  assert.deepEqual(
    recipe.attempts.map((a) => a.problems.map((p) => p.code)),
    [["schema"], []],
  );
});

test("止めたら、できていない部品を失敗として返す", async () => {
  const controller = new AbortController();
  const create: CreateMessage = () => new Promise(() => {});
  const env = { BUCKET: bucket, CLAUDE_API_KEY: "test" };
  const pending = ensureParts(env, [order("kite")], {
    maxNew: 4,
    signal: controller.signal,
    deps: { create },
  });
  setTimeout(() => controller.abort(), 10);
  const result = await pending;
  assert.deepEqual(result.failed, [{ id: "kite", reason: "止めた" }]);
});

test("注文の本文には、同じ category の今の部品の部品表（見本）と、軸を添えた寸法が入る", async () => {
  const { orderMessage } = await import("../src/parts/write");
  const text = orderMessage({
    ...order("cactus_pot"),
    category: "plant",
    top: true,
  });
  assert.match(text, /- plant_pot \(/);
  assert.match(text, /- tree \(/);
  assert.doesNotMatch(text, /- chair \(/);
  assert.match(
    text,
    /size: width 0\.3 m \(X\), height 0\.5 m \(Z\), depth 0\.3 m \(Y\)/,
  );
  assert.match(text, /top surface/);
});
