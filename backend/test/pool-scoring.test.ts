import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import index from "../src/scenes/pool/index.json";
import { score } from "../src/scoring";

// Azure と Claude は fetch を差し替えてまねる
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const wav = () => {
  const buf = new Uint8Array(64);
  buf.set(new TextEncoder().encode("RIFF"), 0);
  buf.set(new TextEncoder().encode("WAVE"), 8);
  return buf.buffer;
};

const TRANSCRIPT = "A man is reading a book in a cafe";
const env = {
  AZURE_API_KEY: "a",
  AZURE_LOCATION: "japaneast",
  CLAUDE_API_KEY: "c",
  SCORING_MODE: "live",
};

const stubFetch = (claudeBodies: string[]) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("stt.speech.microsoft.com")) {
      return Response.json({
        RecognitionStatus: "Success",
        NBest: [
          {
            Display: TRANSCRIPT,
            AccuracyScore: 90,
            FluencyScore: 70,
            ProsodyScore: 80,
            Words: [],
          },
        ],
      });
    }
    if (url.includes("api.anthropic.com")) {
      const body =
        input instanceof Request ? await input.text() : String(init?.body);
      claudeBodies.push(body);
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
              content: 80,
              expression: 60,
              strength: { quote: "reading a book", text: "動作を言えた" },
              nextStep: { kind: "content", text: "女の人も足そう" },
              rewrite: null,
            }),
          },
        ],
      });
    }
    throw new Error(`想定しない fetch: ${url}`);
  }) as typeof fetch;
};

test("作り置きの場面は bands（Claude 1 回）で内容・表現を付け、話し方は Azure", async () => {
  const bodies: string[] = [];
  stubFetch(bodies);
  const sceneId = index.easy.scenes[0];
  const r = await score(env, wav(), sceneId);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(bodies.length, 1);
  const sent = JSON.parse(bodies[0]);
  const user = sent.messages[0].content as string;
  assert.match(user, /Scene data:/);
  assert.match(user, /Scene description \(supplement\)/);
  assert.match(user, /pronunciation 90, fluency 70, intonation 80/);
  assert.match(user, new RegExp(`Transcript: ${TRANSCRIPT}`));
  assert.equal(r.content, 80);
  assert.equal(r.expression, 60);
  assert.equal(r.speech, 80);
  assert.equal(r.total, 75); // (80*50 + 60*25 + 80*25) / 100
  assert.deepEqual(r.elements, []);
  assert.equal(r.feedback.nextStep.gain, null);
  assert.equal(r.feedback.nextStep.kind, "content");
  assert.equal(r.feedback.strength.quote, "reading a book");
  assert.equal(r.feedback.speechTip.aspect, "fluency");
});

test("SCORING_MODE=fixed では作り置きの場面でも Claude を呼ばず固定の点", async () => {
  globalThis.fetch = (async () => {
    throw new Error("呼ばない");
  }) as typeof fetch;
  const r = await score(
    { ...env, SCORING_MODE: "fixed" },
    wav(),
    index.hard.scenes[0],
  );
  assert.ok(r.ok);
  assert.equal(r.mode, "fixed");
  assert.equal(r.total, 60);
  assert.equal(r.feedback.nextStep.gain, null);
});
