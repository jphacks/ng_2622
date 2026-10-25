import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayer } from "../src/domain/player";
import {
  beginGeneration,
  canGenerate,
  createRoomState,
  finishGeneration,
  hostIsAway,
  leaveRoom,
  MAX_GENERATIONS,
  type RoomState,
  replaceAwayHost,
  startRound,
} from "../src/domain/room";
import { roundResults } from "../src/domain/round";
import { poolCandidates } from "../src/scenes/pool";

// joinRoom は Workers の crypto.subtle.timingSafeEqual を使うので、参加者を直接入れる
const lobbyOfThree = () => {
  const { state, host } = createRoomState("0427");
  const b = { ...createPlayer(false), name: "B" };
  const c = { ...createPlayer(false), name: "C" };
  const players = [{ ...host, name: "host" }, b, c];
  const room: RoomState = { ...state, players };
  return { state: room, hostId: host.id, bId: b.id, cId: c.id };
};

test("start のときに切断中の人はラウンドに入れない", () => {
  const { state, hostId, bId, cId } = lobbyOfThree();
  const r = startRound(state, {
    playerId: hostId,
    sceneId: "park",
    now: 0,
    connectedIds: new Set([hostId, bId]),
  });
  assert.ok(r.ok);
  assert.deepEqual(r.value.round.playerIds, [hostId, bId]);
  assert.ok(!r.value.round.playerIds.includes(cId));
});

test("ホストが切断中で、ほかにつながっている人がいるときだけ替える", () => {
  const { state, hostId, bId } = lobbyOfThree();
  assert.ok(!hostIsAway(state, new Set([hostId, bId])), "ホストがいる");
  assert.ok(!hostIsAway(state, new Set()), "誰もつながっていない");
  assert.ok(hostIsAway(state, new Set([bId])));
});

test("戻らないホストは、つながっている人のうち先に入った人に替わる", () => {
  const { state, hostId, bId, cId } = lobbyOfThree();
  const next = replaceAwayHost(state, new Set([cId]));
  assert.equal(next.hostId, cId, "B は切断中なので C");
  assert.deepEqual(
    next.players.map((p) => [p.id, p.isHost]),
    [
      [hostId, false],
      [bId, false],
      [cId, true],
    ],
  );
  assert.equal(next.players.length, 3, "前のホストは参加者として残る");
  assert.equal(replaceAwayHost(state, new Set([hostId, cId])), state);
});

// ---------- AI で場面を作る ----------

test("生成は on で、試した回数が 20 回未満のときだけ", () => {
  const { state } = lobbyOfThree();
  assert.equal(MAX_GENERATIONS, 20);
  assert.ok(canGenerate(state, true), "前の版の部屋（回数なし）も作れる");
  assert.ok(!canGenerate(state, false), "スイッチが off");
  assert.ok(canGenerate({ ...state, generationCount: 19 }, true));
  assert.ok(!canGenerate({ ...state, generationCount: 20 }, true));
});

test("生成を始めると generating になり、試した回数を 1 つ増やす", () => {
  const { state, hostId, bId } = lobbyOfThree();
  const r = beginGeneration(
    { ...state, generationCount: 3 },
    { playerId: hostId, difficulty: "hard", generationId: "g1" },
  );
  assert.ok(r.ok);
  assert.equal(r.value.phase, "generating");
  assert.deepEqual(r.value.generating, { id: "g1", difficulty: "hard" });
  assert.equal(r.value.generationCount, 4);

  const notHost = beginGeneration(state, {
    playerId: bId,
    difficulty: "easy",
    generationId: "g2",
  });
  assert.ok(!notHost.ok && notHost.error.code === "not_host");
  const twice = beginGeneration(r.value, {
    playerId: hostId,
    difficulty: "easy",
    generationId: "g2",
  });
  assert.ok(!twice.ok && twice.error.code === "not_in_lobby");
  // 作っている間は普通のスタートも断る
  const start = startRound(r.value, {
    playerId: hostId,
    sceneId: "park",
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(!start.ok && start.error.code === "not_in_lobby");
});

const generating = () => {
  const room = lobbyOfThree();
  const r = beginGeneration(room.state, {
    playerId: room.hostId,
    difficulty: "normal",
    generationId: "g1",
  });
  assert.ok(r.ok);
  return { ...room, state: r.value };
};

test("作れたら、その場面でつながっている人のラウンドを始め、名前を結果発表に出す", () => {
  const { state, hostId, bId } = generating();
  const done = finishGeneration(state, {
    generationId: "g1",
    scene: { sceneId: "gen-abcdefghij", name: "AI の公園" },
    now: 1000,
    connectedIds: new Set([hostId, bId]),
  });
  assert.ok(done?.round);
  assert.equal(done.state.phase, "playing");
  assert.equal(done.state.generating, null);
  assert.equal(done.round.sceneId, "gen-abcdefghij");
  assert.equal(done.round.round, 1);
  assert.equal(done.round.startAt, 2500);
  assert.deepEqual(done.round.playerIds, [hostId, bId]);
  assert.equal(
    done.state.playedSceneIds,
    undefined,
    "作り置きの履歴は変えない",
  );
  assert.equal(roundResults(done.state)?.sceneName, "AI の公園");
});

test("作れなかったら、同じ難易度の作り置きの場面で始め、履歴に足す", () => {
  const { state, hostId } = generating();
  const done = finishGeneration(state, {
    generationId: "g1",
    scene: null,
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(done?.round);
  assert.ok(poolCandidates("normal").includes(done.round.sceneId));
  assert.deepEqual(done.state.playedSceneIds, [done.round.sceneId]);
  assert.equal(done.round.sceneName, undefined);
});

test("別の生成の結果や、もう generating でない部屋には何もしない", () => {
  const { state, hostId } = generating();
  const input = { scene: null, now: 0, connectedIds: new Set([hostId]) };
  assert.equal(
    finishGeneration(state, { ...input, generationId: "old" }),
    null,
  );
  const started = finishGeneration(state, { ...input, generationId: "g1" });
  assert.ok(started);
  assert.equal(
    finishGeneration(started.state, { ...input, generationId: "g1" }),
    null,
  );
});

test("つながっている人がいなければ、ラウンドを始めず待合に戻す", () => {
  const { state } = generating();
  const done = finishGeneration(state, {
    generationId: "g1",
    scene: { sceneId: "gen-abcdefghij", name: "x" },
    now: 0,
    connectedIds: new Set(),
  });
  assert.ok(done);
  assert.equal(done.round, null);
  assert.equal(done.state.phase, "lobby");
  assert.equal(done.state.generating, null);
});

test("作っている間にホストが抜けても generating のまま、次の人がホストになる", () => {
  const { state, hostId, bId, cId } = generating();
  const next = leaveRoom(state, hostId);
  assert.equal(next.phase, "generating");
  assert.equal(next.hostId, bId);
  const done = finishGeneration(next, {
    generationId: "g1",
    scene: null,
    now: 0,
    connectedIds: new Set([bId, cId]),
  });
  assert.deepEqual(done?.round?.playerIds, [bId, cId]);
});
