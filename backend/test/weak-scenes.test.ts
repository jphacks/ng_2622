// 苦手の場面（POST /weak-scenes）のテスト。Claude・部品を作る口・置き場（R2）・数える場所は偽物にし、本物は呼ばない
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import app from "../src/app";
import type { PartOrder } from "../src/parts/workshop";
import type { UsageCounterRepository } from "../src/repositories/usageCounterRepository";
import type {
  WeakSceneRecord,
  WeakSceneStore,
} from "../src/repositories/weakSceneRepository";
import { makeWeakSceneRoutes } from "../src/routes/weakScenes";
import {
  buildConventionItemsSystem,
  buildItemsSystem,
  buildSentenceSystem,
  EXAMPLE_ANSWER,
  EXAMPLE_ITEMS,
  sentenceMessage,
  type Workshop,
} from "../src/scenes/generate-v2";
import { livingTable } from "../src/scenes/lookup";
import { PARTS } from "../src/scenes/parts";
import type { Part, PlanItem } from "../src/scenes/types";
import { weakText } from "../src/scenes/weak";
import { WeakSceneRequest, WeakSceneResponse } from "../src/schemas/http";
import {
  makeWeakScene,
  type WeakSceneOutcome,
} from "../src/usecases/weakScenes";

const ENV = {
  WEAK_SCENE_GENERATION: "on",
  WEAK_SCENE_IP_PER_HOUR: "5",
  WEAK_SCENE_DAILY_LIMIT: "40",
  CLAUDE_API_KEY: "test",
};

const BODY = {
  difficulty: "eiken-pre2",
  kinds: ["link", "reason", "center"],
  habits: [
    {
      viewpoint: "content",
      title: "理由をつけずに終わる",
      fix: "because で理由を足す。例: He is running because it is raining.",
    },
  ],
  nextTry: { viewpoint: "content", text: "理由を 1 つ足してみよう。" },
};

// ---------- 偽物 ----------

const USAGE = { input_tokens: 1, output_tokens: 1 };
const message = (body: unknown, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text: JSON.stringify(body) }],
  usage: USAGE,
});

/** 決めた順に応答を返す create。渡された引数を覚える */
const fakeClaude = (steps: (() => unknown)[]) => {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    const step = steps[calls.length - 1];
    if (!step) throw new Error("呼びすぎ");
    return step();
  };
  return { create: create as never, calls };
};
const userOf = (p: Anthropic.MessageCreateParamsNonStreaming) =>
  p.messages[0].content as string;
const systemOf = (p: Anthropic.MessageCreateParamsNonStreaming) =>
  (p.system as Anthropic.TextBlockParam[])[0].text;
const schemaOf = (p: Anthropic.MessageCreateParamsNonStreaming) =>
  (
    p.output_config as unknown as {
      format: { schema: { required: string[] } };
    }
  ).format.schema;

const ANSWER = {
  ...EXAMPLE_ANSWER,
  pitch: "because で理由を言いやすい場面です",
};

/** 例の items を規約の ID で書いたもの（人は person_<動作>_<誰>_a）に、作る物を 1 つ足したもの */
const LAMP: PartOrder = {
  id: "lamp_street",
  category: "thing",
  label: "街灯",
  words: ["lamp", "street lamp"],
  size: [0.4, 3, 0.4],
  description: "A tall black street lamp with a round white light.",
};
const LAMP_ORDER = {
  id: LAMP.id,
  category: LAMP.category,
  label: LAMP.label,
  words: LAMP.words,
  size: { width: 0.4, height: 3, depth: 0.4 },
  description: LAMP.description,
  top: false,
};
const conventionItems = (extra: PlanItem[] = []): PlanItem[] => [
  ...EXAMPLE_ITEMS.map((i) =>
    i.part === "person_read_sit_adult_a"
      ? { ...i, part: "person_read_sit_man_a" }
      : i,
  ),
  ...extra,
];
const LAMP_ITEM: PlanItem = {
  key: "lamp",
  part: "lamp_street",
  place: { relation: "ground", zone: "back_left" },
};

const madeMeta = (o: PartOrder, version = 1): Part => ({
  id: o.id,
  version,
  file: `parts/${o.id}/${version}.usdz`,
  category: o.category,
  words: o.words.map((word) => ({ word, pos: "noun" })),
  size: o.size,
  label: o.label,
});

/** 部品を作る口の偽物。r2 は前に作った部品、fail は作れない ID（回数ごとに作れないかを決める） */
const fakeWorkshop = (
  r2: Part[] = [],
  fail: (id: string, attempt: number) => boolean = () => false,
) => {
  const ensured: PartOrder[][] = [];
  const options: { timeoutMs?: number; signal?: AbortSignal }[] = [];
  const looked: string[] = [];
  const workshop: Workshop = {
    lookup: async (id) => {
      looked.push(id);
      return r2.find((p) => p.id === id) ?? null;
    },
    ensure: async (orders, opts) => {
      ensured.push(orders);
      options.push(opts);
      const attempt = ensured.length;
      return {
        parts: orders
          .filter((o) => !fail(o.id, attempt))
          .map((o) => madeMeta(o)),
        failed: orders
          .filter((o) => fail(o.id, attempt))
          .map((o) => ({ id: o.id, reason: "形の検査を通らなかった" })),
      };
    },
  };
  return { workshop, ensured, looked, options };
};

const fakeStore = () => {
  const put: WeakSceneRecord[] = [];
  const store: WeakSceneStore = {
    put: async (record) => {
      put.push(record);
    },
    find: async (id) => put.find((r) => r.sceneId === id) ?? null,
  };
  return { store, put };
};

const fakeUsage = (
  take: Awaited<ReturnType<UsageCounterRepository["take"]>> = { ok: true },
) => {
  const calls: string[] = [];
  const usage: UsageCounterRepository = {
    take: async (ip) => {
      calls.push(ip);
      return take;
    },
    takeDaily: async () => true,
  };
  return { usage, calls };
};

const post = (
  routes: ReturnType<typeof makeWeakSceneRoutes>,
  body: unknown,
  env: Record<string, unknown> = ENV,
  headers: Record<string, string> = {},
) =>
  routes.request(
    "/weak-scenes",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );

const OK_BODY = (): WeakSceneOutcome => ({
  ok: true,
  body: {
    sceneId: "weak-0f8fad5b-d9cb-469f-a165-70867728950e",
    name: "雨のバス停",
    difficulty: "eiken-pre2",
    focus: "reason",
    pitch: "because で理由を言いやすい場面です",
    layout: {
      protocol: "scenenglish.scene/2",
      id: "weak-0f8fad5b-d9cb-469f-a165-70867728950e",
      name: "雨のバス停",
      difficulty: "eiken-pre2",
      description: "",
      checklist: [],
      items: [],
    },
    createdParts: [],
  },
});

// ---------- 口の形・スイッチ・上限 ----------

test("スイッチが on でなければ、本文を読む前に 503 generation_unavailable で、数えない・作らない", async () => {
  for (const value of ["off", undefined, "ON"]) {
    const { usage, calls } = fakeUsage();
    let made = 0;
    const routes = makeWeakSceneRoutes({
      usage: () => usage,
      make: async () => {
        made++;
        return OK_BODY();
      },
    });
    const res = await post(routes, BODY, {
      ...ENV,
      WEAK_SCENE_GENERATION: value,
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "generation_unavailable");
    assert.equal(calls.length, 0);
    assert.equal(made, 0);
  }
});

test("本文の形が違えば 400 invalid_message で、数えない", async () => {
  const { usage, calls } = fakeUsage();
  const routes = makeWeakSceneRoutes({
    usage: () => usage,
    make: async () => OK_BODY(),
  });
  const malformed = await post(routes, "not json");
  assert.equal(malformed.status, 400);
  for (const bad of [
    { ...BODY, difficulty: "easy" },
    { ...BODY, kinds: [] },
    { ...BODY, kinds: ["center", "reason", "link", "detail", "center"] },
    { ...BODY, kinds: ["why"] },
    {
      ...BODY,
      habits: [...BODY.habits, ...BODY.habits, ...BODY.habits, ...BODY.habits],
    },
    { ...BODY, habits: [{ ...BODY.habits[0], title: "あ".repeat(81) }] },
    { ...BODY, nextTry: { viewpoint: "content", text: "" } },
  ]) {
    const res = await post(routes, bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "invalid_message");
  }
  assert.equal(calls.length, 0);
  // 本文が大きすぎれば 413
  const big = await post(routes, { ...BODY, pad: "x".repeat(10_000) });
  assert.equal(big.status, 413);
});

test("上限に達したら 429 rate_limited で作らない。数える場所が失敗したら 503。IP は CF-Connecting-IP から数える", async () => {
  for (const reason of ["ip_hourly", "daily"] as const) {
    const { usage } = fakeUsage({ ok: false, reason });
    let made = 0;
    const routes = makeWeakSceneRoutes({
      usage: () => usage,
      make: async () => {
        made++;
        return OK_BODY();
      },
    });
    const res = await post(routes, BODY);
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "rate_limited");
    assert.equal(made, 0);
  }
  const broken: UsageCounterRepository = {
    take: async () => {
      throw new Error("down");
    },
    takeDaily: async () => false,
  };
  const res = await post(
    makeWeakSceneRoutes({ usage: () => broken, make: async () => OK_BODY() }),
    BODY,
  );
  assert.equal(res.status, 503);

  const { usage, calls } = fakeUsage();
  const routes = makeWeakSceneRoutes({
    usage: () => usage,
    make: async () => OK_BODY(),
  });
  const ok = await post(routes, BODY, ENV, {
    "cf-connecting-ip": "2001:db8:1:2:3:4:5:6",
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls, ["2001:db8:1:2::/64"]);
  const parsed = WeakSceneResponse.safeParse(await ok.json());
  assert.ok(parsed.success);
});

test("Claude のキーが無ければ 503 で、数えない", async () => {
  const { usage, calls } = fakeUsage();
  const routes = makeWeakSceneRoutes({
    usage: () => usage,
    make: async () => OK_BODY(),
  });
  const res = await post(routes, BODY, { ...ENV, CLAUDE_API_KEY: undefined });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test("作れなかったら、作る関数の返したエラー（502）をそのまま返す", async () => {
  const { usage } = fakeUsage();
  const routes = makeWeakSceneRoutes({
    usage: () => usage,
    make: async () => ({
      ok: false,
      code: "generation_failed",
      status: 502,
      message: "苦手の場面を作れませんでした: x",
    }),
  });
  const res = await post(routes, BODY);
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "generation_failed");
});

test("口はアプリに載っている（スイッチが無い環境では 503）", async () => {
  const res = await app.request(
    "/weak-scenes",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BODY),
    },
    {},
  );
  assert.equal(res.status, 503);
});

// ---------- 苦手の指示 ----------

test("苦手は 1 回目の user の文に足し、system は変えない（cache を崩さない）。一言（pitch）も書かせる", async () => {
  const { create, calls } = fakeClaude([
    () => message(ANSWER),
    () => message({ items: conventionItems(), newParts: [] }),
  ]);
  const { workshop } = fakeWorkshop();
  const { store } = fakeStore();
  const outcome = await makeWeakScene(ENV, WeakSceneRequest.parse(BODY), {
    create,
    workshop,
    store,
  });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const [first, second] = calls;
  assert.equal(systemOf(first), buildSentenceSystem(PARTS));
  const focus = {
    kind: "reason" as const,
    habits: BODY.habits as never,
    nextTry: BODY.nextTry as never,
  };
  assert.equal(
    userOf(first),
    sentenceMessage({ grade: "eiken-pre2", weak: focus }),
  );
  assert.ok(userOf(first).includes(weakText(focus)));
  assert.ok(userOf(first).includes("The player often misses the reason items"));
  assert.ok(userOf(first).includes("理由をつけずに終わる"));
  assert.ok(userOf(first).includes("not in the list of things"));
  assert.ok(schemaOf(first).required.includes("pitch"));
  // 2 回目は部品の一覧を出さず、規約と人・動物の表だけ
  assert.equal(systemOf(second), buildConventionItemsSystem(PARTS));
  assert.ok(!systemOf(second).includes("# Parts ("));
  assert.ok(systemOf(second).includes(livingTable(PARTS)));
  // 人の部品の ID は、決まりの文が例として名指しするもの（一覧を出す道の指示にも部品の一覧の外で出る）だけ
  const rules = buildItemsSystem([]);
  for (const p of PARTS.filter((x) => x.category === "person")) {
    if (rules.includes(p.id)) continue;
    assert.ok(!systemOf(second).includes(p.id), `${p.id} が出ている`);
  }
  assert.deepEqual(schemaOf(second).required, ["items", "newParts"]);
  assert.equal(outcome.body.focus, "reason");
  assert.equal(outcome.body.pitch, ANSWER.pitch);
});

// ---------- 作る（Claude・部品・置き場は偽物） ----------

test("苦手の場面を作る: 足りない部品を作り、配置では id@版 にし、置き場に配置と部品のメタデータを置く", async () => {
  const { create } = fakeClaude([
    () => message(ANSWER),
    () =>
      message({ items: conventionItems([LAMP_ITEM]), newParts: [LAMP_ORDER] }),
  ]);
  const { workshop, ensured, options } = fakeWorkshop();
  const { store, put } = fakeStore();
  const outcome = await makeWeakScene(ENV, WeakSceneRequest.parse(BODY), {
    create,
    workshop,
    store,
    newId: () => "0f8fad5b-d9cb-469f-a165-70867728950e",
    // 残りの半分が 35 秒より短く、端数の出る締め切り
    budgetMs: 60_001,
  });
  // 部品を作る Claude の 1 回の上限は整数（SDK が整数でないと失敗する）で 35 秒まで。全体の締め切りの signal も渡す
  assert.ok(Number.isInteger(options[0].timeoutMs));
  assert.ok((options[0].timeoutMs ?? 0) <= 35_000);
  assert.ok(options[0].signal);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const body = outcome.body;
  assert.ok(WeakSceneResponse.safeParse(body).success);
  assert.equal(body.sceneId, "weak-0f8fad5b-d9cb-469f-a165-70867728950e");
  assert.equal(body.layout.id, body.sceneId);
  assert.equal(body.name, EXAMPLE_ANSWER.name);
  assert.deepEqual(body.createdParts, ["lamp_street@1"]);
  const parts = body.layout.items.map((i) => i.part);
  assert.ok(parts.includes("lamp_street@1"));
  assert.ok(
    parts.includes("person_read_sit_adult_a"),
    "人は同梱の部品に寄せる",
  );
  assert.deepEqual(
    ensured.map((o) => o.map((x) => x.id)),
    [["lamp_street"]],
  );
  assert.equal(put.length, 1);
  assert.equal(put[0].sceneId, body.sceneId);
  assert.deepEqual(
    put[0].parts.map((p) => p.id),
    ["lamp_street"],
  );
  assert.deepEqual(put[0].layout, body.layout);
});

test("部品を作れなかったら（作り直しは部品を作る口の中で 1 回）502 で、場面を作り直さず置かない", async () => {
  const { create, calls } = fakeClaude([
    () => message(ANSWER),
    () =>
      message({ items: conventionItems([LAMP_ITEM]), newParts: [LAMP_ORDER] }),
  ]);
  const never = fakeWorkshop([], () => true);
  const { store, put } = fakeStore();
  const failed = await makeWeakScene(ENV, WeakSceneRequest.parse(BODY), {
    create,
    workshop: never.workshop,
    store,
  });
  assert.ok(!failed.ok && failed.status === 502);
  assert.ok(!failed.ok && failed.code === "generation_failed");
  assert.ok(!failed.ok && failed.message.includes("lamp_street"));
  assert.equal(never.ensured.length, 1);
  assert.equal(calls.length, 2, "Claude を呼び直さない");
  assert.equal(put.length, 0);
});

test("同梱に無い物が上限を超えたら、理由を足して 2 回目を作り直す（部品は作らない）", async () => {
  const many = ["kite", "vase", "drum", "fan", "lamp"].map((id) => ({
    ...LAMP_ORDER,
    id,
    words: [id],
  }));
  const { create, calls } = fakeClaude([
    () => message(ANSWER),
    () =>
      message({
        items: conventionItems(
          many.map((o, n) => ({
            key: o.id,
            part: o.id,
            place: {
              relation: "ground",
              zone: n % 2 ? "back_left" : "back_right",
            },
          })),
        ),
        newParts: many,
      }),
    () => message({ items: conventionItems(), newParts: [] }),
  ]);
  const { workshop, ensured } = fakeWorkshop();
  const { store } = fakeStore();
  const outcome = await makeWeakScene(ENV, WeakSceneRequest.parse(BODY), {
    create,
    workshop,
    store,
  });
  assert.ok(outcome.ok, JSON.stringify(outcome));
  assert.equal(calls.length, 3);
  assert.ok(userOf(calls[2]).includes("1 つの場面で 4 個まで"));
  assert.equal(ensured.length, 0);
  assert.deepEqual(outcome.body.createdParts, []);
});

test("Claude が断ったら 502 generation_refused、キーが無ければ 503", async () => {
  const { create } = fakeClaude([() => message(ANSWER, "refusal")]);
  const outcome = await makeWeakScene(ENV, WeakSceneRequest.parse(BODY), {
    create,
    workshop: fakeWorkshop().workshop,
    store: fakeStore().store,
  });
  assert.ok(!outcome.ok && outcome.status === 502);
  assert.ok(!outcome.ok && outcome.code === "generation_refused");
  const noKey = await makeWeakScene(
    { ...ENV, CLAUDE_API_KEY: undefined },
    WeakSceneRequest.parse(BODY),
    { workshop: fakeWorkshop().workshop, store: fakeStore().store },
  );
  assert.ok(!noKey.ok && noKey.status === 503);
});

// ---------- 設定 ----------

test("wrangler.jsonc: 本番は苦手の場面を on・プレビューは off、作る所の Durable Object を v6 で足し、部品の引き方は既定で一覧", () => {
  const text = readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  );
  const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(config.vars.WEAK_SCENE_GENERATION, "on");
  assert.equal(config.previews.vars.WEAK_SCENE_GENERATION, "off");
  for (const key of ["WEAK_SCENE_IP_PER_HOUR", "WEAK_SCENE_DAILY_LIMIT"]) {
    assert.match(config.vars[key], /^[1-9]\d*$/, key);
  }
  assert.equal(config.vars.SCENE_PART_LOOKUP, "list");
  for (const bindings of [
    config.durable_objects.bindings,
    config.previews.durable_objects.bindings,
  ]) {
    assert.ok(
      bindings.some(
        (b: { name: string; class_name: string }) =>
          b.name === "WEAK_SCENE_MAKER" && b.class_name === "WeakSceneMaker",
      ),
    );
  }
  const v6 = config.migrations.find((m: { tag: string }) => m.tag === "v6");
  assert.deepEqual(v6?.new_sqlite_classes, ["WeakSceneMaker"]);
});

test("作る Durable Object が落ちたら（CPU の上限など）502 generation_failed", async () => {
  const { usage } = fakeUsage();
  const routes = makeWeakSceneRoutes({ usage: () => usage });
  const res = await post(routes, BODY, {
    ...ENV,
    WEAK_SCENE_MAKER: {
      newUniqueId: () => "id",
      get: () => ({
        make: async () => {
          throw new Error("Worker exceeded CPU time limit.");
        },
      }),
    },
  });
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "generation_failed");
});
