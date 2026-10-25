import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import {
  createRoomState,
  type RoomState,
  startRound,
} from "../src/domain/room";
import { isSceneId, sceneName } from "../src/domain/scenes";
import { findPoolScene, importedPoolIds } from "../src/scenes/pool";
import index from "../src/scenes/pool/index.json";
import { ClientMessage } from "../src/schemas/ws";

const poolDir = new URL("../src/scenes/pool/", import.meta.url);

test("pool/ の JSON を全部 import し、index.json の場面がそろっている", () => {
  const files = readdirSync(poolDir)
    .filter((f) => f.startsWith("gen-") && f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
  assert.deepEqual([...importedPoolIds()].sort(), files);
  for (const [difficulty, entry] of Object.entries(index)) {
    assert.ok(!entry.scenes.includes(entry.example), "例は候補に入れない");
    for (const id of [entry.example, ...entry.scenes]) {
      const scene = findPoolScene(id);
      assert.ok(scene, id);
      assert.equal(scene.id, id);
      assert.equal(scene.difficulty, difficulty);
    }
  }
});

test("作り置きの場面も選べるシーンで、名前は JSON の name", () => {
  const id = index.easy.scenes[0];
  assert.ok(isSceneId(id));
  assert.equal(sceneName(id), findPoolScene(id)?.name);
  assert.ok(isSceneId("park"));
  assert.ok(!isSceneId("gen-xxxxxxxxxx"));
});

const lobbyWithHost = () => {
  // joinRoom は Workers の crypto.subtle.timingSafeEqual を使うので、名前を直接入れる
  const { state, host } = createRoomState("ABCD");
  const players = state.players.map((p) => ({ ...p, name: "host" }));
  return { state: { ...state, players }, hostId: host.id };
};

const backToLobby = (state: RoomState): RoomState => ({
  ...state,
  phase: "lobby",
});

test("difficulty を送ると、その難易度の候補から部屋で重ならずに選び、全部出たら最初に戻る", () => {
  let { state, hostId } = lobbyWithHost();
  const candidates = index.normal.scenes;
  const seen: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const r = startRound(state, {
      playerId: hostId,
      difficulty: "normal",
      now: 0,
      connectedIds: new Set([hostId]),
    });
    assert.ok(r.ok);
    assert.ok(candidates.includes(r.value.round.sceneId));
    assert.ok(!seen.includes(r.value.round.sceneId), "同じ部屋で重ならない");
    seen.push(r.value.round.sceneId);
    state = backToLobby(r.value.state);
  }
  assert.equal(seen.length, candidates.length);
  const again = startRound(state, {
    playerId: hostId,
    difficulty: "normal",
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(again.ok);
  assert.ok(candidates.includes(again.value.round.sceneId));
  assert.deepEqual(again.value.state.playedSceneIds, [
    again.value.round.sceneId,
  ]);
});

test("難易度ごとに履歴を分けて覚える", () => {
  let { state, hostId } = lobbyWithHost();
  const easy = startRound(state, {
    playerId: hostId,
    difficulty: "easy",
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(easy.ok);
  state = backToLobby(easy.value.state);
  const hard = startRound(state, {
    playerId: hostId,
    difficulty: "hard",
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(hard.ok);
  assert.ok(index.hard.scenes.includes(hard.value.round.sceneId));
  assert.deepEqual(hard.value.state.playedSceneIds, [
    easy.value.round.sceneId,
    hard.value.round.sceneId,
  ]);
});

test("sceneId と difficulty の両方を送ると invalid_message", () => {
  const { state, hostId } = lobbyWithHost();
  const r = startRound(state, {
    playerId: hostId,
    sceneId: "park",
    difficulty: "easy",
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(!r.ok);
  assert.equal(r.error.code, "invalid_message");
});

test("どちらも送らなければ手作りの場面のおまかせ、sceneId だけならその場面", () => {
  const { state, hostId } = lobbyWithHost();
  const random = startRound(state, {
    playerId: hostId,
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(random.ok);
  assert.ok(!random.value.round.sceneId.startsWith("gen-"));
  const chosen = startRound(state, {
    playerId: hostId,
    sceneId: "park",
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(chosen.ok);
  assert.equal(chosen.value.round.sceneId, "park");
});

test("start の difficulty は easy・normal・hard だけ受け付ける", () => {
  assert.ok(
    ClientMessage.safeParse({ type: "start", difficulty: "hard" }).success,
  );
  assert.ok(
    !ClientMessage.safeParse({ type: "start", difficulty: "expert" }).success,
  );
});
