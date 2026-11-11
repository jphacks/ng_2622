// 部屋が AI で場面を作る流れ（Durable Object を Node で動かす）。Claude は fetch を差し替えてまねる
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import app from "../src/app";
import type { RoomState } from "../src/domain/room";
import {
  EXAMPLE_GRADE,
  EXAMPLE_ITEMS,
  EXAMPLE_SENTENCES,
} from "../src/scenes/generate-v2";
import { poolCandidates } from "../src/scenes/pool";
import type { SceneLayoutV2 } from "../src/scenes/types";
import { score } from "../src/scoring";
import { openRoom, received, reopen, send } from "./helpers/room-harness";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ON = {
  SCENE_GENERATION: "on",
  CLAUDE_API_KEY: "test",
  SCORING_MODE: "fixed",
};
const OFF = { ...ON, SCENE_GENERATION: "off" };

// 2 段の生成の応答。1 回目は英文の部分、2 回目は部品と関係（generate-v2.ts の例。eiken-pre2 の裏取りを通る）
const SENTENCES = EXAMPLE_SENTENCES;
const ITEMS = { items: EXAMPLE_ITEMS };
const GRADE = EXAMPLE_GRADE;

const claudeMessage = (stop_reason: string, body: unknown) =>
  Response.json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude",
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: "text", text: JSON.stringify(body) }],
  });

/** Claude への呼び出しを数え、reply の応答を返す */
const stubClaude = (
  reply: (init?: RequestInit) => Promise<Response> | Response,
) => {
  const calls: RequestInit[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("api.anthropic.com")) {
      throw new Error(`想定しない fetch: ${url}`);
    }
    calls.push(init ?? {});
    return reply(init);
  }) as typeof fetch;
  return calls;
};

/** 1 回目に英文、2 回目に部品を返す Claude（場面が 1 つできる） */
const sceneClaude = (items: unknown = ITEMS) => {
  const calls = stubClaude(() =>
    claudeMessage("end_turn", calls.length % 2 === 1 ? SENTENCES : items),
  );
  return calls;
};

/** 1 回目は release を呼ぶまで返さず、2 回目はすぐ部品を返す Claude */
const heldClaude = () => {
  let release: () => void = () => {};
  const calls = stubClaude(() =>
    calls.length === 1
      ? new Promise<Response>((resolve) => {
          release = () => resolve(claudeMessage("end_turn", SENTENCES));
        })
      : claudeMessage("end_turn", ITEMS),
  );
  return { calls, release: () => release() };
};

/** 止められるまで返さない Claude */
const hangingClaude = () =>
  stubClaude(
    (init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );

const phases = (ws: Parameters<typeof received>[0]) =>
  received(ws, "room").map((m) => m.phase);

const stateOf = (storage: Map<string, unknown>) =>
  storage.get("state") as RoomState;

test("生成が on なら generating を配ってから AI の場面でラウンドを始め、配置を部屋に置く", async () => {
  const calls = sceneClaude();
  const { room, host, others, storage } = await openRoom(ON);
  const [b] = others;

  await send(room, host, { type: "start", difficulty: GRADE });

  assert.equal(calls.length, 2, "Claude を 2 回（英文 → 部品）呼ぶ");
  for (const ws of [host, b]) {
    assert.deepEqual(phases(ws).slice(-2), ["generating", "playing"]);
    const rounds = received(ws, "round");
    assert.equal(rounds.length, 1);
    assert.match(String(rounds[0].sceneId), /^gen-[0-9a-z]{10}$/);
    assert.equal(received(ws, "progress").length > 0, true);
  }
  const sceneId = String(received(b, "round")[0].sceneId);
  assert.ok(!poolCandidates(GRADE).includes(sceneId), "作り置きではない");
  const stored = storage.get(`layout:${sceneId}`) as SceneLayoutV2;
  assert.equal(stored.id, sceneId);
  assert.equal(stored.name, SENTENCES.name);
  const state = stateOf(storage);
  assert.equal(state.phase, "playing");
  assert.equal(state.generationCount, 1);
  assert.equal(state.generating, null);
  assert.equal(state.current?.sceneName, SENTENCES.name);
  assert.deepEqual(await room.sceneLayout(sceneId), stored);
});

test("生成に失敗したら、黙って同じ難易度の作り置きの場面で始める", async () => {
  for (const reply of [
    () => claudeMessage("refusal", SENTENCES),
    () => claudeMessage("end_turn", { nope: true }),
    () => new Response("oops", { status: 500 }),
    () => {
      throw new TypeError("network down");
    },
  ]) {
    const calls = stubClaude(reply);
    const { room, host, others, storage } = await openRoom(ON);
    await send(room, host, { type: "start", difficulty: GRADE });
    assert.equal(calls.length, 1, "やり直さない");
    const [round] = received(others[0], "round");
    assert.ok(poolCandidates(GRADE).includes(String(round.sceneId)));
    assert.equal(received(others[0], "error").length, 0, "エラーは出さない");
    assert.deepEqual(phases(others[0]).slice(-2), ["generating", "playing"]);
    assert.equal(stateOf(storage).generationCount, 1, "失敗も数える");
    assert.ok(![...storage.keys()].some((k) => k.startsWith("layout:")));
  }
});

test("裏取りで落ちたら、作り直さずに作り置きの場面で始める", async () => {
  // checklist が指す部品（bench）が無い場面
  const calls = sceneClaude({
    items: EXAMPLE_ITEMS.filter((i) => i.key !== "bench" && i.key !== "man"),
  });
  const { room, host, others, storage } = await openRoom(ON);
  await send(room, host, { type: "start", difficulty: GRADE });
  assert.equal(calls.length, 2, "作り直さない");
  const [round] = received(others[0], "round");
  assert.ok(poolCandidates(GRADE).includes(String(round.sceneId)));
  assert.equal(received(others[0], "error").length, 0);
  assert.ok(![...storage.keys()].some((k) => k.startsWith("layout:")));
});

test("生成が off なら今までどおり作り置きの場面ですぐ始める（generating は出さない）", async () => {
  const calls = sceneClaude();
  const { room, host, others } = await openRoom(OFF);
  await send(room, host, { type: "start", difficulty: "eiken-2" });
  assert.equal(calls.length, 0);
  assert.ok(!phases(others[0]).includes("generating"));
  const [round] = received(others[0], "round");
  assert.ok(poolCandidates("eiken-2").includes(String(round.sceneId)));
});

test("sceneId を指定したスタートは生成しない", async () => {
  const calls = sceneClaude();
  const { room, host, others } = await openRoom(ON);
  await send(room, host, { type: "start", sceneId: "park" });
  assert.equal(calls.length, 0);
  assert.equal(received(others[0], "round")[0].sceneId, "park");
});

test("その部屋で 20 回試したら、それ以降は作り置きの場面から選ぶ", async () => {
  const calls = sceneClaude();
  const { ctx, storage, sockets } = await openRoom(ON);
  storage.set("state", { ...stateOf(storage), generationCount: 20 });
  const room = reopen(ctx, ON);
  const [host, b] = sockets;
  await send(room, host, { type: "start", difficulty: GRADE });
  assert.equal(calls.length, 0);
  assert.ok(!phases(b).includes("generating"));
  const [round] = received(b, "round");
  assert.ok(poolCandidates(GRADE).includes(String(round.sceneId)));
});

test("作っている間の 2 回目の start は not_in_lobby で断る", async () => {
  hangingClaude();
  const { room, host, others } = await openRoom(ON);
  const first = send(room, host, { type: "start", difficulty: GRADE });
  await new Promise((r) => setTimeout(r, 10));
  await send(room, host, { type: "start", difficulty: GRADE });
  assert.equal(received(host, "error").at(-1)?.code, "not_in_lobby");
  // 片付け: ホストが抜けて止める
  await send(room, host, { type: "leave" });
  await first;
  assert.equal(received(others[0], "round").length, 1);
});

test("作っている間にホストが抜けたら、生成を止めて残った人で作り置きの場面ですぐ始める", async () => {
  const calls = hangingClaude();
  const { room, host, others, storage, welcomes } = await openRoom(ON, [
    "B",
    "C",
  ]);
  const [b, c] = others;
  const first = send(room, host, { type: "start", difficulty: GRADE });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(stateOf(storage).phase, "generating");
  const signal = calls[0].signal;

  await send(room, host, { type: "leave" });
  assert.equal(signal?.aborted, true, "生成を止めた");
  const state = stateOf(storage);
  assert.equal(state.phase, "playing");
  assert.equal(state.hostId, welcomes[1].playerId, "B がホストになる");
  assert.deepEqual(state.current?.playerIds, [
    welcomes[1].playerId,
    welcomes[2].playerId,
  ]);
  for (const ws of [b, c]) {
    const rounds = received(ws, "round");
    assert.equal(rounds.length, 1);
    assert.ok(poolCandidates(GRADE).includes(String(rounds[0].sceneId)));
  }

  await first;
  assert.equal(received(b, "round").length, 1, "止めた生成では始め直さない");
  assert.equal(stateOf(storage).current?.round, 1);
});

test("ホストが切断しただけでは生成を止めない", async () => {
  const { calls, release } = heldClaude();
  const { room, host, others } = await openRoom(ON);
  const first = send(room, host, { type: "start", difficulty: GRADE });
  await new Promise((r) => setTimeout(r, 10));
  host.close();
  await room.webSocketClose(host);
  assert.equal(calls[0].signal?.aborted, false);
  release();
  await first;
  const [round] = received(others[0], "round");
  assert.match(String(round.sceneId), /^gen-/);
});

test("作っている間に戻ってきた人には generating の room が届く", async () => {
  const { release } = heldClaude();
  const { room, host, others, sockets, welcomes } = await openRoom(ON);
  const first = send(room, host, { type: "start", difficulty: GRADE });
  await new Promise((r) => setTimeout(r, 10));
  const [b] = others;
  b.close();
  await room.webSocketClose(b);

  const { fakeSocket } = await import("./helpers/room-harness");
  const again = fakeSocket();
  sockets.push(again);
  await send(room, again, {
    type: "join",
    name: "B",
    playerId: welcomes[1].playerId,
    token: welcomes[1].token,
  });
  assert.equal(received(again, "room").at(-1)?.phase, "generating");
  assert.equal(received(again, "round").length, 0);

  release();
  await first;
  assert.equal(received(again, "round").length, 1);
});

test("DO が作り直されて生成が途切れていたら、次のメッセージで作り置きの場面にする", async () => {
  hangingClaude();
  const { room, host, ctx, storage, sockets } = await openRoom(ON);
  void send(room, host, { type: "start", difficulty: GRADE });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(stateOf(storage).phase, "generating");

  const fresh = reopen(ctx, ON);
  await send(fresh, sockets[1], { type: "skip", round: 1 });
  const state = stateOf(storage);
  assert.ok(state.phase === "playing" || state.phase === "waiting");
  assert.ok(poolCandidates(GRADE).includes(String(state.current?.sceneId)));
  // 古い DO の生成は 10 秒の timeout まで残るので止めておく
  // biome-ignore lint/suspicious/noExplicitAny: 片付けのために private を触る
  (room as any).generation?.controller.abort();
});

test("GET /scenes/{sceneId}/layout?room= で部屋が作った場面の配置を返す", async () => {
  sceneClaude();
  const { room, host, others } = await openRoom(ON);
  await send(room, host, { type: "start", difficulty: GRADE });
  const sceneId = String(received(others[0], "round")[0].sceneId);
  const env = {
    ROOM: { getByName: (code: string) => (code === "0427" ? room : null) },
  };

  const res = await app.request(`/scenes/${sceneId}/layout?room=0427`, {}, env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as SceneLayoutV2;
  assert.equal(body.id, sceneId);
  assert.equal(body.name, SENTENCES.name);

  const missing = await app.request(
    "/scenes/gen-zzzzzzzzzz/layout?room=0427",
    {},
    env,
  );
  assert.equal(missing.status, 404);
  const noRoom = await app.request(`/scenes/${sceneId}/layout`, {}, env);
  assert.equal(noRoom.status, 404, "room を付けなければ作り置きだけを見る");
  const bad = await app.request(`/scenes/${sceneId}/layout?room=abc`, {}, env);
  assert.equal(bad.status, 400);
  // 作り置きの場面は room を付けてもそのまま返す
  const pool = poolCandidates(GRADE)[0];
  const poolRes = await app.request(
    `/scenes/${pool}/layout?room=0427`,
    {},
    env,
  );
  assert.equal(poolRes.status, 200);
});

const wav = () => {
  const buf = new Uint8Array(64);
  buf.set(new TextEncoder().encode("RIFF"), 0);
  buf.set(new TextEncoder().encode("WAVE"), 8);
  return buf.buffer;
};

test("AI で作った場面は、beginGrading が返す部屋の配置で採点する", async () => {
  sceneClaude();
  const { room, host, others, welcomes } = await openRoom(ON);
  await send(room, host, { type: "start", difficulty: GRADE });
  const sceneId = String(received(others[0], "round")[0].sceneId);

  const begun = await room.beginGrading({
    playerId: welcomes[1].playerId,
    token: welcomes[1].token,
    round: 1,
  });
  assert.ok(begun.ok);
  assert.equal(begun.value.sceneId, sceneId);
  assert.equal(begun.value.layout?.id, sceneId);

  const layout = begun.value.layout as SceneLayoutV2;
  const fixed = await score(
    { SCORING_MODE: "fixed" },
    wav(),
    sceneId,
    "",
    layout,
  );
  assert.ok(fixed.ok, JSON.stringify(fixed));
  assert.equal(
    (await score({ SCORING_MODE: "fixed" }, wav(), sceneId)).ok,
    false,
    "配置が無ければ unknown_scene",
  );

  // live では、部屋の配置の説明文を Claude に渡す
  const bodies: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("stt.speech.microsoft.com")) {
      return Response.json({
        RecognitionStatus: "Success",
        NBest: [
          {
            Display: "A man is walking in the park",
            AccuracyScore: 90,
            FluencyScore: 80,
            ProsodyScore: 80,
            Words: [],
          },
        ],
      });
    }
    bodies.push(String(init?.body));
    return claudeMessage("end_turn", {
      content: 70,
      expression: 60,
      strength: { quote: "walking", text: "動作を言えた" },
      nextStep: { kind: "content", text: "ボールも足そう" },
      rewrite: null,
    });
  }) as typeof fetch;
  const live = await score(
    {
      AZURE_API_KEY: "a",
      AZURE_LOCATION: "japaneast",
      CLAUDE_API_KEY: "c",
      SCORING_MODE: "live",
    },
    wav(),
    sceneId,
    "A man is walking in the park",
    layout,
  );
  assert.ok(live.ok, JSON.stringify(live));
  assert.equal(live.content, 70);
  const user = JSON.parse(bodies[0]).messages[0].content as string;
  assert.ok(user.includes(SENTENCES.description));
});

test("部屋の結果発表には AI で作った場面の名前を出す", async () => {
  sceneClaude();
  const { room, host, others } = await openRoom(ON);
  await send(room, host, { type: "start", difficulty: GRADE });
  await send(room, host, { type: "close" });
  const [results] = received(others[0], "results");
  assert.equal(results.sceneName, SENTENCES.name);
});
