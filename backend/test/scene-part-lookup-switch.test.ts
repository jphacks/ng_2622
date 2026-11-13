// SCENE_PART_LOOKUP（部屋のスタート・作り置きの生成の 2 回目の引き方）のテスト。
// convention でも、部品をその場で作るのは苦手の場面だけで、ここでは作らない
import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildConventionItemsSystem,
  buildItemsSystem,
  EXAMPLE_ANSWER,
  EXAMPLE_GRADE,
  EXAMPLE_ITEMS,
  SceneVerificationError,
} from "../src/scenes/generate-v2";
import { PARTS } from "../src/scenes/parts";
import { generateSceneWithParts } from "../src/usecases/scenes";

const message = (body: unknown) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(body) }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
const fakeClaude = (replies: unknown[]) => {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    calls.push(params);
    const reply = replies[calls.length - 1];
    if (!reply) throw new Error("呼びすぎ");
    return reply;
  };
  return { create: create as never, calls };
};
const systemOf = (p: Anthropic.MessageCreateParamsNonStreaming) =>
  (p.system as Anthropic.TextBlockParam[])[0].text;

const ENV = {
  CLAUDE_API_KEY: "test",
  SCENE_GENERATION: "on",
  SCENE_PART_LOOKUP: "convention",
};
const LAMP = {
  id: "lamp_street",
  category: "thing",
  label: "街灯",
  words: ["lamp"],
  size: { width: 0.4, height: 3, depth: 0.4 },
  description: "A tall black street lamp.",
  top: false,
};

test("SCENE_PART_LOOKUP が convention なら 2 回目は規約で引くが、同梱の部品だけで組み、id@版 は出さない", async () => {
  const { create, calls } = fakeClaude([
    message(EXAMPLE_ANSWER),
    message({ items: EXAMPLE_ITEMS, newParts: [] }),
  ]);
  const made = await generateSceneWithParts(
    ENV,
    { grade: EXAMPLE_GRADE },
    {},
    { create },
  );
  assert.equal(systemOf(calls[1]), buildConventionItemsSystem(PARTS));
  assert.deepEqual(made.parts, []);
  assert.ok(made.layout.items.every((i) => !i.part.includes("@")));
});

test("SCENE_PART_LOOKUP が convention でも、同梱に無い物は作らずに裏取りで落とす（部屋・作り置きは部品を作らない）", async () => {
  const { create } = fakeClaude([
    message(EXAMPLE_ANSWER),
    message({
      items: [
        ...EXAMPLE_ITEMS,
        {
          key: "lamp",
          part: "lamp_street",
          place: { relation: "ground", zone: "back_left" },
        },
      ],
      newParts: [LAMP],
    }),
  ]);
  await assert.rejects(
    generateSceneWithParts(ENV, { grade: EXAMPLE_GRADE }, {}, { create }),
    (e) =>
      e instanceof SceneVerificationError &&
      e.problems.some(
        (p) => p.code === "unknown_part" && p.message.includes("lamp_street"),
      ),
  );
});

test("SCENE_PART_LOOKUP が無ければ今の道（部品の一覧を出す）", async () => {
  const { create, calls } = fakeClaude([
    message(EXAMPLE_ANSWER),
    message({ items: EXAMPLE_ITEMS }),
  ]);
  await generateSceneWithParts(
    { ...ENV, SCENE_PART_LOOKUP: undefined },
    { grade: EXAMPLE_GRADE },
    {},
    { create },
  );
  assert.equal(systemOf(calls[1]), buildItemsSystem(PARTS));
});
