// 苦手の分析で Claude が返した文の確かめ（src/analysis/verify.ts）のテスト。Claude は呼ばない
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasNumber,
  type RawAnalysis,
  secondHalf,
  verifyAnalysis,
} from "../src/analysis/verify";

const rounds = [
  { n: 1, transcript: "A boy is running. The dog is sitting on the grass." },
  { n: 2, transcript: "A woman is cooking. Boy is carrying box." },
  { n: 3, transcript: "A man is reading a book, and a girl is looking." },
  { n: 4, transcript: "A girl is carrying a bucket. A boy is building." },
  {
    n: 5,
    transcript:
      "A man is running because it is raining. There is a bench next to the tree.",
  },
];

const habit = (over: Record<string, unknown> = {}) => ({
  viewpoint: "content",
  title: "理由をつけずに終わる",
  what: "動作は言えているが、なぜかを言っていない。",
  examples: [
    { n: 1, quote: "a boy is running" },
    { n: 2, quote: "A woman is cooking." },
  ],
  fix: '動作の後に because を足そう。"A boy is running because he is late."',
  ...over,
});

const verify = (raw: RawAnalysis) => verifyAnalysis(rounds, raw);

test("実例は大文字小文字と句読点を無視して探し、文字起こしのとおりの文字列に直す", () => {
  const { analysis, stats } = verify({
    habits: [habit()],
    improvement: null,
    nextTry: { viewpoint: "content", text: "because を足そう。" },
  });
  assert.equal(analysis.habits.length, 1);
  assert.deepEqual(analysis.habits[0].examples, [
    { n: 2, quote: "A woman is cooking" },
    { n: 1, quote: "A boy is running" },
  ]);
  assert.deepEqual(stats.examples, { total: 2, found: 2 });
  assert.equal(stats.kept, 1);
});

test("見つからない実例・送っていない回の実例は捨て、2 つの違う回に残らなければ癖ごと捨てる", () => {
  const { analysis, stats } = verify({
    habits: [
      habit({
        examples: [
          { n: 1, quote: "A boy is running" },
          // 文字起こしに無い（直した文）
          { n: 2, quote: "A boy is carrying a box" },
          // 送っていない回
          { n: 9, quote: "A boy is running" },
        ],
      }),
      habit({
        examples: [
          { n: 1, quote: "A boy is running" },
          // 同じ回の同じ引用は 1 つにまとめる
          { n: 1, quote: "a boy is running." },
        ],
      }),
    ],
    improvement: null,
    nextTry: null,
  });
  assert.deepEqual(analysis.habits, []);
  assert.equal(stats.dropped.quote, 2);
  assert.deepEqual(stats.examples, { total: 5, found: 3 });
});

test("実例は違う回のものを先に、新しい回から 1 回に 1 つ選び、足りなければ残りを新しい回から足す（3 つまで、新しい回から並べる）", () => {
  const pick = (examples: { n: number; quote: string }[]) =>
    verify({ habits: [habit({ examples })], improvement: null, nextTry: null })
      .analysis.habits[0].examples;
  // 1 回目に 2 つあっても、違う回（1・2・3 回目）を 1 つずつ選ぶ。1 回目からは先に話したほう
  assert.deepEqual(
    pick([
      { n: 3, quote: "a girl is looking" },
      { n: 1, quote: "The dog is sitting" },
      { n: 2, quote: "Boy is carrying box" },
      { n: 1, quote: "A boy is running" },
    ]),
    [
      { n: 3, quote: "a girl is looking" },
      { n: 2, quote: "Boy is carrying box" },
      { n: 1, quote: "A boy is running" },
    ],
  );
  // 4 つの違う回にあれば、新しい 3 回を選ぶ
  assert.deepEqual(
    pick([
      { n: 1, quote: "A boy is running" },
      { n: 2, quote: "A woman is cooking" },
      { n: 3, quote: "a girl is looking" },
      { n: 4, quote: "A boy is building" },
    ]).map((e) => e.n),
    [4, 3, 2],
  );
  // 違う回が 2 つしかなければ、残りの実例を新しい回から足す（同じ回の中は話した順）
  assert.deepEqual(
    pick([
      { n: 2, quote: "Boy is carrying box" },
      { n: 1, quote: "The dog is sitting" },
      { n: 2, quote: "A woman is cooking" },
      { n: 1, quote: "A boy is running" },
    ]),
    [
      { n: 2, quote: "A woman is cooking" },
      { n: 2, quote: "Boy is carrying box" },
      { n: 1, quote: "A boy is running" },
    ],
  );
});

test("観点・空の欄・数字の書き方が違う癖は捨て、4 件目からも捨てる", () => {
  const { analysis, stats } = verify({
    habits: [
      habit({ viewpoint: "speech" }),
      habit({ what: "  " }),
      habit({ fix: "言えた割合が 30% なので、理由を足そう。" }),
      habit({ title: "細部が 3割" }),
      habit({ title: "1" }),
      habit({ title: "2" }),
      habit({ title: "3" }),
      habit({ title: "4" }),
    ],
    improvement: null,
    nextTry: null,
  });
  assert.deepEqual(
    analysis.habits.map((h) => h.title),
    ["1", "2", "3"],
  );
  assert.deepEqual(stats.dropped, {
    viewpoint: 1,
    empty: 1,
    number: 2,
    quote: 0,
    overflow: 1,
  });
});

test("数字の確かめは割合・点の数字だけに当て、「次の 1 回」や英語の数の語には当てない", () => {
  for (const text of ["50%", "80 点", "３割", "0.5点", "１００％"]) {
    assert.equal(hasNumber(text), true, text);
  }
  for (const text of [
    "次の 1 回で because を足そう。",
    '"There are two dogs."',
    "1 つだけ足そう。",
  ]) {
    assert.equal(hasNumber(text), false, text);
  }
});

test("後半の回は新しいほうの ⌊n/2⌋ 回で、奇数なら真ん中の回は入らない", () => {
  assert.deepEqual(secondHalf(10), [6, 7, 8, 9, 10]);
  assert.deepEqual(secondHalf(7), [5, 6, 7]);
  assert.deepEqual(secondHalf(5), [4, 5]);
});

test("良くなった点は、後半の回の文字起こしにある引用だけを通す", () => {
  const improvement = (
    n: number,
    quote: string,
    text = "理由を言えるようになった。",
  ) => ({
    viewpoint: "content" as const,
    text,
    example: { n, quote },
  });
  const run = (raw: RawAnalysis["improvement"]) =>
    verify({ habits: [], improvement: raw, nextTry: null });

  const kept = run(improvement(5, "a man is running because it is raining"));
  assert.deepEqual(kept.analysis.improvement?.example, {
    n: 5,
    quote: "A man is running because it is raining",
  });
  assert.equal(kept.stats.improvement, "kept");
  // 5 回のとき、3 回目は真ん中で前半にも後半にも入らない
  assert.equal(
    run(improvement(3, "a girl is looking")).stats.improvement,
    "half",
  );
  assert.equal(
    run(improvement(4, "A girl is carrying a red bucket")).stats.improvement,
    "quote",
  );
  assert.equal(
    run(
      improvement(4, "A girl is carrying a bucket", "前半より 20 点上がった。"),
    ).stats.improvement,
    "number",
  );
  assert.equal(
    run(improvement(4, "A girl is carrying a bucket", " ")).stats.improvement,
    "empty",
  );
  assert.equal(run(null).stats.improvement, "none");
  assert.equal(run(null).analysis.improvement, null);
});

test("次に試すことは、空や数字の入った文なら null にする", () => {
  const run = (nextTry: RawAnalysis["nextTry"]) =>
    verify({ habits: [], improvement: null, nextTry });
  assert.deepEqual(
    run({ viewpoint: "expression", text: " a と the を付けよう。 " }).analysis
      .nextTry,
    { viewpoint: "expression", text: "a と the を付けよう。" },
  );
  assert.equal(run({ viewpoint: "content", text: "" }).analysis.nextTry, null);
  assert.equal(
    run({ viewpoint: "content", text: "言えた割合を 80% にしよう。" }).stats
      .nextTry,
    "number",
  );
});

test("欄が欠けた応答でも投げずに、何も通さない", () => {
  const { analysis, stats } = verify({} as RawAnalysis);
  assert.deepEqual(analysis, { habits: [], improvement: null, nextTry: null });
  assert.equal(stats.habits, 0);
});
