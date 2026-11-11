import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ChecklistItem,
  type Claim,
  checkNextStep,
  countOthers,
  f1Content,
  gainOf,
  itemResults,
  OTHER_MAX,
  precisionOf,
  recallOf,
  scoreContent,
  verifyClaims,
  WEIGHTS,
} from "../src/scoring/checklist";

// eiken-pre2 の形（中心 3・理由 1・細部 2。満点の重み 10）
const CHECKLIST: ChecklistItem[] = [
  {
    id: "c1",
    kind: "center",
    label: "中心1",
    accept: "a woman is wiping the table",
    refs: ["woman"],
  },
  {
    id: "c2",
    kind: "center",
    label: "中心2",
    accept: "a waiter is bringing a cup",
    refs: ["waiter"],
  },
  {
    id: "c3",
    kind: "center",
    label: "中心3",
    accept: "a boy is sitting on a chair",
    refs: ["boy"],
  },
  {
    id: "r1",
    kind: "reason",
    label: "理由",
    accept: "because of the juice",
    refs: ["juice", "woman"],
  },
  {
    id: "d1",
    kind: "detail",
    label: "細部1",
    accept: "there is spilled juice",
    refs: ["juice"],
  },
  {
    id: "d2",
    kind: "detail",
    label: "細部2",
    accept: "there is a plant",
    refs: ["plant"],
  },
];

const claim = (
  quote: string,
  verdict: Claim["verdict"] = "correct",
  item: string | null = null,
  level: Claim["level"] = null,
): Claim => ({
  quote,
  verdict,
  item,
  level: level ?? (item && verdict === "correct" ? "full" : null),
  note: verdict === "correct" || verdict === "ignored" ? null : "理由",
});

// ---- 引用の確かめ ----

test("引用は大文字小文字・句読点・空白の違いを無視して探し、文字起こしのとおりの文字列に直す", () => {
  const transcript = "A woman is wiping the table.  A boy, he is sitting!";
  const out = verifyClaims(transcript, [
    claim("a WOMAN is   wiping the table"),
    claim("a boy he is sitting."),
  ]);
  assert.deepEqual(
    out.map((c) => c.quote),
    ["A woman is wiping the table", "A boy, he is sitting"],
  );
});

test("文字起こしに無い引用の描写は捨てる（語の途中の一致も無いものとする）", () => {
  const out = verifyClaims("A man is reading a book", [
    claim("a man is reading a newspaper"),
    claim("a man is read"),
    claim("man"),
    claim(""),
    claim("..."),
  ]);
  assert.deepEqual(
    out.map((c) => c.quote),
    ["man"],
  );
});

test("同じ語が 2 回出るときは、前の描写の終わりから先を探す", () => {
  const transcript = "A dog is running. A dog is sitting.";
  const out = verifyClaims(transcript, [
    claim("A dog is running", "correct", "c1"),
    claim("a dog", "absent"),
    claim("sitting", "contradiction"),
  ]);
  assert.deepEqual(
    out.map((c) => c.quote),
    ["A dog is running", "A dog", "sitting"],
  );
  // 2 つ目の "A dog" は 2 文目のもの（1 文目のあと）
  assert.equal(out[1].verdict, "absent");
});

test("話した順に並べ直す。前の描写と重なる引用は頭から探して拾う", () => {
  const transcript = "A man is reading a book next to the table";
  const out = verifyClaims(transcript, [
    claim("next to the table"),
    claim("a man is reading a book"),
    claim("reading a book next to the table", "ignored"),
  ]);
  assert.deepEqual(
    out.map((c) => c.quote),
    [
      "A man is reading a book",
      "reading a book next to the table",
      "next to the table",
    ],
  );
});

test("引用が重なっていても、当たる項目が違えば両方残る（1 つの文が 2 つの項目に当たる）", () => {
  const transcript = "Woman wipe table because juice. A boy is sitting.";
  const r = scoreContent(CHECKLIST, transcript, [
    claim("woman wipe table", "correct", "c1"),
    // 理由の描写は、中心の描写を含む同じ文の全部を引用している
    claim("woman wipe table because juice", "correct", "r1"),
    // 引用がまったく同じでも、項目が違えば残る
    claim("a boy is sitting", "correct", "c3", "partial"),
    claim("a boy is sitting", "correct", "d1", "partial"),
  ]);
  assert.deepEqual(
    r.claims.map((c) => [c.quote, c.item]),
    [
      ["Woman wipe table", "c1"],
      ["Woman wipe table because juice", "r1"],
      ["A boy is sitting", "c3"],
      ["A boy is sitting", "d1"],
    ],
  );
  assert.deepEqual(
    r.items.map((i) => i.level),
    ["full", "none", "partial", "full", "partial", "none"],
  );
  // 項目ごとに 1 つの事実と数える
  assert.deepEqual(r.precision, { value: 1, correct: 4, said: 4 });
});

test("同じ場所・同じ判定・同じ項目の描写は 1 つにまとめる（同じ事実を 2 回数えない。level は高いほう）", () => {
  const claims = [
    claim("a dog is running", "correct", "c1", "partial"),
    claim("a dog is running", "correct", "c1", "full"),
    claim("a dog", "correct"),
    claim("A DOG", "correct"),
    claim("dog", "absent"),
    claim("dog", "absent"),
  ];
  const once = verifyClaims("a dog is running", claims, CHECKLIST);
  assert.deepEqual(
    once.map((c) => [c.quote, c.verdict, c.item, c.level]),
    [
      ["a dog is running", "correct", "c1", "full"],
      ["a dog", "correct", null, null],
      ["dog", "absent", null, null],
    ],
  );
  // 文字起こしで 2 回言っていれば、別の場所に当たるので両方残る
  const twice = verifyClaims(
    "a dog is running a dog is running",
    claims.slice(0, 2),
    CHECKLIST,
  );
  assert.deepEqual(
    twice.map((c) => c.level),
    ["partial", "full"],
  );
});

test("重なる引用は、頭からではなく前の描写の場所から探す", () => {
  const transcript = "A dog is running. Then a dog is running fast";
  const out = verifyClaims(
    transcript,
    [
      claim("then", "ignored"),
      claim("a dog is running fast", "correct", "c1"),
      claim("a dog is running", "correct", "c2"),
    ],
    CHECKLIST,
  );
  // 3 つ目は、1 文目ではなく 2 つ目と同じ場所（"Then" のあと）に当たる
  assert.deepEqual(
    out.map((c) => [c.quote, c.item]),
    [
      ["Then", null],
      ["a dog is running fast", "c1"],
      ["a dog is running", "c2"],
    ],
  );
});

test("アポストロフィの形（' と ’）の違いは無視する", () => {
  const out = verifyClaims("It’s raining and he doesn't have an umbrella", [
    claim("it's raining"),
    claim("he doesn’t have an umbrella"),
  ]);
  assert.deepEqual(
    out.map((c) => c.quote),
    ["It’s raining", "he doesn't have an umbrella"],
  );
});

test("correct でない描写の item・level と、checklist に無い id は消す。level の無い当たりは一部にする", () => {
  const out = verifyClaims(
    "one two three four",
    [
      {
        quote: "one",
        verdict: "contradiction",
        item: "c1",
        level: "full",
        note: "違う",
      },
      {
        quote: "two",
        verdict: "correct",
        item: "nope",
        level: "full",
        note: null,
      },
      {
        quote: "three",
        verdict: "correct",
        item: "c2",
        level: null,
        note: null,
      },
      {
        quote: "four",
        verdict: "correct",
        item: null,
        level: "full",
        note: "x",
      },
    ],
    CHECKLIST,
  );
  assert.deepEqual(out, [
    {
      quote: "one",
      verdict: "contradiction",
      item: null,
      level: null,
      note: "違う",
    },
    { quote: "two", verdict: "correct", item: null, level: null, note: null },
    {
      quote: "three",
      verdict: "correct",
      item: "c2",
      level: "partial",
      note: null,
    },
    { quote: "four", verdict: "correct", item: null, level: null, note: null },
  ]);
});

// ---- 項目の達成・その他 ----

test("項目の達成は、当たった correct の描写の最も高い level。無ければ none", () => {
  const items = itemResults(CHECKLIST, [
    claim("a", "correct", "c1", "partial"),
    claim("b", "correct", "c1", "full"),
    claim("c", "correct", "c2", "partial"),
    // correct でない描写は項目に当たらない
    {
      quote: "d",
      verdict: "contradiction",
      item: "c3",
      level: "full",
      note: null,
    },
  ]);
  assert.deepEqual(
    items.map((i) => [i.id, i.level]),
    [
      ["c1", "full"],
      ["c2", "partial"],
      ["c3", "none"],
      ["r1", "none"],
      ["d1", "none"],
      ["d2", "none"],
    ],
  );
  assert.deepEqual(items[0], {
    id: "c1",
    kind: "center",
    label: "中心1",
    level: "full",
  });
});

test("その他は correct で item が null のものを 2 件まで数える", () => {
  assert.equal(OTHER_MAX, 2);
  assert.equal(countOthers([]), 0);
  assert.equal(countOthers([claim("a"), claim("b", "correct", "c1")]), 1);
  assert.equal(countOthers([claim("a"), claim("b"), claim("c")]), 2);
  assert.equal(countOthers([claim("a", "absent"), claim("b", "ignored")]), 0);
});

// ---- 重み・R・P・F1 ----

test("重みは中心 2・理由 2・つながり 2・細部 1・その他 0.5", () => {
  assert.deepEqual(WEIGHTS, {
    center: 2,
    reason: 2,
    link: 2,
    detail: 1,
    other: 0.5,
  });
});

test("満点の重みは checklist の項目だけで、級の形で 5・10・14（その他は含めない）", () => {
  const shape = (kinds: ChecklistItem["kind"][]) =>
    recallOf(
      kinds.map((kind) => ({ kind, level: "none" as const })),
      0,
    ).max;
  assert.equal(shape(["center", "center", "detail"]), 5);
  assert.equal(
    shape(["center", "center", "center", "reason", "detail", "detail"]),
    10,
  );
  assert.equal(
    shape([
      "center",
      "center",
      "center",
      "center",
      "reason",
      "link",
      "detail",
      "detail",
    ]),
    14,
  );
  assert.deepEqual(recallOf([], 2), { value: 0, earned: 0, max: 0 });
});

test("R は full を 1、partial を 0.5 として重みに掛ける。項目を全部言えれば、その他が無くても 1", () => {
  const levels = (level: "full" | "none") =>
    CHECKLIST.map((c) => ({ kind: c.kind, level }));
  assert.deepEqual(recallOf(levels("full"), 0), {
    value: 1,
    earned: 10,
    max: 10,
  });
  assert.deepEqual(
    recallOf(
      CHECKLIST.map((c) => ({
        kind: c.kind,
        level: c.kind === "center" ? ("partial" as const) : ("none" as const),
      })),
      0,
    ),
    { value: 0.3, earned: 3, max: 10 },
  );
});

test("その他はおまけ: 1 件 0.5・2 件までを言えた重みに足し、満点で頭打ちにする（R は 1 を超えない）", () => {
  const levels = (level: "full" | "none") =>
    CHECKLIST.map((c) => ({ kind: c.kind, level }));
  assert.equal(recallOf(levels("none"), 1).earned, 0.5);
  assert.equal(recallOf(levels("none"), 2).earned, 1);
  // 2 件を超えて渡しても 2 件分
  assert.equal(recallOf(levels("none"), 5).earned, 1);
  // 全部言えていれば、その他を足しても満点のまま
  assert.deepEqual(recallOf(levels("full"), 2), {
    value: 1,
    earned: 10,
    max: 10,
  });
  // 細部 1 つ（重み 1）が抜けた分は、その他 2 件で埋まる。3 件めは足さない
  const missingDetail = CHECKLIST.map((c) => ({
    kind: c.kind,
    level: c.id === "d2" ? ("none" as const) : ("full" as const),
  }));
  assert.equal(recallOf(missingDetail, 1).earned, 9.5);
  assert.equal(recallOf(missingDetail, 2).earned, 10);
  assert.equal(recallOf(missingDetail, 3).value, 1);
});

test("P は ignored を数えない。数える描写が無いときは 0（分子・分母も 0）", () => {
  assert.deepEqual(
    precisionOf([
      claim("a"),
      claim("b", "contradiction"),
      claim("c", "absent"),
      claim("d", "offtopic"),
      claim("e", "ignored"),
    ]),
    { value: 0.25, correct: 1, said: 4 },
  );
  assert.deepEqual(precisionOf([]), { value: 0, correct: 0, said: 0 });
  assert.deepEqual(precisionOf([claim("um", "ignored")]), {
    value: 0,
    correct: 0,
    said: 0,
  });
});

test("内容 = round(100 × 2PR/(P+R))。P + R = 0 なら 0", () => {
  assert.equal(f1Content(0, 0), 0);
  assert.equal(f1Content(1, 1), 100);
  assert.equal(f1Content(1, 0), 0);
  assert.equal(f1Content(0, 1), 0);
  assert.equal(f1Content(0.5, 1), 67);
  // ADR 20261110 の例の数字（R = 6.5/11、P = 4/5）。式は変えていない
  assert.equal(f1Content(4 / 5, 6.5 / 11), 68);
});

test("計算の例（usecase.md、eiken-pre2）: R = 6.5/10、P = 5/6 → 73 点", () => {
  // 中心 3 つのうち 2 つ、理由が一部、細部 2 つのうち 1 つ、その他 1 件。場面に無い物を 1 つ言った
  const transcript = "one two three four five six";
  const r = scoreContent(CHECKLIST, transcript, [
    claim("one", "correct", "c1"),
    claim("two", "correct", "c2"),
    claim("three", "correct", "r1", "partial"),
    claim("four", "correct", "d1"),
    claim("five"),
    claim("six", "absent"),
  ]);
  assert.deepEqual(r.recall, { value: 0.65, earned: 6.5, max: 10 });
  assert.deepEqual(r.precision, { value: 5 / 6, correct: 5, said: 6 });
  assert.equal(r.others, 1);
  assert.equal(r.content, 73);
});

test("見本どおり（項目を全部 full、間違いなし）なら、その他が無くても 100 点", () => {
  const transcript = CHECKLIST.map((_, i) => `w${i}`).join(" ");
  const all = CHECKLIST.map((c, i) => claim(`w${i}`, "correct", c.id));
  const r = scoreContent(CHECKLIST, transcript, all);
  assert.deepEqual(r.recall, { value: 1, earned: 10, max: 10 });
  assert.equal(r.content, 100);
  // その他を足しても 100 点のまま
  const more = scoreContent(CHECKLIST, `${transcript} extra`, [
    ...all,
    claim("extra"),
  ]);
  assert.equal(more.recall.earned, 10);
  assert.equal(more.content, 100);
});

test("引用が文字起こしに無い描写は、正しさにも言えたにも数えない（当たっていた項目はその分下がる）", () => {
  const transcript = "a woman is wiping the table";
  const r = scoreContent(CHECKLIST, transcript, [
    claim("a woman is wiping the table", "correct", "c1"),
    claim("a waiter is bringing a cup", "correct", "c2"),
    claim("a cat is sleeping", "absent"),
  ]);
  assert.deepEqual(r.precision, { value: 1, correct: 1, said: 1 });
  assert.equal(r.recall.earned, 2);
  assert.equal(r.items[1].level, "none");
  assert.equal(r.claims.length, 1);
});

test("描写が 1 つも無い・間違いだけ・数えないものだけなら 0 点", () => {
  assert.equal(scoreContent(CHECKLIST, "hello there", []).content, 0);
  assert.equal(
    scoreContent(CHECKLIST, "I like pizza", [claim("I like pizza", "offtopic")])
      .content,
    0,
  );
  assert.equal(
    scoreContent(CHECKLIST, "um I think", [claim("um I think", "ignored")])
      .content,
    0,
  );
});

test("無関係な話を足すと、言えたことは同じでも点が下がる", () => {
  const good = [claim("one", "correct", "c1"), claim("two", "correct", "c2")];
  const clean = scoreContent(CHECKLIST, "one two", good);
  const padded = scoreContent(CHECKLIST, "one two three four", [
    ...good,
    claim("three", "offtopic"),
    claim("four", "absent"),
  ]);
  assert.equal(clean.recall.earned, padded.recall.earned);
  assert.ok(padded.content < clean.content);
  // ignored は足しても変わらない
  const hedged = scoreContent(CHECKLIST, "one two maybe", [
    ...good,
    claim("maybe", "ignored"),
  ]);
  assert.equal(hedged.content, clean.content);
});

// ---- 次の一つ ----

const partly = () =>
  scoreContent(CHECKLIST, "one two three", [
    claim("one", "correct", "c1"),
    claim("two", "correct", "r1", "partial"),
    claim("three", "correct", "d1"),
  ]);

test("gain は、その項目を full で言えたときの内容の伸び", () => {
  const r = partly();
  // 今: R = (2 + 1 + 1) / 10、P = 3/3
  assert.equal(r.content, f1Content(1, 4 / 10));
  // c2 を足す: R = 6/10、正しい描写が 1 つ増えて P = 4/4
  assert.equal(gainOf(r, "c2"), f1Content(1, 6 / 10) - r.content);
  // 一部の r1 が full になる: R = 5/10、P はそのまま
  assert.equal(gainOf(r, "r1"), f1Content(1, 5 / 10) - r.content);
  // もう言えている項目・無い項目は 0
  assert.equal(gainOf(r, "c1"), 0);
  assert.equal(gainOf(r, "nope"), 0);
});

test("gain は、間違いだけの答えでも 0 にならない（正しい描写が増える分 P も上がる）", () => {
  const r = scoreContent(CHECKLIST, "a cat", [claim("a cat", "absent")]);
  assert.equal(r.content, 0);
  // R = 2/10、P = 1/2
  assert.equal(gainOf(r, "c1"), f1Content(1 / 2, 2 / 10));
  assert.ok(gainOf(r, "c1") > 0);
});

test("次の一つ: Claude が選んだ項目が言えていなければ、そのまま使い gain を付ける", () => {
  const r = partly();
  const next = checkNextStep(r, {
    kind: "content",
    text: "店員も足そう",
    item: "d2",
  });
  assert.deepEqual(next, {
    kind: "content",
    text: "店員も足そう",
    item: "d2",
    gain: gainOf(r, "d2"),
  });
  // 一部の項目も、伸ばせるのでそのまま使う
  assert.equal(
    checkNextStep(r, { kind: "content", text: "t", item: "r1" }).item,
    "r1",
  );
});

test("次の一つ: もう言えている項目・無い id・null は、重みの最も重い言えていない項目に差し替える（同じ重みは checklist の順）", () => {
  const r = partly();
  for (const item of ["c1", "nope", null]) {
    const next = checkNextStep(r, { kind: "content", text: "元の文", item });
    // 言えていないのは c2・c3（重み 2）と d2（重み 1）。r1 は一部なので後回し
    assert.equal(next.item, "c2");
    assert.equal(next.text, "次は「中心2」を足してみよう。");
    assert.equal(next.gain, gainOf(r, "c2"));
  }
});

test("次の一つ: 言えていない項目が無ければ一部の項目へ。全部 full なら項目なしで Claude の文を出す", () => {
  const all = CHECKLIST.map((c, i) =>
    claim(
      `w${i}`,
      "correct",
      c.id,
      c.id === "d1" || c.id === "r1" ? "partial" : "full",
    ),
  );
  const transcript = CHECKLIST.map((_, i) => `w${i}`).join(" ");
  const r = scoreContent(CHECKLIST, transcript, all);
  // 一部は r1（重み 2）と d1（重み 1）
  assert.equal(
    checkNextStep(r, { kind: "content", text: "t", item: "c1" }).item,
    "r1",
  );

  const full = scoreContent(
    CHECKLIST,
    transcript,
    CHECKLIST.map((c, i) => claim(`w${i}`, "correct", c.id)),
  );
  assert.deepEqual(
    checkNextStep(full, { kind: "content", text: "もう一言", item: "c1" }),
    {
      kind: "content",
      text: "もう一言",
      item: null,
      gain: null,
    },
  );
});

test("次の一つ: 表現・話し方のときは項目も gain も付けない", () => {
  const r = partly();
  assert.deepEqual(
    checkNextStep(r, {
      kind: "expression",
      text: "because を使おう",
      item: "c2",
    }),
    {
      kind: "expression",
      text: "because を使おう",
      item: null,
      gain: null,
    },
  );
  assert.equal(
    checkNextStep(r, { kind: "speech", text: "t", item: null }).gain,
    null,
  );
});
