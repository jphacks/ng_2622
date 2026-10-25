// 場面の生成（src/scenes/generate.ts）のテスト。Claude は呼ばず、create を差し替える
import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import {
  ATTEMPT_TIMEOUT_MS,
  buildSystem,
  type GenerateInput,
  generatePlan,
  planSchema,
  SceneGenerationError,
  THEMES,
  userMessage,
} from "../src/scenes/generate";
import { PARTS } from "../src/scenes/parts";

const PLAN = {
  name: "公園",
  description: "A park.",
  elements: [{ id: "place", label: "公園", points: 90, accept: "park" }],
  items: [{ key: "grass", part: "grass_patch", place: { relation: "ground" } }],
};
const USAGE = { input_tokens: 1, output_tokens: 1 };
const message = (stop_reason: string, text = JSON.stringify(PLAN)) => ({
  stop_reason,
  content: [{ type: "text", text }],
  usage: USAGE,
});

/** 決めた順に応答（か例外）を返す create。渡された引数を覚える */
const fake = (steps: (() => unknown)[]) => {
  const calls: {
    params: Anthropic.MessageCreateParamsNonStreaming;
    timeout: number;
  }[] = [];
  const create = async (
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { timeout: number },
  ) => {
    calls.push({ params, timeout: options.timeout });
    const step = steps[calls.length - 1];
    if (!step) throw new Error("呼びすぎ");
    return step();
  };
  return { create: create as never, calls };
};

const run = (
  f: ReturnType<typeof fake>,
  input: GenerateInput = { difficulty: "easy", theme: "公園" },
) =>
  generatePlan({ CLAUDE_API_KEY: "test" }, PARTS, input, { create: f.create });

const failsWith = async (p: Promise<unknown>, kind: string) => {
  await assert.rejects(
    p,
    (e) => e instanceof SceneGenerationError && e.kind === kind,
  );
};

test("1 回目で書ければそのまま返す。各回の timeout は 60 秒", async () => {
  const f = fake([() => message("end_turn")]);
  const result = await run(f);
  assert.equal(result.attempts, 1);
  assert.deepEqual(
    f.calls.map((c) => c.timeout),
    [ATTEMPT_TIMEOUT_MS],
  );
  assert.equal(ATTEMPT_TIMEOUT_MS, 60_000);
});

test("難易度とテーマを user に渡し、テーマを省けば一覧から選ばせる", async () => {
  const f = fake([() => message("end_turn"), () => message("end_turn")]);
  await run(f, { difficulty: "hard", theme: "駅" });
  await run(f, { difficulty: "normal" });
  const contents = f.calls.map((c) => c.params.messages[0].content);
  assert.deepEqual(contents, [
    "難しさ: hard\nテーマ: 駅",
    "難しさ: normal\nテーマ: 一覧から選ぶ",
  ]);
  assert.equal(
    userMessage({ difficulty: "easy" }),
    "難しさ: easy\nテーマ: 一覧から選ぶ",
  );
});

test("形が違えば 1 回だけやり直す（2 回目も 60 秒）", async () => {
  const f = fake([() => message("end_turn", "{}"), () => message("end_turn")]);
  const result = await run(f);
  assert.equal(result.attempts, 2);
  assert.deepEqual(
    f.calls.map((c) => c.timeout),
    [60_000, 60_000],
  );
});

test("途中で止まったのが 2 回続けば generation_failed（invalid）", async () => {
  const f = fake([() => message("max_tokens"), () => message("max_tokens")]);
  await failsWith(run(f), "invalid");
  assert.equal(f.calls.length, 2);
});

test("断られたらやり直さない（refused）", async () => {
  const f = fake([() => message("refusal")]);
  await failsWith(run(f), "refused");
  assert.equal(f.calls.length, 1);
});

test("4xx（429 も）ではやり直さず、5xx と接続の失敗ではやり直す", async () => {
  const rateLimited = fake([
    () => {
      throw new Anthropic.RateLimitError(429, {}, "rate", new Headers());
    },
  ]);
  await failsWith(run(rateLimited), "unavailable");
  assert.equal(rateLimited.calls.length, 1);

  const overloaded = fake([
    () => {
      throw new Anthropic.InternalServerError(
        529,
        {},
        "overloaded",
        new Headers(),
      );
    },
    () => message("end_turn"),
  ]);
  assert.equal((await run(overloaded)).attempts, 2);

  const disconnected = fake([
    () => {
      throw new Anthropic.APIConnectionError({ message: "reset" });
    },
    () => message("end_turn"),
  ]);
  assert.equal((await run(disconnected)).attempts, 2);
});

test("タイムアウトはやり直さない（unavailable）", async () => {
  const f = fake([
    () => {
      throw new Anthropic.APIConnectionTimeoutError();
    },
  ]);
  await failsWith(run(f), "unavailable");
  assert.equal(f.calls.length, 1);
});

test("書かせる形は description と elements を items より先に置く", () => {
  const schema = planSchema(PARTS);
  const keys = Object.keys(schema.properties);
  assert.deepEqual(keys, ["name", "description", "elements", "items"]);
  assert.deepEqual(schema.required, keys);
});

test("指示文にテーマの一覧と難易度の中身があり、お題と不適切対策の決まりは無い", () => {
  const system = buildSystem(PARTS);
  for (const t of THEMES) assert.ok(system.includes(t), `${t} が無い`);
  for (const d of ["easy", "normal", "hard"]) {
    assert.ok(system.includes(`- ${d}: level`), `${d} の中身が無い`);
  }
  assert.ok(!system.includes("# Safety"));
  assert.ok(!system.includes("お題"));
});

test("床・背景の壁・駅の部品は一覧にあり、指示文で使い分ける", () => {
  const system = buildSystem(PARTS);
  const rules = system.slice(0, system.indexOf("# Parts"));
  const ids = new Set(PARTS.map((p) => p.id));
  for (const id of [
    "grass_patch",
    "road_patch",
    "floor_wood",
    "floor_tile",
    "floor_carpet",
    "floor_classroom",
    "platform_station",
    "sand_beach",
    "sidewalk_stone",
    "ground_dirt",
    "wall_window",
    "wall_kitchen_tile",
    "wall_blackboard",
    "wall_store_shelves",
    "kitchen_counter",
    "train",
  ]) {
    assert.ok(ids.has(id), `${id} が一覧に無い`);
    assert.ok(rules.includes(id), `${id} を指示文で使い分ける`);
  }
  assert.ok(!/grass_patch as the floor/.test(rules), "室内で芝生を床にしない");
});
