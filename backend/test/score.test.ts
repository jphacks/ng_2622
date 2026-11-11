// 1 人分の採点の入口（src/scoring/index.ts の score）と、部屋を通さない採点の口（POST /score）。
// Azure と Claude は fetch を差し替えてまねる
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import app from "../src/app";
import { findPoolScene, poolCandidates } from "../src/scenes/pool";
import {
  grammarFor,
  parseWeights,
  score,
  weightedTotal,
  withGain,
} from "../src/scoring";

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

// 作り置きの場面（eiken-3）。checklist は中心 2・細部 1（満点の重み 5）
const SCENE_ID = poolCandidates("eiken-3")[0];
const SCENE = findPoolScene(SCENE_ID);
if (!SCENE) throw new Error("作り置きの場面が無い");
const [CENTER_1, CENTER_2, DETAIL] = SCENE.checklist;

const TRANSCRIPT =
  "A girl is sitting on a bench. I think she is tired. A cat is sleeping.";
const env = {
  AZURE_API_KEY: "a",
  AZURE_LOCATION: "japaneast",
  CLAUDE_API_KEY: "c",
  SCORING_MODE: "live",
};

const claim = (
  quote: string,
  verdict: string,
  item: string | null = null,
  level: string | null = null,
) => ({
  quote,
  verdict,
  item,
  level,
  note: verdict === "absent" ? "場面にいません" : null,
});

const JUDGED = {
  claims: [
    claim("a girl is sitting", "correct", CENTER_1.id, "full"),
    claim("I think she is tired", "ignored"),
    claim("a cat is sleeping", "absent"),
  ],
  expressionBasis: "Correct present continuous.",
  expression: 60,
  nextStep: { kind: "content", text: "犬も足そう", item: CENTER_2.id },
  rewrite: {
    before: "a girl is sitting on a bench",
    after: "A girl is sitting on the bench.",
    reason: "the を付けよう",
  },
};

const stubFetch = (
  claudeBodies: string[],
  judged: unknown = JUDGED,
  display = TRANSCRIPT,
) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("stt.speech.microsoft.com")) {
      return Response.json({
        RecognitionStatus: "Success",
        NBest: [
          {
            Display: display,
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
      if (judged instanceof Error) return new Response("oops", { status: 400 });
      return Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: "text", text: JSON.stringify(judged) }],
      });
    }
    throw new Error(`想定しない fetch: ${url}`);
  }) as typeof fetch;
};

test("作り置きの場面は、チェックリストの採点（Claude 1 回）で内容・表現を付け、話し方は Azure", async () => {
  const bodies: string[] = [];
  stubFetch(bodies);
  const r = await score(env, wav(), SCENE_ID);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(bodies.length, 1);
  // 言えた 2 / 5、正しさ 1 / 2 → 44 点
  assert.equal(r.content, 44);
  assert.equal(r.expression, 60);
  assert.equal(r.speech, 80);
  assert.equal(r.total, 57); // (44×50 + 60×25 + 80×25) / 100
  assert.equal(r.transcript, TRANSCRIPT);
  assert.deepEqual(r.speechDetail, { accuracy: 90, fluency: 70, prosody: 80 });
  assert.equal(r.mode, "live");

  // 内訳: 数えない描写（ignored）は送らず、引用は文字起こしのとおり
  assert.deepEqual(r.breakdown, {
    claims: [
      {
        quote: "A girl is sitting",
        verdict: "correct",
        item: CENTER_1.id,
        level: "full",
        note: null,
      },
      {
        quote: "A cat is sleeping",
        verdict: "absent",
        item: null,
        level: null,
        note: "場面にいません",
      },
    ],
    items: [
      { id: CENTER_1.id, kind: "center", label: CENTER_1.label, level: "full" },
      { id: CENTER_2.id, kind: "center", label: CENTER_2.label, level: "none" },
      { id: DETAIL.id, kind: "detail", label: DETAIL.label, level: "none" },
    ],
    others: 0,
    recall: { earned: 2, max: 5 },
    precision: { correct: 1, said: 2 },
  });

  // 講評: 良かった所（strength）は無い。gain は合計の伸び
  assert.deepEqual(Object.keys(r.feedback), [
    "nextStep",
    "rewrite",
    "speechTip",
  ]);
  // 項目を言えたら 言えた 4 / 5、正しさ 2 / 3 → 内容 73。合計は (73 − 44) × 50 / 100 = 14.5 → 15 点伸びる
  assert.deepEqual(r.feedback.nextStep, {
    kind: "content",
    text: "犬も足そう",
    item: CENTER_2.id,
    gain: 15,
  });
  assert.deepEqual(r.feedback.rewrite, JUDGED.rewrite);
  assert.equal(r.feedback.speechTip.aspect, "fluency");
});

test("Claude には、級・級の文法の一覧（GRADES）・関係つきの場面・checklist・見本・話し方の点・文字起こしを渡す", async () => {
  const bodies: string[] = [];
  stubFetch(bodies);
  await score(env, wav(), SCENE_ID);
  const sent = JSON.parse(bodies[0]);
  const user = sent.messages[0].content as string;
  assert.match(user, /^Grade: eiken-3\n/);
  const { grammar, grammarAbove } = grammarFor("eiken-3");
  assert.ok(grammar.length > 0 && grammarAbove && grammarAbove.length > 0);
  for (const g of [...grammar, ...grammarAbove]) {
    assert.ok(user.includes(`- ${g}`), g);
  }
  assert.match(user, /Forms added in the next grade up:/);
  assert.match(user, /Scene data:\nCoordinates: [\s\S]*\nRelations: /);
  assert.match(user, / {2}place: sit_on bench/);
  assert.ok(user.includes(`- ${CENTER_1.id} [center] ${CENTER_1.label}`));
  assert.ok(user.includes(`Model answer (supplement): ${SCENE.description}`));
  assert.match(user, /pronunciation 90, fluency 70, intonation 80/);
  assert.ok(user.endsWith(`Transcript: ${TRANSCRIPT}`));
  // 良かった所は書かせない
  assert.ok(!("strength" in sent.output_config.format.schema.properties));
  assert.doesNotMatch(sent.system, /strength/);
});

test("級の文法の一覧は下の級の分も含み、一つ上の級が無い 2級では上の分を渡さない", () => {
  const pre2 = grammarFor("eiken-pre2");
  for (const g of grammarFor("eiken-3").grammar) {
    assert.ok(pre2.grammar.includes(g));
  }
  assert.ok(pre2.grammar.length > grammarFor("eiken-3").grammar.length);
  assert.equal(grammarFor("eiken-2").grammarAbove, undefined);
});

test("言い換えは、元の文が文字起こしに無い・直した後が同じなら出さない", async () => {
  for (const rewrite of [
    { before: "a boy is running", after: "A boy is running.", reason: "x" },
    { before: "A girl is sitting", after: "a girl is sitting.", reason: "x" },
  ]) {
    stubFetch([], { ...JUDGED, rewrite });
    const r = await score(env, wav(), SCENE_ID);
    assert.ok(r.ok);
    assert.equal(r.feedback.rewrite, null);
  }
});

test("端末の文字起こしがあれば、Claude の採点と結果に使う", async () => {
  const bodies: string[] = [];
  stubFetch(bodies, JUDGED, "something else");
  const r = await score(env, wav(), SCENE_ID, TRANSCRIPT);
  assert.ok(r.ok, JSON.stringify(r));
  const user = JSON.parse(bodies[0]).messages[0].content as string;
  assert.ok(user.endsWith(`Transcript: ${TRANSCRIPT}`));
  assert.equal(r.transcript, TRANSCRIPT);
  assert.equal(r.breakdown.claims.length, 2);
});

test("3 語未満の発話は Claude を呼ばず、内容・表現を 0 点にする", async () => {
  const bodies: string[] = [];
  stubFetch(bodies, JUDGED, "A dog");
  const r = await score(env, wav(), SCENE_ID);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(bodies.length, 0);
  assert.equal(r.content, 0);
  assert.equal(r.expression, 0);
  assert.equal(r.total, 20); // 話し方 80 × 25 / 100
  assert.deepEqual(r.breakdown.claims, []);
  assert.deepEqual(
    r.breakdown.items.map((i) => i.level),
    ["none", "none", "none"],
  );
  assert.deepEqual(r.breakdown.recall, { earned: 0, max: 5 });
  assert.deepEqual(r.breakdown.precision, { correct: 0, said: 0 });
  assert.deepEqual(r.feedback.nextStep, {
    kind: "content",
    text: "もう少し長く、文にして話してみよう。",
    item: null,
    gain: null,
  });
  assert.equal(r.feedback.rewrite, null);
});

test("表現・話し方を勧めたときと、項目を全部言えたときは、item も gain も null", async () => {
  stubFetch([], {
    ...JUDGED,
    nextStep: { kind: "speech", text: "ゆっくり話そう", item: CENTER_2.id },
  });
  const speech = await score(env, wav(), SCENE_ID);
  assert.ok(speech.ok);
  assert.deepEqual(speech.feedback.nextStep, {
    kind: "speech",
    text: "ゆっくり話そう",
    item: null,
    gain: null,
  });

  const all =
    "A girl is sitting. A dog is running. There is a bicycle next to the bench.";
  stubFetch(
    [],
    {
      ...JUDGED,
      claims: [
        claim("a girl is sitting", "correct", CENTER_1.id, "full"),
        claim("a dog is running", "correct", CENTER_2.id, "full"),
        claim(
          "there is a bicycle next to the bench",
          "correct",
          DETAIL.id,
          "full",
        ),
      ],
      nextStep: { kind: "content", text: "もう一言足そう", item: CENTER_1.id },
      rewrite: null,
    },
    all,
  );
  const full = await score(env, wav(), SCENE_ID);
  assert.ok(full.ok);
  assert.equal(full.content, 100);
  assert.deepEqual(full.feedback.nextStep, {
    kind: "content",
    text: "もう一言足そう",
    item: null,
    gain: null,
  });
});

test("gain は SCORE_WEIGHTS の重みで出す（合計を出すのと同じ式）", async () => {
  stubFetch([]);
  const contentOnly = await score(
    { ...env, SCORE_WEIGHTS: "100,0,0" },
    wav(),
    SCENE_ID,
  );
  assert.ok(contentOnly.ok);
  assert.equal(contentOnly.total, 44);
  assert.equal(contentOnly.feedback.nextStep.gain, 73 - 44);

  stubFetch([]);
  const noContent = await score(
    { ...env, SCORE_WEIGHTS: "0,50,50" },
    wav(),
    SCENE_ID,
  );
  assert.ok(noContent.ok);
  assert.equal(noContent.feedback.nextStep.gain, 0);
});

test("合計と gain の式", () => {
  assert.deepEqual(parseWeights(undefined), [50, 25, 25]);
  assert.deepEqual(parseWeights("60,20,20"), [60, 20, 20]);
  for (const bad of ["1,2", "a,b,c", "-1,1,1", "0,0,0"]) {
    assert.deepEqual(parseWeights(bad), [50, 25, 25]);
  }
  assert.equal(weightedTotal([50, 25, 25], 80, 60, 80), 75);
  const score0 = { content: 40, expression: 60, speech: 80 };
  // 内容が 40 → 70 なら、合計は 30 × 50 / 100 = 15 点伸びる
  assert.equal(
    withGain(
      { kind: "content", text: "t", item: "x", contentIfSaid: 70 },
      [50, 25, 25],
      score0,
    ).gain,
    15,
  );
  assert.equal(
    withGain(
      { kind: "content", text: "t", item: null, contentIfSaid: null },
      [50, 25, 25],
      score0,
    ).gain,
    null,
  );
});

test("SCORING_MODE=fixed では Claude も Azure も呼ばず固定の点。内訳は項目が全部 none", async () => {
  globalThis.fetch = (async () => {
    throw new Error("呼ばない");
  }) as typeof fetch;
  const r = await score({ ...env, SCORING_MODE: "fixed" }, wav(), SCENE_ID);
  assert.ok(r.ok);
  assert.equal(r.mode, "fixed");
  assert.equal(r.total, 60);
  assert.equal(r.breakdown.items.length, SCENE.checklist.length);
  assert.ok(r.breakdown.items.every((i) => i.level === "none"));
  assert.equal(r.feedback.nextStep.gain, null);
  assert.equal(r.feedback.nextStep.item, null);
});

test("無い場面（外した手作りの場面も）は unknown_scene、WAV でなければ invalid_audio、Claude の失敗は api_error", async () => {
  for (const id of ["park", "gen-xxxxxxxxxx"]) {
    const r = await score(env, wav(), id);
    assert.ok(!r.ok);
    assert.equal(r.reason, "unknown_scene");
  }
  const bad = await score(env, new ArrayBuffer(8), SCENE_ID);
  assert.ok(!bad.ok);
  assert.equal(bad.reason, "invalid_audio");

  stubFetch([], new Error("Claude が落ちた"));
  const failed = await score(env, wav(), SCENE_ID);
  assert.ok(!failed.ok);
  assert.equal(failed.reason, "api_error");
});

// ---- POST /score（部屋を通さない採点の口。ENABLE_DEV_ROUTES のときだけ開く） ----

const post = (body: unknown, vars: Record<string, string> = {}) =>
  app.request(
    "/score",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { ENABLE_DEV_ROUTES: "true", ...vars },
  );
const LAYOUT = {
  difficulty: SCENE.difficulty,
  description: SCENE.description,
  checklist: SCENE.checklist,
  items: SCENE.items,
};

test("POST /score は、/2 の配置（difficulty・checklist・items）と文字起こしをチェックリストで採点する", async () => {
  const bodies: string[] = [];
  stubFetch(bodies);
  const res = await post(
    { layout: LAYOUT, transcript: TRANSCRIPT },
    { CLAUDE_API_KEY: "c", SCORING_MODE: "live" },
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    content: number;
    expression: number;
    breakdown: { recall: unknown; claims: unknown[] };
    feedback: { nextStep: unknown; rewrite: unknown };
  };
  assert.equal(body.content, 44);
  assert.equal(body.expression, 60);
  assert.deepEqual(body.breakdown.recall, { earned: 2, max: 5 });
  assert.equal(body.breakdown.claims.length, 2);
  // 話し方の点は無いので、gain は話し方を変えないとしたときの合計の伸び
  assert.deepEqual(body.feedback.nextStep, {
    kind: "content",
    text: "犬も足そう",
    item: CENTER_2.id,
    gain: 15,
  });
  assert.deepEqual(Object.keys(body.feedback), ["nextStep", "rewrite"]);
  const user = JSON.parse(bodies[0]).messages[0].content as string;
  assert.match(user, /^Grade: eiken-3\n/);
  assert.doesNotMatch(user, /Speech scores/);
});

test("POST /score は、形が違えば 400、fixed なら固定の点、口を開けていなければ 404", async () => {
  for (const layout of [
    { ...LAYOUT, difficulty: "easy" },
    { ...LAYOUT, checklist: [] },
    { description: "A park.", items: LAYOUT.items },
  ]) {
    const res = await post({ layout, transcript: TRANSCRIPT });
    assert.equal(res.status, 400);
  }
  const fixed = await post(
    { layout: LAYOUT, transcript: TRANSCRIPT },
    { SCORING_MODE: "fixed" },
  );
  assert.equal(fixed.status, 200);
  const body = (await fixed.json()) as { content: number; mode: string };
  assert.equal(body.content, 60);
  assert.equal(body.mode, "fixed");

  const closed = await post(
    { layout: LAYOUT, transcript: TRANSCRIPT },
    { ENABLE_DEV_ROUTES: "false" },
  );
  assert.equal(closed.status, 404);
});
