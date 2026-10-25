import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlayer } from "../src/domain/player";
import {
  createRoomState,
  hostIsAway,
  type RoomState,
  replaceAwayHost,
  startRound,
} from "../src/domain/room";

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
