import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../src/domain/result";
import type { PlayRecordInput } from "../src/durable-objects/playRecords";
import type { PlayRecordRepository } from "../src/repositories/playRecordRepository";
import type { RoomRepository } from "../src/repositories/roomRepository";
import index from "../src/scenes/pool/index.json";
import { submitAudio } from "../src/usecases/submitAudio";

// cloudflare:workers を Node で読めるものに差し替えてから、記録の Durable Object を読む
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

const input = (deviceId: string, transcript: string): PlayRecordInput => ({
  deviceId,
  sceneId: "gen-abc",
  difficulty: "easy",
  transcript,
  content: 60,
  expression: 40,
  speech: 70,
  total: 57.5,
  accuracy: 80,
  fluency: 60,
  prosody: 70,
  feedback: {
    strength: { quote: "", text: "よい" },
    nextStep: { kind: "content", gain: null, text: "犬" },
    rewrite: null,
    speechTip: { aspect: "fluency", text: "止まらずに" },
  },
  elements: [],
});

const DAY_MS = 24 * 60 * 60 * 1000;

test("記録は古い順に返り、語数を数え、講評は JSON のまま戻る", async () => {
  const records = newRecords();
  await records.append(input("d1", "A dog is  running."), 1_000);
  await records.append(input("d2", "A man."), 2_000);
  const rows = await records.list(0, 10);
  assert.deepEqual(
    rows.map((r) => [r.id, r.deviceId, r.words]),
    [
      [1, "d1", 4],
      [2, "d2", 2],
    ],
  );
  assert.equal(rows[0].createdAt, new Date(1_000).toISOString());
  assert.deepEqual(rows[0].feedback, input("d1", "").feedback);
  assert.deepEqual(rows[0].elements, []);
  // 続きは after に最後の id を渡して取る
  assert.deepEqual(
    (await records.list(1, 10)).map((r) => r.id),
    [2],
  );
});

test(`${RETENTION_DAYS} 日を過ぎた行は、次に書き込むときに消える`, async () => {
  const records = newRecords();
  const start = Date.UTC(2026, 10, 8);
  await records.append(input("d1", "old"), start);
  await records.append(input("d1", "kept"), start + 10 * DAY_MS);
  await records.append(
    input("d1", "new"),
    start + (RETENTION_DAYS + 1) * DAY_MS,
  );
  const rows = await records.list(0, 10);
  assert.deepEqual(
    rows.map((r) => r.transcript),
    ["kept", "new"],
  );
});

// ---------- 音声を送ったときに記録するか ----------

const wav = () => {
  const buf = new Uint8Array(64);
  buf.set(new TextEncoder().encode("RIFF"), 0);
  buf.set(new TextEncoder().encode("WAVE"), 8);
  return buf.buffer;
};

/** 部屋は作り置きの場面のラウンド中で、採点を受け付けるだけ */
const fakeRoom = (): RoomRepository =>
  ({
    beginGrading: async () =>
      ok({ sceneId: index.easy.scenes[0], difficulty: "easy" }),
    recordGrade: async () => {},
  }) as unknown as RoomRepository;

const fakeRecords = () => {
  const appended: PlayRecordInput[] = [];
  const repository = {
    append: async (record: PlayRecordInput) => {
      appended.push(record);
    },
    list: async () => [],
  } as unknown as PlayRecordRepository;
  return { appended, repository };
};

const submit = async (deviceId: string | undefined) => {
  const { appended, repository } = fakeRecords();
  const pending: Promise<unknown>[] = [];
  const result = await submitAudio(
    fakeRoom(),
    { SCORING_MODE: "fixed" },
    (p) => pending.push(p),
    {
      roomId: "0427",
      round: 1,
      playerId: "p",
      token: "t",
      audio: wav(),
      deviceId,
    },
    repository,
  );
  await Promise.all(pending);
  return { result, appended };
};

test("端末の ID を付けて送ると、採点の結果を表示名なしで記録する", async () => {
  const { result, appended } = await submit(
    "6f1c2a8e-0000-4000-8000-000000000001",
  );
  assert.ok(result.ok);
  assert.equal(appended.length, 1);
  const [record] = appended;
  assert.equal(record.deviceId, "6f1c2a8e-0000-4000-8000-000000000001");
  assert.equal(record.sceneId, index.easy.scenes[0]);
  assert.equal(record.difficulty, "easy");
  assert.equal(record.total, 60);
  assert.ok(!("name" in record));
});

test("端末の ID が無い（古いアプリ）ときは記録しない", async () => {
  const { result, appended } = await submit(undefined);
  assert.ok(result.ok);
  assert.equal(appended.length, 0);
});

// ---------- GET /records ----------

const recordsEnv = (token: string | undefined) => ({
  RECORDS_TOKEN: token,
  PLAY_RECORDS: {
    getByName: () => ({
      list: async (after: number, limit: number) =>
        Array.from({ length: limit }, (_, i) => ({ id: after + i + 1 })),
    }),
  },
});

test("GET /records は合言葉が合うときだけ返し、満杯なら続きの id を付ける", async () => {
  const auth = { authorization: "Bearer secret" };
  const ok200 = await app.request(
    "/records?after=5&limit=2",
    { headers: auth },
    recordsEnv("secret"),
  );
  assert.equal(ok200.status, 200);
  assert.deepEqual(await ok200.json(), {
    records: [{ id: 6 }, { id: 7 }],
    next: 7,
  });

  const wrong = await app.request(
    "/records",
    { headers: { authorization: "Bearer nope" } },
    recordsEnv("secret"),
  );
  assert.equal(wrong.status, 401);

  // 合言葉が設定されていなければ、誰も読めない
  const unset = await app.request(
    "/records",
    { headers: auth },
    recordsEnv(undefined),
  );
  assert.equal(unset.status, 401);
});
