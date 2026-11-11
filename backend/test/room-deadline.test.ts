// ラウンドを時間で締め切る（ホストの close は無い）。部屋の Durable Object を Node で動かし、時計を差し替えて進める
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIO_GRACE_MS,
  expireRound,
  GRADING_GRACE_MS,
  type Grade,
  INTRO_MS,
  RECORDING_MS,
  roundDeadlines,
} from "../src/domain/round";
import { poolCandidates } from "../src/scenes/pool";
import { openRoom, received, send, type Welcome } from "./helpers/room-harness";

const ENV = { SCORING_MODE: "fixed" };
const SCENE = poolCandidates("eiken-3")[0];
const T0 = 1_800_000_000_000;

const done = (total: number): Grade => ({
  status: "done",
  score: { content: total, expression: total, speech: total, total },
  transcript: "A girl is sitting.",
  content: {
    claims: [],
    items: [],
    others: 0,
    recall: { earned: 0, max: 5 },
    precision: { correct: 0, said: 0 },
  },
  feedback: {
    nextStep: { kind: "expression", text: "t", item: null, gain: null },
    rewrite: null,
    speechTip: { aspect: "fluency", text: "t" },
  },
});

/** ホストと B の部屋で、時計を差し替えてラウンドを始める */
const startedRoom = async () => {
  const opened = await openRoom(ENV);
  const time = { now: T0 };
  // biome-ignore lint/suspicious/noExplicitAny: テストのために時計を差し替える
  (opened.room as any).clock = () => time.now;
  await send(opened.room, opened.host, { type: "start", sceneId: SCENE });
  const [round] = received(opened.host, "round");
  const deadlines = roundDeadlines({ startAt: Number(round.startAt) });
  return { ...opened, time, deadlines };
};

const submit = async (
  room: Awaited<ReturnType<typeof openRoom>>["room"],
  who: Welcome,
) => {
  const begun = await room.beginGrading({
    playerId: who.playerId,
    token: who.token,
    round: 1,
  });
  assert.ok(begun.ok, JSON.stringify(begun));
};

const resultsOf = (ws: Parameters<typeof received>[0]) =>
  received(ws, "results") as {
    players: { id: string; rank: number | null; score: unknown }[];
  }[];

test("締め切りの時刻は、録音が終わるはずの時刻（開始 + 回転 3 秒 + 録音 20 秒）から音声 10 秒・採点 30 秒", () => {
  assert.equal(INTRO_MS, 3000);
  assert.equal(RECORDING_MS, 20000);
  assert.equal(AUDIO_GRACE_MS, 10000);
  assert.equal(GRADING_GRACE_MS, 30000);
  assert.deepEqual(roundDeadlines({ startAt: 1000 }), {
    recordingEnd: 24000,
    audio: 34000,
    grading: 54000,
  });
});

test("(a) 1 人が送らないまま音声の締め切りが来たら、その人を採点できなかった扱いにして結果を出す", async () => {
  const { room, host, others, welcomes, time, deadlines, alarm } =
    await startedRoom();
  // 始めたら、音声の締め切りに alarm を予約する
  assert.equal(alarm.at, deadlines.audio);
  await submit(room, welcomes[0]);
  await room.recordGrade({
    playerId: welcomes[0].playerId,
    round: 1,
    grade: done(70),
  });
  assert.equal(resultsOf(host).length, 0, "B を待っている");

  // 締め切りの前に alarm が来ても何もしない
  time.now = deadlines.audio - 1;
  await room.alarm();
  assert.equal(resultsOf(host).length, 0);

  time.now = deadlines.audio;
  await room.alarm();
  const [results] = resultsOf(others[0]);
  assert.ok(results);
  assert.deepEqual(
    results.players.map((p) => [p.id, p.rank]),
    [
      [welcomes[0].playerId, 1],
      [welcomes[1].playerId, null],
    ],
  );
  assert.equal(results.players[1].score, null);
  // 締め切りの後の音声は受け取らない
  const late = await room.beginGrading({
    playerId: welcomes[1].playerId,
    token: welcomes[1].token,
    round: 1,
  });
  assert.ok(!late.ok);
});

test("(b) 送った人の採点が遅いと、採点の締め切りで結果を出し、遅れて届いた採点は捨てる", async () => {
  const { room, host, welcomes, time, deadlines, alarm, storage } =
    await startedRoom();
  await submit(room, welcomes[0]);
  await submit(room, welcomes[1]);
  await room.recordGrade({
    playerId: welcomes[0].playerId,
    round: 1,
    grade: done(70),
  });
  // 全員が音声を送ったので、次の alarm は採点の締め切り
  assert.equal(alarm.at, deadlines.grading);

  time.now = deadlines.audio + 1;
  await room.alarm();
  assert.equal(resultsOf(host).length, 0, "採点中の人はまだ待つ");

  time.now = deadlines.grading;
  await room.alarm();
  const [results] = resultsOf(host);
  assert.ok(results);
  assert.deepEqual(
    results.players.map((p) => [p.id, p.rank]),
    [
      [welcomes[0].playerId, 1],
      [welcomes[1].playerId, null],
    ],
  );

  // 遅れて届いた採点は捨てる（結果は送り直さず、状態も変えない）
  const before = structuredClone(storage.get("state"));
  await room.recordGrade({
    playerId: welcomes[1].playerId,
    round: 1,
    grade: done(90),
  });
  assert.equal(resultsOf(host).length, 1);
  assert.deepEqual(storage.get("state"), before);
});

test("(b') alarm が遅れても、採点の締め切りの後に届いた採点は捨てて結果を出す", async () => {
  const { room, host, welcomes, time, deadlines } = await startedRoom();
  await submit(room, welcomes[0]);
  await submit(room, welcomes[1]);
  await room.recordGrade({
    playerId: welcomes[0].playerId,
    round: 1,
    grade: done(70),
  });
  time.now = deadlines.grading + 5000;
  await room.recordGrade({
    playerId: welcomes[1].playerId,
    round: 1,
    grade: done(90),
  });
  const [results] = resultsOf(host);
  assert.ok(results);
  assert.equal(results.players[1].rank, null);
});

test("(c) 全員の採点がそろえば、締め切りを待たずにすぐ結果を出す", async () => {
  const { room, host, welcomes, time, deadlines } = await startedRoom();
  time.now = deadlines.recordingEnd;
  for (const [n, who] of welcomes.entries()) {
    await submit(room, who);
    await room.recordGrade({
      playerId: who.playerId,
      round: 1,
      grade: done(60 + n * 10),
    });
  }
  const [results] = resultsOf(host);
  assert.ok(results);
  assert.deepEqual(
    results.players.map((p) => p.rank),
    [1, 2],
  );
});

test("(d) close を送ると invalid_message（ホストが締め切る操作は無い）", async () => {
  const { room, host } = await startedRoom();
  await send(room, host, { type: "close" });
  assert.equal(received(host, "error").at(-1)?.code, "invalid_message");
});

test("切断中の人も、音声の締め切りで採点できなかった扱いになる。誰もいない部屋は締め切りでは消さない", async () => {
  const { room, others, welcomes, time, deadlines, storage, sockets } =
    await startedRoom();
  await submit(room, welcomes[0]);
  await room.recordGrade({
    playerId: welcomes[0].playerId,
    round: 1,
    grade: done(70),
  });
  const [b] = others;
  b.close();
  await room.webSocketClose(b);
  time.now = deadlines.audio;
  await room.alarm();
  assert.equal((storage.get("state") as { phase: string }).phase, "results");
  // 全員が切断しても、締め切りの alarm では部屋を消さない（消すのは IDLE_TTL の後）
  for (const ws of sockets) ws.close();
  await room.alarm();
  assert.ok(storage.has("state"));
});

test("expireRound は、ラウンド中でなければ何もしない", () => {
  const state = { phase: "lobby", current: null } as never;
  assert.equal(expireRound(state, Number.MAX_SAFE_INTEGER), state);
});
