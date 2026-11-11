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
import { GRADE_IDS } from "../src/scenes/types";
import { ClientMessage } from "../src/schemas/ws";

const poolDir = new URL("../src/scenes/pool/", import.meta.url);

test("pool/ の JSON を全部 import し、index.json の場面がそろっている", () => {
  const files = readdirSync(poolDir)
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => f.slice(0, -5))
    .sort();
  assert.deepEqual([...importedPoolIds()].sort(), files);
  // 一覧のキーは級の値（GRADE_IDS）と同じ
  assert.deepEqual(Object.keys(index), [...GRADE_IDS]);
  for (const [difficulty, entry] of Object.entries(index)) {
    assert.ok(!entry.scenes.includes(entry.example), "例は候補に入れない");
    for (const id of [entry.example, ...entry.scenes]) {
      const scene = findPoolScene(id);
      assert.ok(scene, id);
      assert.equal(scene.id, id);
      assert.equal(scene.difficulty, difficulty);
      assert.equal(scene.protocol, "scenenglish.scene/2");
    }
  }
});

test("作り置きの場面も選べるシーンで、名前は JSON の name", () => {
  const id = index["eiken-3"].scenes[0];
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
  const candidates = index["eiken-pre2"].scenes;
  const seen: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const r = startRound(state, {
      playerId: hostId,
      difficulty: "eiken-pre2",
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
    difficulty: "eiken-pre2",
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
    difficulty: "eiken-3",
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(easy.ok);
  state = backToLobby(easy.value.state);
  const hard = startRound(state, {
    playerId: hostId,
    difficulty: "eiken-2",
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(hard.ok);
  assert.ok(index["eiken-2"].scenes.includes(hard.value.round.sceneId));
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
    difficulty: "eiken-3",
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
  assert.equal(findPoolScene(random.value.round.sceneId), undefined);
  const chosen = startRound(state, {
    playerId: hostId,
    sceneId: "park",
    now: 0,
    connectedIds: new Set([hostId]),
  });
  assert.ok(chosen.ok);
  assert.equal(chosen.value.round.sceneId, "park");
});

test("start の difficulty は級の値だけ受け付け、古い値（easy・normal・hard）は断る", () => {
  assert.ok(
    ClientMessage.safeParse({ type: "start", difficulty: "eiken-2" }).success,
  );
  for (const difficulty of ["expert", "easy", "normal", "hard"]) {
    assert.ok(!ClientMessage.safeParse({ type: "start", difficulty }).success);
  }
});
