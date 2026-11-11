// 2 段の場面の生成（src/scenes/generate-v2.ts）のテスト。Claude は呼ばず、create を差し替える
import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  SCENE_RULES,
  SceneGenerationError,
  THEMES,
} from "../src/scenes/generate";
import {
  buildItemsSystem,
  buildSentenceSystem,
  candidates,
  EXAMPLE_ITEMS,
  EXAMPLE_SENTENCES,
  generateItems,
  generateSceneV2,
  generateSentences,
  generateVerifiedScene,
  gradeRules,
  itemsMessage,
  itemsOnlySchema,
  MAX_REMAKES,
  SceneResponseError,
  SceneVerificationError,
  sentenceMessage,
  sentenceSchema,
  verbLimits,
} from "../src/scenes/generate-v2";
import { GRADES } from "../src/scenes/grades";
import { PARTS } from "../src/scenes/parts";
import { GRADE_IDS, type Part } from "../src/scenes/types";
import { reasonSeeds, summarizeScene } from "../src/scenes/variety";

const ENV = { CLAUDE_API_KEY: "test" };
const USAGE = { input_tokens: 1, output_tokens: 1 };
const message = (body: unknown, stop_reason = "end_turn") => ({
  stop_reason,
  content: [
    {
      type: "text",
      text: typeof body === "string" ? body : JSON.stringify(body),
    },
  ],
  usage: USAGE,
});
const SENTENCES = () => message(EXAMPLE_SENTENCES);
const ITEMS = () => message({ items: EXAMPLE_ITEMS });

/** 決めた順に応答（か例外）を返す create。渡された引数を覚える */
const fake = (steps: (() => unknown)[]) => {
  const calls: {
    params: Anthropic.MessageCreateParamsNonStreaming;
    timeout: number;
    signal?: AbortSignal;
  }[] = [];
  const create = async (
    params: Anthropic.MessageCreateParamsNonStreaming,
    options: { timeout: number; signal?: AbortSignal },
  ) => {
    calls.push({ params, timeout: options.timeout, signal: options.signal });
    const step = steps[calls.length - 1];
    if (!step) throw new Error("呼びすぎ");
    return step();
  };
  return { create: create as never, calls };
};

const systemOf = (c: { params: Anthropic.MessageCreateParamsNonStreaming }) =>
  (c.params.system as Anthropic.TextBlockParam[])[0];
const userOf = (c: { params: Anthropic.MessageCreateParamsNonStreaming }) =>
  c.params.messages[0].content as string;
// 1 回目か 2 回目かは、書かせる形で見分ける
const stageOf = (c: { params: Anthropic.MessageCreateParamsNonStreaming }) => {
  const format = c.params.output_config?.format as unknown as {
    schema: { required: string[] };
  };
  return format.schema.required.includes("items") ? "items" : "sentences";
};
const INPUT = { grade: "eiken-pre2", theme: "バス停" } as const;

test("級の規則の表は級の定数から作る（人の数・文の数・checklist の数・文法）", () => {
  const rules = gradeRules();
  for (const id of GRADE_IDS) {
    const g = GRADES[id];
    assert.ok(rules.includes(`## ${id} (CEFR ${g.cefr})`));
    assert.ok(rules.includes(`exactly ${g.sentences} sentences`));
    assert.ok(rules.includes(`about ${g.words} words`));
    for (const item of g.grammar) assert.ok(rules.includes(item), item);
  }
  assert.ok(rules.includes("- People: 1-2 people or animals"));
  assert.ok(rules.includes("- People: 3 people or animals"));
  assert.ok(rules.includes("- People: 3-4 people or animals"));
  assert.ok(
    rules.includes("- checklist: exactly 3 items: 2 center, 1 detail."),
  );
  assert.ok(rules.includes("only verbs marked A1 in the list of actions"));
  assert.ok(rules.includes("only verbs marked A1, A2, B1 in the list"));
  assert.ok(
    rules.includes(
      "- checklist: exactly 6 items: 3 center, 1 reason, 2 detail.",
    ),
  );
  assert.ok(
    rules.includes(
      "- checklist: exactly 8 items: 4 center, 1 reason, 1 link, 2 detail.",
    ),
  );
});

test("1 回目の指示: 級の表・語彙・テーマ・例があり、部品の一覧は無い", () => {
  const system = buildSentenceSystem(PARTS);
  assert.ok(system.includes(gradeRules()));
  for (const t of THEMES) assert.ok(system.includes(t), `${t} が無い`);
  assert.ok(system.includes("- run | run A1"));
  assert.ok(system.includes("rain (雨)"));
  assert.ok(system.includes(JSON.stringify(EXAMPLE_SENTENCES)));
  // 決定のとおりの決まり
  assert.ok(system.includes("Every accept must be found in the description"));
  assert.ok(system.includes("The cause must be visible in the scene"));
  // 実測で見つかった崩れへの決まり
  assert.ok(system.includes("Never return an empty or shorter checklist"));
  assert.ok(system.includes("One person, one action"));
  assert.ok(system.includes("One item, one fact"));
  assert.ok(system.includes("A feeling, a wish or a plan is not a cause"));
  assert.ok(system.includes("Bad reasons and links"));
  assert.ok(system.includes("A bag is on the ground so the boy is running"));
  // 似た場面ばかりにならないための決まり
  assert.ok(system.includes(reasonSeeds(PARTS)));
  assert.ok(system.includes("Do not make every scene about the same cause"));
  assert.ok(system.includes("This example only shows the form of the answer"));
  assert.ok(!system.includes("Good reason:"));
  // 絵で見つかった崩れへの決まり
  assert.ok(system.includes("only a woman or a man can drink"));
  assert.ok(system.includes("Rain only falls in outdoor scenes"));
  assert.ok(system.includes("never he, she, it or they"));
  assert.ok(system.includes("never a piece of a sentence"));
  assert.ok(system.includes("Do not write it as a second, separate thing"));
  assert.ok(system.includes("eiken-3 uses only verbs marked A1"));
  assert.ok(system.includes(verbLimits(PARTS)));
  assert.ok(verbLimits(PARTS).includes("- eiken-3: "));
  assert.ok(/- eiken-3: .*\bstand\b.*\bthrow\b/.test(verbLimits(PARTS)));
  assert.ok(system.includes("two or more refs"));
  // 部品の ID は 1 つも出さない
  for (const p of PARTS.filter((x) => x.id.includes("_"))) {
    assert.ok(!system.includes(p.id), `${p.id} が出ている`);
  }
  assert.ok(!system.includes("# Parts"));
});

test("2 回目の指示: 今の生成の決まりをそのまま使い、候補の部品と例を載せる", () => {
  const system = buildItemsSystem(PARTS);
  assert.ok(system.includes(SCENE_RULES));
  for (const word of ["relate", "seat_at", "thrown_by", '"auto"']) {
    assert.ok(system.includes(word), `${word} の説明が無い`);
  }
  assert.ok(system.includes("Use every one of them, exactly once"));
  assert.ok(system.includes(JSON.stringify({ items: EXAMPLE_ITEMS })));
  for (const p of PARTS) assert.ok(system.includes(`- ${p.id} | `));
  // 候補を絞れば、一覧もその分だけになる
  const few = buildItemsSystem(PARTS.slice(0, 3));
  assert.ok(!few.includes(`- ${PARTS[3].id} | `));
});

test("指示の例は実在の部品だけで組み、例の級は eiken-pre2 の 1 つ", () => {
  const ids = new Set(PARTS.map((p) => p.id));
  for (const i of EXAMPLE_ITEMS) assert.ok(ids.has(i.part), i.part);
  assert.equal(buildSentenceSystem(PARTS).split("Request: 級:").length, 2);
  assert.ok(buildSentenceSystem(PARTS).includes("Request: 級: eiken-pre2"));
});

test("書かせる形: 1 回目は name・description・checklist、kind は級に出る種類だけ", () => {
  const schema = sentenceSchema("eiken-3");
  assert.deepEqual(Object.keys(schema.properties), [
    "name",
    "description",
    "checklist",
  ]);
  const item = schema.properties.checklist.items;
  assert.deepEqual(item.required, ["id", "kind", "label", "accept", "refs"]);
  assert.deepEqual(item.properties.kind.enum, ["center", "detail"]);
  assert.deepEqual(
    sentenceSchema("eiken-2").properties.checklist.items.properties.kind.enum,
    ["center", "reason", "link", "detail"],
  );
});

test("書かせる形: 2 回目は items だけで、部品の ID は候補の enum", () => {
  const schema = itemsOnlySchema(PARTS.slice(0, 2));
  assert.deepEqual(Object.keys(schema.properties), ["items"]);
  assert.deepEqual(
    schema.properties.items.items.properties.part.enum,
    PARTS.slice(0, 2).map((p) => p.id),
  );
});

test("user の文: 1 回目は級とテーマ、2 回目は 1 回目の出力の全部と呼び名の一覧", () => {
  assert.equal(
    sentenceMessage(INPUT),
    "級: eiken-pre2\nテーマ: バス停\nchecklist: 3 center, 1 reason, 2 detail（計 6 個）",
  );
  assert.equal(
    sentenceMessage({ grade: "eiken-3" }),
    "級: eiken-3\nテーマ: 一覧から選ぶ\nchecklist: 2 center, 1 detail（計 3 個）",
  );
  assert.equal(
    itemsMessage(INPUT, EXAMPLE_SENTENCES),
    `級: eiken-pre2\nScene: ${JSON.stringify(EXAMPLE_SENTENCES)}\nKeys: girl, boy, man, rain, bench`,
  );
  const again = sentenceMessage(INPUT, ["理由 1", "理由 2"]);
  assert.ok(again.startsWith(`${sentenceMessage(INPUT)}\n\n`));
  assert.ok(again.endsWith("- 理由 1\n- 理由 2"));
});

test("部品の候補は、今は全部の部品を返す", async () => {
  assert.equal(await candidates("A man is reading.", PARTS), PARTS);
});

test("2 段を順に呼ぶ: 1 回目 → 部品の候補 → 2 回目。呼び方は今の生成と同じ", async () => {
  const f = fake([SENTENCES, ITEMS]);
  const asked: string[] = [];
  let clock = 0;
  const result = await generateSceneV2(
    { ...ENV, CLAUDE_SCENE_MODEL: "m", CLAUDE_SCENE_EFFORT: "high" },
    PARTS,
    INPUT,
    {
      create: f.create,
      candidates: async (description, parts) => {
        asked.push(description);
        return parts.slice(0, 80);
      },
      // 呼ぶたびに 1 秒進む時計
      now: () => clock++ * 1000,
    },
  );
  assert.deepEqual(f.calls.map(stageOf), ["sentences", "items"]);
  assert.deepEqual(result.plan, { ...EXAMPLE_SENTENCES, items: EXAMPLE_ITEMS });
  assert.deepEqual(result.problems, []);
  assert.equal(result.model, "m");
  assert.equal(result.usage.length, 2);
  assert.deepEqual(result.ms, {
    sentences: 1000,
    candidates: 1000,
    items: 1000,
    total: 3000,
  });

  // 候補の関数には 1 回目の description を渡し、返った部品だけを 2 回目に渡す
  assert.deepEqual(asked, [EXAMPLE_SENTENCES.description]);
  const [first, second] = f.calls;
  assert.equal(systemOf(first).text, buildSentenceSystem(PARTS));
  assert.equal(systemOf(second).text, buildItemsSystem(PARTS.slice(0, 80)));
  assert.equal(userOf(first), sentenceMessage(INPUT));
  assert.equal(userOf(second), itemsMessage(INPUT, EXAMPLE_SENTENCES));

  for (const c of f.calls) {
    assert.equal(c.params.model, "m");
    assert.equal(c.params.max_tokens, 8000);
    assert.equal(c.params.output_config?.effort, "high");
    assert.equal(c.params.output_config?.format?.type, "json_schema");
    assert.deepEqual(systemOf(c).cache_control, { type: "ephemeral" });
    assert.equal(c.timeout, 60_000);
  }
});

test("1 回通すだけの関数は、裏取りで落ちても投げずに理由を返す", async () => {
  const items = EXAMPLE_ITEMS.filter((i) => i.key !== "bench");
  const f = fake([SENTENCES, () => message({ items })]);
  const result = await generateSceneV2(ENV, PARTS, INPUT, { create: f.create });
  assert.deepEqual(
    result.problems.map((p) => p.message),
    ["refs の bench（項目 man_sit）が items の key に無い"],
  );
  assert.equal(f.calls.length, 2);
});

test("モデルと effort の既定は今の生成と同じ（Sonnet 5.5 の low）", async () => {
  const f = fake([SENTENCES]);
  await generateSentences(ENV, PARTS, INPUT, { create: f.create });
  assert.equal(f.calls[0].params.model, "claude-sonnet-5-5");
  assert.equal(f.calls[0].params.output_config?.effort, "low");
});

test("キーが無ければ呼ばずに unavailable", async () => {
  const f = fake([]);
  await assert.rejects(
    generateSceneV2({}, PARTS, INPUT, { create: f.create }),
    (e) => e instanceof SceneGenerationError && e.kind === "unavailable",
  );
  assert.equal(f.calls.length, 0);
});

test("形が違う応答は、その段だけ 1 回やり直す", async () => {
  const f = fake([() => message("{}"), SENTENCES, () => message("{}"), ITEMS]);
  const result = await generateSceneV2(ENV, PARTS, INPUT, { create: f.create });
  assert.deepEqual(f.calls.map(stageOf), [
    "sentences",
    "sentences",
    "items",
    "items",
  ]);
  assert.deepEqual(result.problems, []);
});

test("kind が知らない値の応答は形が違う扱い。生の本文の先頭を持つ", async () => {
  const body = {
    ...EXAMPLE_SENTENCES,
    checklist: [{ ...EXAMPLE_SENTENCES.checklist[0], kind: "main" }],
  };
  const f = fake([() => message(body), () => message(body)]);
  await assert.rejects(
    generateSentences(ENV, PARTS, INPUT, { create: f.create }),
    (e) =>
      e instanceof SceneResponseError &&
      e.kind === "invalid" &&
      e.raw === JSON.stringify(body),
  );
  assert.equal(f.calls.length, 2);
  // 長い本文は先頭 500 文字だけ残す
  const long = fake([() => message("x".repeat(2000))]);
  await assert.rejects(
    generateSentences(
      ENV,
      PARTS,
      INPUT,
      { create: long.create },
      { maxAttempts: 1 },
    ),
    (e) => e instanceof SceneResponseError && e.raw === "x".repeat(500),
  );
});

test("checklist が空の応答は受け取り、裏取りが数の違いとして落とす", async () => {
  const empty = () => message({ ...EXAMPLE_SENTENCES, checklist: [] });
  const f = fake([empty, ITEMS]);
  const result = await generateSceneV2(ENV, PARTS, INPUT, { create: f.create });
  assert.deepEqual(
    result.problems.map((p) => p.message),
    [
      "checklist の center が 0 個ある。eiken-pre2 は 3 個",
      "checklist の reason が 0 個ある。eiken-pre2 は 1 個",
      "checklist の detail が 0 個ある。eiken-pre2 は 2 個",
    ],
  );
});

test("書かせる形: checklist と refs は空にさせない（minItems は 1 まで）", () => {
  const schema = sentenceSchema("eiken-2");
  assert.equal(schema.properties.checklist.minItems, 1);
  assert.equal(schema.properties.checklist.items.properties.refs.minItems, 1);
});

test("2 回目の部品の一覧には、人と動物のポーズで言える動詞（says）を出す", () => {
  const system = buildItemsSystem(PARTS);
  const line = (id: string) =>
    system.split("\n").find((l) => l.startsWith(`- ${id} | `)) ?? "";
  assert.ok(
    line("person_drink_woman_a").includes("| says: drink, have, stand |"),
  );
  assert.ok(
    line("person_wipe_woman_a").includes("| says: wipe, clean, stand |"),
  );
  assert.ok(!line("bench").includes("says:"));
  assert.ok(system.includes('a part whose "says" lists that verb'));
  assert.ok(system.includes("never change a woman into a man"));
});

test("断られたらやり直さず refused。2 回目は呼ばない", async () => {
  const f = fake([() => message("", "refusal")]);
  await assert.rejects(
    generateSceneV2(ENV, PARTS, INPUT, { create: f.create }),
    (e) => e instanceof SceneGenerationError && e.kind === "refused",
  );
  assert.equal(f.calls.length, 1);
});

test("timeout・回数・signal の上書きは両方の段に効く", async () => {
  const controller = new AbortController();
  const f = fake([SENTENCES, () => message("{}")]);
  await assert.rejects(
    generateSceneV2(
      ENV,
      PARTS,
      INPUT,
      { create: f.create },
      { timeoutMs: 10_000, maxAttempts: 1, signal: controller.signal },
    ),
    (e) => e instanceof SceneGenerationError && e.kind === "invalid",
  );
  assert.deepEqual(
    f.calls.map((c) => [c.timeout, c.signal]),
    [
      [10_000, controller.signal],
      [10_000, controller.signal],
    ],
  );
});

test("2 回目だけを呼ぶ関数は、渡した部品と英文で呼ぶ", async () => {
  const f = fake([ITEMS]);
  const few: Part[] = PARTS.slice(0, 100);
  const result = await generateItems(ENV, few, INPUT, EXAMPLE_SENTENCES, {
    create: f.create,
  });
  assert.deepEqual(result.items, EXAMPLE_ITEMS);
  assert.equal(systemOf(f.calls[0]).text, buildItemsSystem(few));
});

// ここから作り置きの道（裏取りで落ちたら理由を足して 2 回まで作り直す）

test("作り置き: 1 回で裏取りを通れば作り直さない", async () => {
  const f = fake([SENTENCES, ITEMS]);
  const result = await generateVerifiedScene(ENV, PARTS, INPUT, {
    create: f.create,
  });
  assert.equal(result.remakes, 0);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.plan, { ...EXAMPLE_SENTENCES, items: EXAMPLE_ITEMS });
  assert.equal(result.usage.length, 2);
});

test("作り置き: 部品だけで落ちたら、同じ英文のまま 2 回目だけを理由つきで作り直す", async () => {
  const bad = () =>
    message({ items: EXAMPLE_ITEMS.filter((i) => i.key !== "bench") });
  const f = fake([SENTENCES, bad, ITEMS]);
  const result = await generateVerifiedScene(ENV, PARTS, INPUT, {
    create: f.create,
  });
  assert.deepEqual(f.calls.map(stageOf), ["sentences", "items", "items"]);
  assert.equal(result.remakes, 1);
  assert.equal(result.rejected.length, 1);
  const again = userOf(f.calls[2]);
  assert.ok(again.startsWith(itemsMessage(INPUT, EXAMPLE_SENTENCES)));
  assert.ok(
    again.endsWith("- refs の bench（項目 man_sit）が items の key に無い"),
  );
  // 最初の回の指示には理由が無い
  assert.equal(userOf(f.calls[1]), itemsMessage(INPUT, EXAMPLE_SENTENCES));
});

test("作り置き: 英文で落ちたら 2 回目を呼ばず、理由つきで 1 回目から作り直す", async () => {
  const bad = () =>
    message({
      ...EXAMPLE_SENTENCES,
      checklist: EXAMPLE_SENTENCES.checklist.slice(0, 5),
    });
  const f = fake([bad, SENTENCES, ITEMS]);
  const result = await generateVerifiedScene(ENV, PARTS, INPUT, {
    create: f.create,
  });
  assert.deepEqual(f.calls.map(stageOf), ["sentences", "sentences", "items"]);
  assert.equal(result.remakes, 1);
  assert.ok(
    userOf(f.calls[1]).endsWith(
      "- checklist の detail が 1 個ある。eiken-pre2 は 2 個",
    ),
  );
  // 英文を書き直した後の 2 回目には、前の理由を渡さない
  assert.equal(userOf(f.calls[2]), itemsMessage(INPUT, EXAMPLE_SENTENCES));
});

test("作り置き: 動詞が級を超えたら（英文の理由）、1 回目から作り直す", async () => {
  // 3級として作ると、hold（A2）は中心に使えない
  const easy = {
    name: "雨",
    description:
      "A girl is holding an umbrella. A boy is running. It is raining.",
    checklist: [
      { ...EXAMPLE_SENTENCES.checklist[0] },
      { ...EXAMPLE_SENTENCES.checklist[1], accept: "a boy is running" },
      { ...EXAMPLE_SENTENCES.checklist[4] },
    ],
  };
  const fixed = {
    ...easy,
    description:
      "A girl is sharing an umbrella. A boy is running. It is raining.",
    checklist: [
      { ...easy.checklist[0], accept: "a girl is sharing an umbrella" },
      easy.checklist[1],
      easy.checklist[2],
    ],
  };
  // 3級は 1〜2 人。女の子と男の子だけを置く
  const two = () =>
    message({
      items: EXAMPLE_ITEMS.filter((i) => !["man", "bench"].includes(i.key)).map(
        (i) =>
          i.key === "girl"
            ? { ...i, place: { relation: "ground", zone: "center" } }
            : { ...i, motion: undefined },
      ),
    });
  const f = fake([() => message(easy), two, () => message(fixed), two]);
  const result = await generateVerifiedScene(
    ENV,
    PARTS,
    { grade: "eiken-3" },
    { create: f.create },
  );
  assert.deepEqual(f.calls.map(stageOf), [
    "sentences",
    "items",
    "sentences",
    "items",
  ]);
  assert.equal(result.remakes, 1);
  assert.equal(result.rejected[0][0].code, "verb_level");
  assert.ok(userOf(f.calls[2]).includes("hold は A2"));
  assert.equal(result.plan.description, fixed.description);
});

test("作り置き: 同じ英文で部品が 2 回落ちたら、1 回目から作り直す", async () => {
  const bad = () =>
    message({ items: EXAMPLE_ITEMS.filter((i) => i.key !== "bench") });
  const f = fake([SENTENCES, bad, bad, SENTENCES, ITEMS]);
  const result = await generateVerifiedScene(ENV, PARTS, INPUT, {
    create: f.create,
  });
  assert.deepEqual(f.calls.map(stageOf), [
    "sentences",
    "items",
    "items",
    "sentences",
    "items",
  ]);
  assert.equal(result.remakes, MAX_REMAKES);
  assert.equal(result.usage.length, 5);
});

test("作り置き: 2 回作り直しても通らなければ、最後の理由を持った例外を投げる", async () => {
  assert.equal(MAX_REMAKES, 2);
  const bad = () =>
    message({
      ...EXAMPLE_SENTENCES,
      checklist: EXAMPLE_SENTENCES.checklist.slice(0, 5),
    });
  const f = fake([bad, bad, bad]);
  await assert.rejects(
    generateVerifiedScene(ENV, PARTS, INPUT, { create: f.create }),
    (e) =>
      e instanceof SceneVerificationError &&
      e.kind === "invalid" &&
      e.problems[0].code === "kind_count" &&
      e.message.includes("checklist の detail が 1 個ある"),
  );
  assert.equal(f.calls.length, 3);
});

test("作り置き: 断られた・API の失敗は作り直さずそのまま投げる", async () => {
  const f = fake([SENTENCES, () => message("", "refusal")]);
  await assert.rejects(
    generateVerifiedScene(ENV, PARTS, INPUT, { create: f.create }),
    (e) =>
      e instanceof SceneGenerationError &&
      !(e instanceof SceneVerificationError) &&
      e.kind === "refused",
  );
  assert.equal(f.calls.length, 2);
});

test("作り置き: 部品の候補は、英文が決まるたびに選び直す", async () => {
  const asked: string[] = [];
  const bad = () =>
    message({ items: EXAMPLE_ITEMS.filter((i) => i.key !== "bench") });
  const f = fake([SENTENCES, bad, ITEMS]);
  await generateVerifiedScene(ENV, PARTS, INPUT, {
    create: f.create,
    candidates: async (description, parts) => {
      asked.push(description);
      return parts;
    },
  });
  // 同じ英文で 2 回目だけを作り直すときは、選び直さない
  assert.deepEqual(asked, [EXAMPLE_SENTENCES.description]);
});

test("作り置き: checklist が空なら、2 回目を呼ばずに理由つきで 1 回目から作り直す", async () => {
  const empty = () => message({ ...EXAMPLE_SENTENCES, checklist: [] });
  const f = fake([empty, SENTENCES, ITEMS]);
  const result = await generateVerifiedScene(ENV, PARTS, INPUT, {
    create: f.create,
  });
  assert.deepEqual(f.calls.map(stageOf), ["sentences", "sentences", "items"]);
  assert.equal(result.remakes, 1);
  assert.deepEqual(
    result.rejected[0].map((p) => p.code),
    ["kind_count", "kind_count", "kind_count"],
  );
  assert.ok(
    userOf(f.calls[1]).includes(
      "- checklist の center が 0 個ある。eiken-pre2 は 3 個",
    ),
  );
});

test("作り置き: 形が違う応答が続いても（段の中のやり直しの後）、1 回目から作り直す", async () => {
  const broken = () => message("{");
  const f = fake([broken, broken, SENTENCES, ITEMS]);
  const result = await generateVerifiedScene(ENV, PARTS, INPUT, {
    create: f.create,
  });
  assert.deepEqual(f.calls.map(stageOf), [
    "sentences",
    "sentences",
    "sentences",
    "items",
  ]);
  assert.equal(result.remakes, 1);
  assert.equal(result.rejected[0][0].code, "invalid_response");
  assert.ok(userOf(f.calls[2]).includes("前の応答は使えなかった"));
});

test("作り置き: 2 回目が途中で止まったら、同じ英文のまま 2 回目を作り直す", async () => {
  const cut = () => message({ items: [] }, "max_tokens");
  const f = fake([SENTENCES, cut, cut, ITEMS]);
  const result = await generateVerifiedScene(ENV, PARTS, INPUT, {
    create: f.create,
  });
  assert.deepEqual(f.calls.map(stageOf), [
    "sentences",
    "items",
    "items",
    "items",
  ]);
  assert.equal(result.remakes, 1);
  assert.deepEqual(result.rejected[0][0], {
    code: "invalid_response",
    stage: "items",
    message:
      "前の応答は使えなかった（Claude が途中で止まった（max_tokens））。決まった形で、全部の欄を最後まで書く",
  });
});

test("作り置き: 形が違う応答が最後まで続けば、その理由を持った例外を投げる", async () => {
  const broken = () => message("{");
  const f = fake(Array(6).fill(broken));
  await assert.rejects(
    generateVerifiedScene(ENV, PARTS, INPUT, { create: f.create }),
    (e) =>
      e instanceof SceneVerificationError &&
      e.problems[0].code === "invalid_response",
  );
  assert.equal(f.calls.length, 6);
});

test("すでに作った場面の要約を渡すと、1 回目に「これらと違う場面にする」と指示する", async () => {
  const avoid = [summarizeScene(EXAMPLE_SENTENCES), "公園: a dog is running"];
  const text = sentenceMessage({ ...INPUT, avoid });
  assert.ok(text.startsWith(`${sentenceMessage(INPUT)}\n\n`));
  assert.ok(text.includes("clearly different from all of them"));
  assert.ok(
    text.endsWith(
      "- 雨のバス停: a girl is holding an umbrella; a boy is running; a man is reading a book | reason: a boy is running to the bus stop because it is raining\n- 公園: a dog is running",
    ),
  );
  // 空なら何も足さない
  assert.equal(
    sentenceMessage({ ...INPUT, avoid: [] }),
    sentenceMessage(INPUT),
  );

  // 作り置きの道でも 1 回目に渡り、作り直しの理由はその後ろに付く。2 回目には渡さない
  const bad = () =>
    message({
      ...EXAMPLE_SENTENCES,
      checklist: EXAMPLE_SENTENCES.checklist.slice(0, 5),
    });
  const f = fake([bad, SENTENCES, ITEMS]);
  await generateVerifiedScene(
    ENV,
    PARTS,
    { ...INPUT, avoid },
    { create: f.create },
  );
  assert.equal(userOf(f.calls[0]), text);
  assert.ok(userOf(f.calls[1]).startsWith(`${text}\n\n`));
  assert.ok(userOf(f.calls[1]).includes("rejected by the checking program"));
  assert.equal(userOf(f.calls[2]), itemsMessage(INPUT, EXAMPLE_SENTENCES));
});

test("作り置き: その人にできない動作は、2 回目を呼ばずに 1 回目から作り直す", async () => {
  const girl = {
    ...EXAMPLE_SENTENCES,
    description: `A girl is drinking from a cup. ${EXAMPLE_SENTENCES.description}`,
    checklist: EXAMPLE_SENTENCES.checklist.map((c) =>
      c.id === "girl_umbrella"
        ? { ...c, accept: "a girl is drinking from a cup" }
        : c,
    ),
  };
  const f = fake([() => message(girl), SENTENCES, ITEMS]);
  const result = await generateVerifiedScene(ENV, PARTS, INPUT, {
    create: f.create,
  });
  assert.deepEqual(f.calls.map(stageOf), ["sentences", "sentences", "items"]);
  assert.equal(result.rejected[0][0].code, "who_cannot");
  assert.ok(userOf(f.calls[1]).includes("girl にできる動作に drink が無い"));
});

test("2 回目の指示: 持っている物を別に置かない・雨は屋外だけ", () => {
  const system = buildItemsSystem(PARTS);
  assert.ok(system.includes("never add it as a separate item"));
  assert.ok(
    system.includes("never put rain in a scene whose ground is a floor_ part"),
  );
  assert.ok(system.includes("| holds: umbrella |"));
});

test("作り置き: 場所の食い違い（座標に直して分かる）は、同じ英文のまま 2 回目だけ作り直す", async () => {
  const street = {
    name: "道",
    description:
      "A woman is sitting on the sidewalk. A girl is waiting. There is a bicycle next to the woman.",
    checklist: [
      {
        id: "fall",
        kind: "center",
        label: "転んだ",
        accept: "a woman is sitting on the sidewalk",
        refs: ["woman", "sidewalk"],
      },
      {
        id: "wait",
        kind: "center",
        label: "待つ",
        accept: "a girl is waiting",
        refs: ["girl"],
      },
      {
        id: "bike",
        kind: "detail",
        label: "自転車",
        accept: "there is a bicycle next to the woman",
        refs: ["bicycle", "woman"],
      },
    ],
  };
  const items = (zone: string) => () =>
    message({
      items: [
        {
          key: "sidewalk",
          part: "sidewalk_stone",
          place: { relation: "ground" },
        },
        {
          key: "road",
          part: "road_patch",
          place: { relation: "ground", zone: "back" },
        },
        {
          key: "woman",
          part: "person_fallen_woman_a",
          place: { relation: "ground", zone },
        },
        {
          key: "bicycle",
          part: "bicycle_down",
          place: { relation: "next_to", target: "woman" },
        },
        {
          key: "girl",
          part: "person_stand_girl_a",
          place: { relation: "ground", zone: "front_left" },
        },
      ],
    });
  const f = fake([() => message(street), items("center"), items("front")]);
  const result = await generateVerifiedScene(
    ENV,
    PARTS,
    { grade: "eiken-3" },
    { create: f.create },
  );
  assert.deepEqual(f.calls.map(stageOf), ["sentences", "items", "items"]);
  assert.equal(result.rejected[0][0].code, "place_mismatch");
  assert.ok(userOf(f.calls[2]).includes("woman を sidewalk の上に置く"));
});

test("指示: 写した accept・壁の物・場所・detail の決まり", () => {
  const first = buildSentenceSystem(PARTS);
  assert.ok(first.includes("letter for letter"));
  assert.ok(first.includes("Nothing can hang on a wall"));
  assert.ok(first.includes("Never start an accept with he, she or they"));
  assert.ok(
    first.includes("never repeat the accept of a center item as a detail"),
  );
  assert.ok(first.includes("the same action as in that person's center item"));
  const second = buildItemsSystem(PARTS);
  assert.ok(second.includes("do not use clock"));
  assert.ok(second.includes("people on the sidewalk go in a front zone"));
});
