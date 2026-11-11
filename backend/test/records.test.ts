import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../src/domain/result";
import type { PlayRecordInput } from "../src/durable-objects/playRecords";
import type { PlayRecordRepository } from "../src/repositories/playRecordRepository";
import type { RoomRepository } from "../src/repositories/roomRepository";
import { findPoolScene } from "../src/scenes/pool";
import index from "../src/scenes/pool/index.json";
import type { SceneLayoutV2 } from "../src/scenes/types";
import { submitAudio } from "../src/usecases/submitAudio";

// cloudflare:workers を Node で読めるものに差し替えてから、きろくの Durable Object を読む
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") {
      return {
        url: new URL("./helpers/cloudflare-workers.mjs", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});
const { PlayRecords, RETENTION_DAYS } = await import(
  "../src/durable-objects/playRecords"
);
const { default: app } = await import("../src/app");

/** DO の SQLite（ctx.storage.sql）を node:sqlite でまねる */
const fakeSqlContext = () => {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec: (query: string, ...bindings: (string | number | null)[]) => {
      const statement = db.prepare(query);
      if (/^\s*SELECT/i.test(query)) {
        const rows = statement.all(...bindings);
        return { toArray: () => rows };
      }
      statement.run(...bindings);
      return { toArray: () => [] };
    },
  };
  return { storage: { sql } } as unknown as DurableObjectState;
};

const newRecords = () =>
  new PlayRecords(fakeSqlContext(), {} as CloudflareBindings);

const poolSceneId = index["eiken-3"].scenes[0];
const poolLayout = findPoolScene(poolSceneId) as SceneLayoutV2;

const DEVICE_A = "6f1c2a8e-0000-4000-8000-000000000001";
const DEVICE_B = "6f1c2a8e-0000-4000-8000-000000000002";

const input = (deviceId: string, transcript: string): PlayRecordInput => ({
  deviceId,
  sceneId: poolSceneId,
  score: { content: 60, expression: 40, speech: 70, total: 58 },
  transcript,
  content: {
    claims: [],
    items: [],
    hit: 0,
    said: 0,
    correct: 0,
    total: 0,
  } as unknown as PlayRecordInput["content"],
  feedback: {
    strength: { quote: "", text: "よい" },
    nextStep: { kind: "content", gain: null, text: "犬" },
    rewrite: null,
    speechTip: { aspect: "fluency", text: "止まらずに" },
  } as unknown as PlayRecordInput["feedback"],
  layout: poolLayout,
});

const DAY_MS = 24 * 60 * 60 * 1000;

test("きろくは端末ごとに新しい順で返り、語数を数え、振り返りの中身はそのまま戻る", async () => {
  const records = newRecords();
  await records.append(input(DEVICE_A, "A dog is  running."), 1_000);
  await records.append(input(DEVICE_B, "A man."), 2_000);
  await records.append(input(DEVICE_A, "Two benches."), 3_000);
  const rows = await records.listByDevice(DEVICE_A, 4_000);
  assert.deepEqual(
    rows.map((r) => [r.transcript, r.words]),
    [
      ["Two benches.", 2],
      ["A dog is  running.", 4],
    ],
  );
  const [latest] = rows;
  assert.equal(latest.playedAt, new Date(3_000).toISOString());
  assert.equal(latest.sceneId, poolSceneId);
  assert.deepEqual(latest.score, input(DEVICE_A, "").score);
  assert.deepEqual(latest.feedback, input(DEVICE_A, "").feedback);
  assert.equal(latest.layout.description, poolLayout.description);
  // 端末の ID は返さない
  assert.ok(!("deviceId" in latest));
});

test(`${RETENTION_DAYS} 日を過ぎた行は返さず、次に書き込むときに消える`, async () => {
  const records = newRecords();
  const start = Date.UTC(2026, 10, 8);
  await records.append(input(DEVICE_A, "old"), start);
  await records.append(input(DEVICE_A, "kept"), start + 10 * DAY_MS);
  const later = start + (RETENTION_DAYS + 1) * DAY_MS;
  assert.deepEqual(
    (await records.listByDevice(DEVICE_A, later)).map((r) => r.transcript),
    ["kept"],
  );
  await records.append(input(DEVICE_A, "new"), later);
  assert.deepEqual(
    (await records.listByDevice(DEVICE_A, later)).map((r) => r.transcript),
    ["new", "kept"],
  );
});

// ---------- 音声を送ったときにきろくに残すか ----------

const wav = () => {
  const buf = new Uint8Array(64);
  buf.set(new TextEncoder().encode("RIFF"), 0);
  buf.set(new TextEncoder().encode("WAVE"), 8);
  return buf.buffer;
};

/** 部屋は作り置きの場面のラウンド中で、採点を受け付けるだけ */
const fakeRoom = (layout?: SceneLayoutV2): RoomRepository =>
  ({
    beginGrading: async () =>
      ok(layout ? { sceneId: layout.id, layout } : { sceneId: poolSceneId }),
    recordGrade: async () => {},
  }) as unknown as RoomRepository;

const submit = async (deviceId: string | undefined, layout?: SceneLayoutV2) => {
  const appended: PlayRecordInput[] = [];
  const repository = {
    append: async (record: PlayRecordInput) => {
      appended.push(record);
    },
    listByDevice: async () => [],
  } as unknown as PlayRecordRepository;
  const pending: Promise<unknown>[] = [];
  const result = await submitAudio(
    fakeRoom(layout),
    { SCORING_MODE: "fixed" },
    (p) => pending.push(p),
    {
      roomId: "0427",
      round: 1,
      playerId: "p",
      token: "t",
      audio: wav(),
      transcript: "There are two benches in the park.",
      deviceId,
    },
    repository,
  );
  await Promise.all(pending);
  return { result, appended };
};

test("端末の ID を付けて送ると、採点の結果と場面の配置を表示名なしで残す", async () => {
  const { result, appended } = await submit(DEVICE_A);
  assert.ok(result.ok);
  assert.equal(appended.length, 1);
  const [record] = appended;
  assert.equal(record.deviceId, DEVICE_A);
  assert.equal(record.sceneId, poolSceneId);
  assert.equal(record.layout.id, poolSceneId);
  assert.ok(Number.isInteger(record.score.total));
  assert.ok(!("name" in record));
});

test("部屋が AI で作った場面は、部屋が持つ配置を残す", async () => {
  const generated = { ...poolLayout, id: "gen-abcdefghij", name: "AI の公園" };
  const { appended } = await submit(DEVICE_A, generated);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].layout.name, "AI の公園");
});

test("端末の ID が無い（古いアプリ）ときは残さない", async () => {
  const { result, appended } = await submit(undefined);
  assert.ok(result.ok);
  assert.equal(appended.length, 0);
});

// ---------- GET /records/mine ----------

test("GET /records/mine は、X-Device-Id の端末のきろくだけを返す", async () => {
  const asked: string[] = [];
  const env = {
    PLAY_RECORDS: {
      getByName: () => ({
        listByDevice: async (deviceId: string) => {
          asked.push(deviceId);
          return [{ id: 1 }];
        },
      }),
    },
  };
  const res = await app.request(
    "/records/mine",
    { headers: { "x-device-id": DEVICE_A } },
    env,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { records: [{ id: 1 }] });
  assert.deepEqual(asked, [DEVICE_A]);

  const missing = await app.request("/records/mine", {}, env);
  assert.equal(missing.status, 400);
  const wrong = await app.request(
    "/records/mine",
    { headers: { "x-device-id": "not-a-uuid" } },
    env,
  );
  assert.equal(wrong.status, 400);
});
