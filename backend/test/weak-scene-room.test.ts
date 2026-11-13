// 部屋が苦手の場面（sceneId が weak- で始まる）で始める流れ（Durable Object を Node で動かす）。
// 場面は makeWeakScene に偽の Claude・部品を作る口・置き場を渡して作り、置き場（R2）の偽物から部屋が読む
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import app from "../src/app";
import type { RoomState } from "../src/domain/room";
import type { PartOrder } from "../src/parts/workshop";
import {
  type WeakSceneRecord,
  weakSceneKey,
} from "../src/repositories/weakSceneRepository";
import { EXAMPLE_ANSWER, EXAMPLE_ITEMS } from "../src/scenes/generate-v2";
import type { Part, SceneLayoutV2 } from "../src/scenes/types";
import { WeakSceneRequest } from "../src/schemas/http";
import { score } from "../src/scoring";
import { describeLayoutWithRelations } from "../src/scoring/layout";
import { makeWeakScene } from "../src/usecases/weakScenes";
import { openRoom, received, send } from "./helpers/room-harness";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const LAMP: PartOrder = {
  id: "lamp_street",
  category: "thing",
  label: "街灯",
  words: ["lamp", "street lamp"],
  size: [0.4, 3, 0.4],
  description: "A tall black street lamp with a round white light.",
};
const LAMP_META: Part = {
  id: LAMP.id,
  version: 1,
  file: "parts/lamp_street/1.usdz",
  category: LAMP.category,
  words: LAMP.words.map((word) => ({ word, pos: "noun" })),
  size: LAMP.size,
  label: LAMP.label,
};

const message = (body: unknown) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify(body) }],
  usage: { input_tokens: 1, output_tokens: 1 },
});

/** 偽物で苦手の場面を 1 つ作り、置き場に置いた 1 件を返す */
const makeRecord = async (): Promise<WeakSceneRecord> => {
  const replies = [
    message({ ...EXAMPLE_ANSWER, pitch: "because で理由を言いやすい場面です" }),
    message({
      items: [
        ...EXAMPLE_ITEMS,
        {
          key: "lamp",
          part: "lamp_street",
          place: { relation: "ground", zone: "back_left" },
        },
      ],
      newParts: [
        {
          ...LAMP,
          size: { width: 0.4, height: 3, depth: 0.4 },
          top: false,
        },
      ],
    }),
  ];
  let n = 0;
  const put: WeakSceneRecord[] = [];
  const outcome = await makeWeakScene(
    { CLAUDE_API_KEY: "test" },
    WeakSceneRequest.parse({ difficulty: "eiken-pre2", kinds: ["reason"] }),
    {
      create: (async (_p: Anthropic.MessageCreateParamsNonStreaming) =>
        replies[n++]) as never,
      workshop: {
        lookup: async () => null,
        ensure: async () => ({ parts: [LAMP_META], failed: [] }),
      },
      store: {
        put: async (r) => {
          put.push(r);
        },
        find: async () => null,
      },
    },
  );
  assert.ok(outcome.ok, JSON.stringify(outcome));
  return put[0];
};

/** 置き場（R2）の偽物。読んだキーを覚える */
const fakeBucket = (records: WeakSceneRecord[]) => {
  const reads: string[] = [];
  const bucket = {
    get: async (key: string) => {
      reads.push(key);
      const found = records.find((r) => weakSceneKey(r.sceneId) === key);
      return found ? { json: async () => structuredClone(found) } : null;
    },
  };
  return { bucket, reads };
};

const ENV = { SCORING_MODE: "fixed", SCENE_GENERATION: "off" };

test("start の sceneId が weak- で始まれば、置き場から読んでその場面で始め、配置と作った部品を部屋に置く", async () => {
  const record = await makeRecord();
  const { bucket, reads } = fakeBucket([record]);
  const { room, host, others, storage, welcomes } = await openRoom({
    ...ENV,
    BUCKET: bucket,
  });
  await send(room, host, { type: "start", sceneId: record.sceneId });

  assert.deepEqual(reads, [weakSceneKey(record.sceneId)]);
  for (const ws of [host, ...others]) {
    const rounds = received(ws, "round");
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].sceneId, record.sceneId);
    // サーバーからアプリへ送るメッセージに欄を足さない
    assert.deepEqual(Object.keys(rounds[0]).sort(), [
      "round",
      "sceneId",
      "startAt",
      "type",
    ]);
  }
  const state = storage.get("state") as RoomState;
  assert.equal(state.phase, "playing");
  assert.equal(state.current?.sceneName, record.name);
  assert.deepEqual(storage.get(`layout:${record.sceneId}`), record.layout);
  assert.deepEqual(storage.get(`parts:${record.sceneId}`), [LAMP_META]);

  // 参加者の端末は GET /scenes/{id}/layout?room= で配置を取る
  const env = {
    ROOM: { getByName: (code: string) => (code === "0427" ? room : null) },
  };
  const res = await app.request(
    `/scenes/${record.sceneId}/layout?room=0427`,
    {},
    env,
  );
  assert.equal(res.status, 200);
  const layout = (await res.json()) as SceneLayoutV2;
  assert.equal(layout.id, record.sceneId);
  assert.ok(layout.items.some((i) => i.part === "lamp_street@1"));
  // room を付けなくても、置き場から取れる
  const direct = await app.request(
    `/scenes/${record.sceneId}/layout`,
    {},
    {
      BUCKET: bucket,
    },
  );
  assert.equal(direct.status, 200);
  assert.deepEqual(await direct.json(), record.layout);

  // 採点: 部屋が置いた配置と作った部品のメタデータを返し、場面の情報に作った部品が入る
  const begun = await room.beginGrading({
    playerId: welcomes[1].playerId,
    token: welcomes[1].token,
    round: 1,
  });
  assert.ok(begun.ok);
  assert.equal(begun.value.layout?.id, record.sceneId);
  assert.deepEqual(begun.value.parts, [LAMP_META]);

  const bodies: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("stt.speech.microsoft.com")) {
      return Response.json({
        RecognitionStatus: "Success",
        NBest: [
          {
            Display: "There is a street lamp",
            AccuracyScore: 90,
            FluencyScore: 80,
            ProsodyScore: 80,
            Words: [],
          },
        ],
      });
    }
    bodies.push(String(init?.body));
    return Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        {
          type: "text",
          text: JSON.stringify({
            claims: [],
            expressionBasis: "Correct there is.",
            expression: 60,
            nextStep: { kind: "content", text: "人も言おう", item: null },
            rewrite: null,
          }),
        },
      ],
    });
  }) as typeof fetch;
  const live = await score(
    {
      AZURE_API_KEY: "a",
      AZURE_LOCATION: "japaneast",
      CLAUDE_API_KEY: "c",
      SCORING_MODE: "live",
    },
    new Uint8Array([
      ...new TextEncoder().encode("RIFF"),
      0,
      0,
      0,
      0,
      ...new TextEncoder().encode("WAVE"),
      ...new Uint8Array(52),
    ]).buffer,
    record.sceneId,
    "There is a street lamp",
    begun.value.layout as SceneLayoutV2,
    begun.value.parts,
  );
  assert.ok(live.ok, JSON.stringify(live));
  const user = JSON.parse(bodies[0]).messages[0].content as string;
  assert.ok(
    user.includes("- lamp: 街灯 / thing"),
    "作った部品を場面の情報に入れる",
  );
});

test("置き場に無い weak- の場面は unknown_scene で、待合のまま", async () => {
  const { bucket } = fakeBucket([]);
  const { room, host, storage } = await openRoom({ ...ENV, BUCKET: bucket });
  await send(room, host, {
    type: "start",
    sceneId: "weak-0f8fad5b-d9cb-469f-a165-70867728950e",
  });
  const errors = received(host, "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "unknown_scene");
  assert.equal((storage.get("state") as RoomState).phase, "lobby");
  assert.equal(received(host, "round").length, 0);

  // 形の違う weak- の ID も unknown_scene
  await send(room, host, { type: "start", sceneId: "weak-nope" });
  assert.equal(received(host, "error").at(-1)?.code, "unknown_scene");
});

test("ホスト以外の start は、置き場を読まずに not_host。difficulty と一緒なら invalid_message", async () => {
  const record = await makeRecord();
  const { bucket, reads } = fakeBucket([record]);
  const { room, host, others } = await openRoom({ ...ENV, BUCKET: bucket });
  await send(room, others[0], { type: "start", sceneId: record.sceneId });
  assert.equal(received(others[0], "error")[0].code, "not_host");
  assert.equal(reads.length, 0);

  await send(room, host, {
    type: "start",
    sceneId: record.sceneId,
    difficulty: "eiken-pre2",
  });
  assert.equal(received(host, "error")[0].code, "invalid_message");
  assert.equal(reads.length, 0);
});

test("もう一度（again）のあとに同じ weak- の場面で始めると、部屋に置いた配置を使い、置き場を読み直さない", async () => {
  const record = await makeRecord();
  const { bucket, reads } = fakeBucket([record]);
  const { room, host, storage } = await openRoom({ ...ENV, BUCKET: bucket });
  await send(room, host, { type: "start", sceneId: record.sceneId });
  const state = storage.get("state") as RoomState;
  // 結果発表にしてから待合に戻す（締め切りを待たずに状態を書き換える）
  storage.set("state", { ...state, phase: "results" });
  // biome-ignore lint/suspicious/noExplicitAny: テストで保存した状態を読み直させる
  (room as any).state = undefined;
  await send(room, host, { type: "again" });
  await send(room, host, { type: "start", sceneId: record.sceneId });
  assert.equal(received(host, "round").length, 2);
  assert.equal(reads.length, 1);
});

test("採点の場面の情報は、作った部品のメタデータを渡せば数える（渡さなければ捨てる）", () => {
  const items = [
    {
      key: "g",
      part: "grass_patch",
      position: [0, 0, 0] as [number, number, number],
    },
    {
      key: "lamp",
      part: "lamp_street@1",
      position: [1, 0, -2] as [number, number, number],
    },
  ];
  assert.equal(describeLayoutWithRelations(items), null);
  const text = describeLayoutWithRelations(items, [LAMP_META]);
  assert.ok(text?.includes("- lamp: 街灯 / thing"));
  assert.ok(text?.includes("words: lamp, street lamp"));
});
