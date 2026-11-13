// 作り置きの場面をまとめて作るスクリプト（scripts/make-pool-v2.ts）のテスト。Claude は呼ばず、create を差し替える
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import {
  makePool,
  type PoolLog,
  type PoolOptions,
  parseArgs,
  poolSceneId,
  usdOf,
} from "../scripts/make-pool-v2";
import { THEMES } from "../src/scenes/generate";
import { EXAMPLE_ANSWER, EXAMPLE_ITEMS } from "../src/scenes/generate-v2";
import { PARTS } from "../src/scenes/parts";
import { verifyScene } from "../src/scenes/verify";

// 1 回の呼び出しが 0.1 ドルになる usage（入力 5 万トークン）
const USAGE = { input_tokens: 50_000, output_tokens: 0 };
const message = (body: unknown, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text: JSON.stringify(body) }],
  usage: USAGE,
});
const SENTENCES = () => message(EXAMPLE_ANSWER);
const ITEMS = () => message({ items: EXAMPLE_ITEMS });
// 細部が 1 つ足りない英文（裏取りで落ちる）
const BAD = () =>
  message({
    ...EXAMPLE_ANSWER,
    checklist: EXAMPLE_ANSWER.checklist.slice(0, 5),
  });

/** 決めた順に応答（か例外）を返す create。user の文を覚える */
const fake = (steps: (() => unknown)[]) => {
  const users: string[] = [];
  const create = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    users.push(params.messages[0].content as string);
    const step = steps[users.length - 1];
    if (!step) throw new Error("呼びすぎ");
    return step();
  };
  return { create: create as never, users };
};

const run = async (
  steps: (() => unknown)[],
  over: Partial<PoolOptions> = {},
  out = mkdtempSync(join(tmpdir(), "make-pool-v2-")),
) => {
  const f = fake(steps);
  const lines: string[] = [];
  const log = await makePool(
    { out, count: 2, grades: ["eiken-pre2"], maxUsd: 3, start: 0, ...over },
    {
      env: { CLAUDE_API_KEY: "test" },
      create: f.create,
      now: () => 0,
      print: (line) => lines.push(line),
    },
  );
  const saved = JSON.parse(
    readFileSync(join(out, "log.json"), "utf8"),
  ) as PoolLog;
  return { log, saved, out, users: f.users, lines };
};
const files = (out: string) =>
  readdirSync(out)
    .filter((f) => f !== "log.json")
    .sort();

test("id は gen-v2-<級>-<テーマ>-<連番>。今の作り置き（gen- ＋ 10 文字）と重ならない", () => {
  assert.equal(poolSceneId("eiken-3", THEMES[0], 1), "gen-v2-eiken3-park-01");
  assert.equal(
    poolSceneId("eiken-pre2", THEMES[10], 11),
    "gen-v2-pre2-bus-stop-11",
  );
  assert.equal(
    poolSceneId("eiken-2", THEMES[3], 4),
    "gen-v2-eiken2-train-station-04",
  );
  assert.equal(
    poolSceneId("eiken-2", "遊園地", 100),
    "gen-v2-eiken2-scene-100",
  );
  const ids = new Set(
    (["eiken-3", "eiken-pre2", "eiken-2"] as const).flatMap((g) =>
      Array.from({ length: 24 }, (_, i) =>
        poolSceneId(g, THEMES[i % THEMES.length], i + 1),
      ),
    ),
  );
  assert.equal(ids.size, 72);
  for (const id of ids) {
    assert.match(id, /^gen-v2-[a-z0-9-]+-\d{2}$/);
    assert.doesNotMatch(id, /^gen-[0-9a-z]{10}$/);
  }
});

test("通った場面を /2 の配置の JSON で書き、試行を log.json に残す", async () => {
  const { log, saved, out, users } = await run([
    SENTENCES,
    ITEMS,
    SENTENCES,
    ITEMS,
  ]);
  assert.deepEqual(files(out), [
    "gen-v2-pre2-cafe-02.json",
    "gen-v2-pre2-park-01.json",
  ]);
  const scene = JSON.parse(
    readFileSync(join(out, "gen-v2-pre2-park-01.json"), "utf8"),
  );
  assert.equal(scene.protocol, "scenenglish.scene/2");
  assert.equal(scene.id, "gen-v2-pre2-park-01");
  assert.equal(scene.difficulty, "eiken-pre2");
  assert.deepEqual(Object.keys(scene), [
    "protocol",
    "id",
    "name",
    "difficulty",
    "description",
    "checklist",
    "items",
  ]);
  assert.ok(
    scene.items.every((i: { position: number[] }) => i.position.length === 3),
  );
  // 書いた場面は、読み戻しても裏取りを通る
  assert.deepEqual(verifyScene("eiken-pre2", scene, PARTS), []);

  assert.deepEqual(saved, log);
  assert.deepEqual(
    log.attempts.map((a) => [a.id, a.theme, a.result, a.calls, a.remakes]),
    [
      ["gen-v2-pre2-park-01", THEMES[0], "passed", 2, 0],
      ["gen-v2-pre2-cafe-02", THEMES[1], "passed", 2, 0],
    ],
  );
  assert.ok(Math.abs(log.attempts[0].usd - 0.2) < 1e-9);
  assert.ok(Math.abs(log.usd - 0.4) < 1e-9);
  assert.equal(log.stopped, false);
  assert.deepEqual(
    log.summary.map((s) => [s.grade, s.tried, s.passed, s.rejected, s.error]),
    [["eiken-pre2", 2, 2, 0, 0]],
  );

  // テーマを順に回し、2 つ目には 1 つ目の要約を渡す
  assert.ok(users[0].includes(`テーマ: ${THEMES[0]}`));
  assert.ok(!users[0].includes("Scenes already made"));
  assert.ok(users[2].includes(`テーマ: ${THEMES[1]}`));
  assert.ok(users[2].includes("- 雨のバス停: a girl is holding an umbrella;"));
});

test("落ちた場面は書かずに理由を記録し、止まらずに次へ進む", async () => {
  const { log, out, lines } = await run([BAD, BAD, BAD, SENTENCES, ITEMS]);
  assert.deepEqual(files(out), ["gen-v2-pre2-cafe-02.json"]);
  const [first, second] = log.attempts;
  assert.equal(first.result, "rejected");
  assert.equal(first.calls, 3);
  assert.equal(first.remakes, undefined);
  // 回ごとの理由（code と文）
  assert.equal(first.rejected.length, 3);
  assert.deepEqual(first.rejected[0], [
    {
      code: "kind_count",
      stage: "sentences",
      message: "checklist の detail が 1 個ある。eiken-pre2 は 2 個",
    },
  ]);
  assert.ok(Math.abs(first.usd - 0.3) < 1e-9);
  assert.equal(second.result, "passed");
  assert.deepEqual(
    log.summary.map((s) => [s.tried, s.passed, s.rejected]),
    [[2, 1, 1]],
  );
  // 落ちた場面は、次の場面の avoid に入れない
  assert.ok(lines.some((l) => l.includes("落ちた（kind_count）")));
  assert.ok(lines.some((l) => l.startsWith("| eiken-pre2 | 2 | 1 | 1 | 0 |")));
});

test("作り直して通った場面は、作り直しの数と前の回の理由を残す", async () => {
  const { log } = await run([BAD, SENTENCES, ITEMS], { count: 1 });
  const [a] = log.attempts;
  assert.deepEqual([a.result, a.remakes, a.calls], ["passed", 1, 3]);
  assert.equal(a.rejected[0][0].code, "kind_count");
});

test("API の失敗も記録して次へ進む", async () => {
  const { log, out } = await run([
    () => {
      throw new Anthropic.RateLimitError(429, {}, "rate", new Headers());
    },
    SENTENCES,
    ITEMS,
  ]);
  assert.deepEqual(
    log.attempts.map((a) => a.result),
    ["error", "passed"],
  );
  assert.equal(
    log.attempts[0].error,
    "unavailable: Claude の API が失敗した（429）",
  );
  assert.equal(log.attempts[0].calls, 1);
  assert.equal(log.summary[0].error, 1);
  assert.deepEqual(files(out), ["gen-v2-pre2-cafe-02.json"]);
});

test("費用の上限に達したら、次の場面を作らずに止まる（ほかの級にも進まない）", async () => {
  // 1 場面 0.2 ドル。上限 0.3 ドルなら 2 場面目の後で止まる
  const { log, out, users, lines } = await run(
    [SENTENCES, ITEMS, SENTENCES, ITEMS],
    { count: 5, grades: ["eiken-pre2", "eiken-2"], maxUsd: 0.3 },
  );
  assert.equal(log.stopped, true);
  assert.equal(users.length, 4);
  assert.equal(log.attempts.length, 2);
  assert.equal(files(out).length, 2);
  assert.deepEqual(
    log.summary.map((s) => [s.grade, s.tried]),
    [
      ["eiken-pre2", 2],
      ["eiken-2", 0],
    ],
  );
  assert.ok(lines.some((l) => l.includes("費用が上限に達した")));
  assert.ok(lines.at(-1)?.includes("上限で止めた"));
  // 上限が 0 なら 1 つも作らない
  const none = await run([], { maxUsd: 0 });
  assert.equal(none.users.length, 0);
  assert.equal(none.log.stopped, true);
});

test("開始番号: テーマと連番をそこから回し、元からある場面は飛ばして avoid に入れる", async () => {
  const first = await run([SENTENCES, ITEMS], { count: 1 });
  // 同じ出力に、番号 0 からもう一度（1 つ目は飛ばす）
  const again = await run([SENTENCES, ITEMS], { count: 2 }, first.out);
  assert.deepEqual(
    again.log.attempts.map((a) => [a.id, a.result]),
    [
      ["gen-v2-pre2-park-01", "skipped"],
      ["gen-v2-pre2-cafe-02", "passed"],
    ],
  );
  assert.equal(again.log.summary[0].tried, 1);
  assert.ok(again.users[0].includes("Scenes already made"));
  // 続きを作る: 開始番号 12 なら、テーマは一周して公園、連番は 13
  const more = await run(
    [SENTENCES, ITEMS],
    { count: 1, start: 12 },
    first.out,
  );
  assert.equal(more.log.attempts[0].id, "gen-v2-pre2-park-13");
  assert.equal(more.log.attempts[0].theme, THEMES[0]);
  // 読めない JSON があっても止まらない
  writeFileSync(join(first.out, "gen-v2-pre2-broken-99.json"), "{");
  const ok = await run([SENTENCES, ITEMS], { count: 1, start: 20 }, first.out);
  assert.equal(ok.log.attempts[0].result, "passed");
});

test("級を省けば 3 つとも、級ごとに連番を付ける", async () => {
  const { log } = await run(Array(6).fill(BAD), {
    count: 1,
    grades: ["eiken-3", "eiken-2"],
  });
  assert.deepEqual(
    log.attempts.map((a) => a.id),
    ["gen-v2-eiken3-park-01", "gen-v2-eiken2-park-01"],
  );
});

test("引数: 既定は級ごとに 12・3 つの級・上限 3 ドル・開始番号 0", () => {
  assert.deepEqual(parseArgs(["out"]), {
    out: "out",
    count: 12,
    grades: ["eiken-3", "eiken-pre2", "eiken-2"],
    maxUsd: 3,
    start: 0,
  });
  assert.deepEqual(
    parseArgs([
      "--count",
      "5",
      "dir",
      "--grade",
      "eiken-2,eiken-3",
      "--grade",
      "eiken-pre2",
      "--max-usd",
      "1.5",
      "--start",
      "12",
    ]),
    {
      out: "dir",
      count: 5,
      grades: ["eiken-2", "eiken-3", "eiken-pre2"],
      maxUsd: 1.5,
      start: 12,
    },
  );
  for (const bad of [
    [],
    ["a", "b"],
    ["a", "--count", "0"],
    ["a", "--count", "1.5"],
    ["a", "--grade", "easy"],
    ["a", "--max-usd"],
    ["a", "--seed", "1"],
  ]) {
    assert.throws(() => parseArgs(bad), Error, bad.join(" "));
  }
});

test("費用: 入力・キャッシュ・出力のトークンから出す", () => {
  assert.ok(
    Math.abs(
      usdOf({
        input_tokens: 1000,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 10_000,
        output_tokens: 500,
      } as Anthropic.Usage) -
        (1000 * 2 + 2000 * 2.5 + 10_000 * 0.2 + 500 * 10) / 1e6,
    ) < 1e-12,
  );
});
