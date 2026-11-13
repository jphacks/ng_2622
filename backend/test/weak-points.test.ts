// 苦手の分析の口（POST /weak-points）のテスト。Claude と数える場所は差し替え、本物は呼ばない
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { CreateMessage } from "../src/analysis/weakPoints";
import app from "../src/app";
import type { UsageCounterRepository } from "../src/repositories/usageCounterRepository";
import { makeWeakPointRoutes } from "../src/routes/weakPoints";

const transcriptOf = (n: number) =>
  [
    "A boy is running in the park.",
    "A girl is sitting on the bench.",
    "Woman is cooking at the stove.",
    "A man is reading book.",
    "A dog is running because the boy threw the ball.",
    "There is a tree behind the bench.",
    "A boy is carrying box.",
    "A girl is blowing out the candles.",
    "A man is cleaning the floor because there is glass on it.",
    "There is a bottle on the table.",
  ][n - 1];

const round = (n: number) => ({
  n,
  grade: "eiken-pre2",
  transcript: transcriptOf(n),
  claims: [
    { quote: transcriptOf(n), verdict: "correct", item: "a", note: null },
  ],
  rewrite: null,
  nextStep: { kind: "content", text: "理由を足そう。", item: "why" },
  expressionBasis: n <= 2 ? null : "Uses the present continuous correctly.",
  scene: {
    description: "A boy is running because it is raining.",
    missedItems: [
      {
        id: "why",
        kind: "reason",
        label: "男の子が走っている理由",
        accept: "a boy is running because it is raining",
        level: "none",
      },
    ],
  },
});

const body = (count = 10, extra: Record<string, unknown> = {}) => ({
  rounds: Array.from({ length: count }, (_, i) => round(i + 1)),
  counts: {
    rounds: count,
    kinds: [
      { kind: "center", earned: 14, total: 20 },
      { kind: "reason", earned: 2, total: 10 },
    ],
    verdicts: { correct: 20, contradiction: 3, absent: 1, offtopic: 0 },
    halves: {
      first: { rounds: Math.floor(count / 2), content: 40, expression: 55 },
      second: { rounds: Math.floor(count / 2), content: 60, expression: 62 },
    },
  },
  ...extra,
});

const ENV = {
  WEAK_POINT_ANALYSIS: "on",
  WEAK_POINT_IP_PER_HOUR: "10",
  WEAK_POINT_DAILY_LIMIT: "200",
  WEAK_POINT_MAX_BODY_BYTES: "204800",
};

/** 数える場所のまね。take の結果を決め、呼ばれた回数を数える */
const fakeUsage = (
  take: Awaited<ReturnType<UsageCounterRepository["take"]>> = { ok: true },
  daily = true,
) => {
  const calls = { take: [] as string[], takeDaily: 0 };
  const usage: UsageCounterRepository = {
    take: async (ip) => {
      calls.take.push(ip);
      return take;
    },
    takeDaily: async () => {
      calls.takeDaily++;
      return daily;
    },
  };
  return { usage, calls };
};

type Reply = Record<string, unknown> | string | Error;

/** Claude のまね。replies を順に返し、受け取った params を残す */
const fakeClaude = (...replies: Reply[]) => {
  const seen: { params: Parameters<CreateMessage>[0]; timeout: number }[] = [];
  const create: CreateMessage = async (params, options) => {
    seen.push({ params, timeout: options.timeout });
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return {
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: typeof reply === "string" ? reply : JSON.stringify(reply),
          citations: null,
        },
      ],
      usage: {
        input_tokens: 9000,
        output_tokens: 1200,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      } as never,
    };
  };
  return { create, seen };
};

const goodAnalysis = {
  habits: [
    {
      viewpoint: "expression",
      title: "a や the が抜ける",
      what: "名詞の前の a や the が抜けている。",
      examples: [
        { n: 3, quote: "woman is cooking at the stove" },
        { n: 4, quote: "A man is reading book" },
        { n: 7, quote: "carrying box" },
        { n: 9, quote: "not in the transcript" },
      ],
      fix: '名詞の前に a を付けよう。"A man is reading a book."',
    },
  ],
  improvement: {
    viewpoint: "content",
    text: "理由を言えるようになった。",
    example: {
      n: 9,
      quote: "a man is cleaning the floor because there is glass on it",
    },
  },
  nextTry: {
    viewpoint: "expression",
    text: '名詞の前に a を付けてみよう。"A boy is carrying a box."',
  },
};

const fakeHabits = {
  habits: [
    {
      viewpoint: "content",
      title: "理由が無い",
      what: "理由を言っていない。",
      examples: [
        { n: 1, quote: "A boy is running to school" },
        { n: 2, quote: "A girl is sitting on a chair" },
      ],
      fix: "because を足そう。",
    },
  ],
  improvement: null,
  nextTry: { viewpoint: "content", text: "because を足そう。" },
};

const post = async (
  payload: unknown,
  options: {
    env?: Record<string, unknown>;
    create?: CreateMessage;
    usage?: UsageCounterRepository;
    now?: () => number;
    raw?: string;
  } = {},
) => {
  const routes = makeWeakPointRoutes({
    create: options.create,
    now: options.now,
    usage: options.usage
      ? () => options.usage as UsageCounterRepository
      : undefined,
  });
  const res = await routes.request(
    "/weak-points",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "203.0.113.7",
      },
      body: options.raw ?? JSON.stringify(payload),
    },
    { ...ENV, ...options.env },
  );
  // 壊れた JSON は hono の validator が JSON でない 400 を返す
  const text = await res.text();
  const json = (text.startsWith("{") ? JSON.parse(text) : {}) as Record<
    string,
    unknown
  >;
  return { res, json };
};

const codeOf = (json: Record<string, unknown>) =>
  (json.error as { code: string }).code;

/** console.log と console.error に出たものを集める（本文が出ていないかを見る） */
const captureLogs = async <T>(fn: () => Promise<T>) => {
  const lines: string[] = [];
  const { log, error } = console;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) =>
    lines.push(args.map(String).join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.log = log;
    console.error = error;
  }
};

test("止めてあれば（PR のプレビュー）、本文を読む前に 503 で断り、Claude も数える場所も呼ばない", async () => {
  const claude = fakeClaude(goodAnalysis);
  const { usage, calls } = fakeUsage();
  for (const env of [
    { WEAK_POINT_ANALYSIS: "off" },
    { WEAK_POINT_ANALYSIS: undefined },
  ]) {
    for (const payload of [body(), {}]) {
      const { res, json } = await post(payload, {
        env,
        create: claude.create,
        usage,
      });
      assert.equal(res.status, 503);
      assert.equal(codeOf(json), "analysis_unavailable");
    }
  }
  assert.equal(claude.seen.length, 0);
  assert.equal(calls.take.length, 0);
});

test("wrangler.jsonc は本番で分析を on、プレビューで off にし、数える Durable Object を新しい tag で足している", () => {
  const text = readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  );
  // 行の頭の // のコメントだけを消して読む（値の中に // は無い）
  const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(config.vars.WEAK_POINT_ANALYSIS, "on");
  assert.equal(config.vars.WEAK_POINT_IP_PER_HOUR, "10");
  assert.equal(config.vars.WEAK_POINT_DAILY_LIMIT, "200");
  assert.equal(config.vars.WEAK_POINT_MAX_BODY_BYTES, "204800");
  assert.equal(config.previews.vars.WEAK_POINT_ANALYSIS, "off");
  for (const bindings of [
    config.durable_objects.bindings,
    config.previews.durable_objects.bindings,
  ]) {
    assert.ok(
      bindings.some(
        (b: { name: string; class_name: string }) =>
          b.name === "USAGE_COUNTER" && b.class_name === "UsageCounter",
      ),
    );
  }
  const tags = config.migrations.map((m: { tag: string }) => m.tag);
  assert.deepEqual(tags, ["v1", "v2", "v3", "v4", "v5"]);
  assert.deepEqual(config.migrations[4].new_sqlite_classes, ["UsageCounter"]);
});

test("本文の形を確かめ、違えば 400 で Claude を呼ばない", async () => {
  const claude = fakeClaude(goodAnalysis);
  const { usage, calls } = fakeUsage();
  const tooManyClaims = body();
  tooManyClaims.rounds[0].claims = Array.from({ length: 31 }, () => ({
    quote: "x",
    verdict: "correct",
    item: null,
    note: null,
  }));
  const longTranscript = body();
  longTranscript.rounds[0].transcript = "a".repeat(2001);
  const badOrder = body();
  badOrder.rounds[1].n = 5;
  const badGrade = body();
  badGrade.rounds[0].grade = "hard";
  const cases: [string, unknown][] = [
    ["4 件", body(4)],
    ["11 件", { ...body(10), rounds: [...body(10).rounds, round(10)] }],
    ["番号が古い順に 1 からでない", badOrder],
    ["文字起こしが 2000 文字を超える", longTranscript],
    ["描写が 30 個を超える", tooManyClaims],
    ["級が違う", badGrade],
    ["counts が無い", { rounds: body().rounds }],
  ];
  for (const [label, payload] of cases) {
    const { res, json } = await post(payload, { create: claude.create, usage });
    assert.equal(res.status, 400, label);
    assert.equal(codeOf(json), "invalid_message", label);
  }
  const { res } = await post(undefined, {
    raw: "{not json",
    create: claude.create,
    usage,
  });
  assert.equal(res.status, 400);
  assert.equal(claude.seen.length, 0);
  assert.equal(calls.take.length, 0);
});

test("本文が上限（WEAK_POINT_MAX_BODY_BYTES）を超えたら 413", async () => {
  const claude = fakeClaude(goodAnalysis);
  const { res, json } = await post(body(), {
    env: { WEAK_POINT_MAX_BODY_BYTES: "1000" },
    create: claude.create,
    usage: fakeUsage().usage,
  });
  assert.equal(res.status, 413);
  assert.equal(codeOf(json), "invalid_message");
  assert.equal(claude.seen.length, 0);
});

test("回数の上限に達したら 429 で、Claude を呼ばない。IP は CF-Connecting-IP から数える", async () => {
  for (const reason of ["ip_hourly", "daily"] as const) {
    const claude = fakeClaude(goodAnalysis);
    const { usage, calls } = fakeUsage({ ok: false, reason });
    const { res, json } = await post(body(), { create: claude.create, usage });
    assert.equal(res.status, 429);
    assert.equal(codeOf(json), "rate_limited");
    assert.deepEqual(calls.take, ["203.0.113.7"]);
    assert.equal(claude.seen.length, 0);
  }
});

test("Claude のキーが無ければ 503 で、数える場所も呼ばない", async () => {
  const res = await app.request(
    "/weak-points",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    },
    ENV,
  );
  assert.equal(res.status, 503);
  assert.equal(
    codeOf((await res.json()) as Record<string, unknown>),
    "analysis_unavailable",
  );
});

test("確かめを通った分析を返す。実例は文字起こしのとおりに直し、見つからないものは捨てる", async () => {
  const claude = fakeClaude(goodAnalysis);
  const { usage, calls } = fakeUsage();
  const { res, json } = await post(body(), { create: claude.create, usage });
  assert.equal(res.status, 200);
  assert.deepEqual(json, {
    habits: [
      {
        viewpoint: "expression",
        title: "a や the が抜ける",
        what: "名詞の前の a や the が抜けている。",
        examples: [
          { n: 7, quote: "carrying box" },
          { n: 4, quote: "A man is reading book" },
          { n: 3, quote: "Woman is cooking at the stove" },
        ],
        fix: '名詞の前に a を付けよう。"A man is reading a book."',
      },
    ],
    improvement: {
      viewpoint: "content",
      text: "理由を言えるようになった。",
      example: {
        n: 9,
        quote: "A man is cleaning the floor because there is glass on it",
      },
    },
    nextTry: {
      viewpoint: "expression",
      text: '名詞の前に a を付けてみよう。"A boy is carrying a box."',
    },
    retries: 0,
  });
  assert.equal(calls.take.length, 1);
  assert.equal(calls.takeDaily, 0);
  assert.equal(claude.seen.length, 1);
});

test("Claude には送られた欄だけを渡し、前半と後半の回を書き添える。モデルと effort は既定が Sonnet 5.5 の low", async () => {
  const claude = fakeClaude(goodAnalysis);
  const payload = body(7) as ReturnType<typeof body> & Record<string, unknown>;
  // 送ってはいけない欄が混ざっても、Claude には渡さない
  (payload.rounds[0] as Record<string, unknown>).playerName = "はなこ";
  (payload.rounds[0] as Record<string, unknown>).recordId = "8d4d75f1-0000";
  payload.deviceId = "device-1234";
  await post(payload, { create: claude.create, usage: fakeUsage().usage });
  const { params, timeout } = claude.seen[0];
  assert.equal(params.model, "claude-sonnet-5-5");
  assert.equal(params.output_config?.effort, "low");
  assert.equal(params.output_config?.format?.type, "json_schema");
  assert.ok(timeout <= 25_000);
  const user = params.messages[0].content as string;
  assert.ok(user.includes(transcriptOf(1)));
  assert.ok(
    user.includes(
      "First half: rounds 1-3. Second half: rounds 5-7. Round 4 is in neither half.",
    ),
  );
  for (const secret of ["はなこ", "8d4d75f1", "device-1234"]) {
    assert.ok(!user.includes(secret), secret);
  }

  const other = fakeClaude(goodAnalysis);
  await post(body(), {
    env: {
      CLAUDE_ANALYSIS_MODEL: "claude-opus-5-5",
      CLAUDE_ANALYSIS_EFFORT: "medium",
    },
    create: other.create,
    usage: fakeUsage().usage,
  });
  assert.equal(other.seen[0].params.model, "claude-opus-5-5");
  assert.equal(other.seen[0].params.output_config?.effort, "medium");
});

test("確かめで癖が全部落ちたら、呼び直しの前に 1 日の回数を 1 つ足して、1 回だけ呼び直す", async () => {
  const claude = fakeClaude(fakeHabits, goodAnalysis);
  const { usage, calls } = fakeUsage();
  const { res, json } = await post(body(), { create: claude.create, usage });
  assert.equal(res.status, 200);
  assert.equal(json.retries, 1);
  assert.equal((json.habits as unknown[]).length, 1);
  assert.equal(calls.takeDaily, 1);
  assert.equal(claude.seen.length, 2);
});

test("呼び直しても全部落ちたら、癖を空にして、呼び直しの良くなった点と次に試すことを返す", async () => {
  const claude = fakeClaude(fakeHabits, fakeHabits);
  const { res, json } = await post(body(), {
    create: claude.create,
    usage: fakeUsage().usage,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(json, {
    habits: [],
    improvement: null,
    nextTry: { viewpoint: "content", text: "because を足そう。" },
    retries: 1,
  });
  assert.equal(claude.seen.length, 2);
});

test("Claude が最初から癖を返さなければ呼び直さない", async () => {
  const claude = fakeClaude({ ...goodAnalysis, habits: [] }, goodAnalysis);
  const { usage, calls } = fakeUsage();
  const { res, json } = await post(body(), { create: claude.create, usage });
  assert.equal(res.status, 200);
  assert.deepEqual(json.habits, []);
  assert.equal(json.retries, 0);
  assert.equal(claude.seen.length, 1);
  assert.equal(calls.takeDaily, 0);
});

test("引用以外の確かめ（数字・空の欄）で癖が 0 件になっても呼び直し、2 回目の応答だけを使う", async () => {
  const numbered = structuredClone(goodAnalysis);
  numbered.habits[0].what = "冠詞が 4割 抜けている。";
  const blankFix = structuredClone(goodAnalysis);
  blankFix.habits[0].fix = " ";
  const second = structuredClone(goodAnalysis);
  second.nextTry.text = "2 回目の次に試すこと。";
  for (const first of [numbered, blankFix]) {
    const claude = fakeClaude(first, second);
    const { usage, calls } = fakeUsage();
    const { res, json } = await post(body(), { create: claude.create, usage });
    assert.equal(res.status, 200);
    assert.equal(json.retries, 1);
    assert.equal((json.habits as unknown[]).length, 1);
    assert.equal(
      (json.nextTry as { text: string }).text,
      "2 回目の次に試すこと。",
    );
    assert.equal(claude.seen.length, 2);
    assert.equal(calls.takeDaily, 1);
  }
});

test("級が分からない回（grade が null）は、Claude に unknown と渡す", async () => {
  const claude = fakeClaude(goodAnalysis);
  const payload = body();
  (payload.rounds[0] as Record<string, unknown>).grade = null;
  const { res } = await post(payload, {
    create: claude.create,
    usage: fakeUsage().usage,
  });
  assert.equal(res.status, 200);
  const user = claude.seen[0].params.messages[0].content as string;
  assert.ok(user.includes('"n":1,"grade":"unknown"'));
  assert.ok(user.includes('"n":2,"grade":"eiken-pre2"'));
});

test("全体の 1 日の上限に達していれば呼び直さない", async () => {
  const claude = fakeClaude(fakeHabits, goodAnalysis);
  const { usage, calls } = fakeUsage({ ok: true }, false);
  const { res, json } = await post(body(), { create: claude.create, usage });
  assert.equal(res.status, 200);
  assert.deepEqual(json.habits, []);
  assert.equal(json.retries, 0);
  assert.equal(calls.takeDaily, 1);
  assert.equal(claude.seen.length, 1);
});

test("残りの時間が足りなければ呼び直さず、呼び直しの時間は残りの分にする", async () => {
  // 1 回目に 21 秒かかった（残り 4 秒。呼び直しは残りが 12 秒以上のときだけ）
  let t = 0;
  const slow: CreateMessage = async (params, options) => {
    t += 21_000;
    return fakeClaude(fakeHabits).create(params, options);
  };
  const claude1 = await post(body(), {
    create: slow,
    usage: fakeUsage().usage,
    now: () => t,
  });
  assert.equal(claude1.json.retries, 0);

  // 1 回目に 14 秒かかった（残り 11 秒。12 秒に足りない）
  t = 0;
  const middle: CreateMessage = async (params, options) => {
    t += 14_000;
    return fakeClaude(fakeHabits).create(params, options);
  };
  const claude2 = await post(body(), {
    create: middle,
    usage: fakeUsage().usage,
    now: () => t,
  });
  assert.equal(claude2.json.retries, 0);

  // 1 回目に 10 秒かかった（残り 15 秒）
  t = 0;
  const timeouts: number[] = [];
  const replies = [fakeHabits, goodAnalysis];
  const timed: CreateMessage = async (params, options) => {
    timeouts.push(options.timeout);
    t += 10_000;
    return fakeClaude(replies[timeouts.length - 1]).create(params, options);
  };
  const res = await post(body(), {
    create: timed,
    usage: fakeUsage().usage,
    now: () => t,
  });
  assert.equal(res.json.retries, 1);
  assert.deepEqual(timeouts, [25_000, 15_000]);
});

test("Claude が失敗した・途中で止まった・JSON が読めないときは 502。呼び直しの失敗では落とさない", async () => {
  const stopped: CreateMessage = async () => ({
    stop_reason: "refusal",
    content: [],
    usage: { input_tokens: 0, output_tokens: 0 } as never,
  });
  for (const create of [
    fakeClaude(new Error("network")).create,
    fakeClaude("{broken: Woman is cooking").create,
    stopped,
  ]) {
    const { res, json } = await post(body(), {
      create,
      usage: fakeUsage().usage,
    });
    assert.equal(res.status, 502);
    assert.equal(codeOf(json), "analysis_failed");
    // 本文（文字起こし）を返さない
    assert.ok(!JSON.stringify(json).includes("Woman is cooking"));
  }
  const retryFails = fakeClaude(fakeHabits, new Error("network"));
  const { res, json } = await post(body(), {
    create: retryFails.create,
    usage: fakeUsage().usage,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(json.habits, []);
  assert.equal(json.retries, 1);
});

test("ログには件数と理由だけを出し、文字起こし・引用・Claude の文を出さない", async () => {
  const secrets = [
    transcriptOf(3),
    "Woman is cooking",
    "a や the が抜ける",
    "名詞の前",
  ];
  const ok = await captureLogs(() =>
    post(body(), {
      create: fakeClaude(fakeHabits, goodAnalysis).create,
      usage: fakeUsage().usage,
    }),
  );
  const failed = await captureLogs(() =>
    post(body(), {
      create: fakeClaude("{broken: Woman is cooking").create,
      usage: fakeUsage().usage,
    }),
  );
  const limited = await captureLogs(() =>
    post(body(), {
      usage: fakeUsage({ ok: false, reason: "daily" }).usage,
      create: fakeClaude(goodAnalysis).create,
    }),
  );
  const lines = [...ok.lines, ...failed.lines, ...limited.lines];
  assert.ok(lines.some((l) => l.includes("weak_points_analyzed")));
  assert.ok(lines.some((l) => l.includes("weak_points_failed")));
  assert.ok(lines.some((l) => l.includes("weak_points_limited")));
  for (const line of lines) {
    for (const s of secrets)
      assert.ok(!line.includes(s), `${s} が出た: ${line}`);
    assert.ok(!line.includes("203.0.113.7"));
  }
});

test("null を許す欄は、欄が無くても null として読む（iOS は nil の欄を書かずに送る）", async () => {
  const claude = fakeClaude(goodAnalysis);
  const payload = body();
  const first = payload.rounds[0] as Record<string, unknown>;
  for (const key of ["grade", "rewrite", "expressionBasis"]) delete first[key];
  first.nextStep = { kind: "content", text: "理由を足そう。" };
  first.claims = [{ quote: transcriptOf(1), verdict: "correct" }];
  const { res } = await post(payload, {
    create: claude.create,
    usage: fakeUsage().usage,
  });
  assert.equal(res.status, 200);
  const user = claude.seen[0].params.messages[0].content as string;
  assert.ok(
    user.includes(
      `{"n":1,"grade":"unknown","transcript":"${transcriptOf(1)}","claims":[{"quote":"${transcriptOf(1)}","verdict":"correct","item":null,"note":null}],"rewrite":null,"nextStep":{"kind":"content","text":"理由を足そう。","item":null},"expressionBasis":null,`,
    ),
  );
});
