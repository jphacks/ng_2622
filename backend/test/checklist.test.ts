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

// eiken-pre2 の形（中心 3・理由 1・細部 2。満点の重み 11）
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

test("満点の重みは級の形で 6・11・15（その他 2 件分の 1 を含む）", () => {
  const shape = (kinds: ChecklistItem["kind"][]) =>
    recallOf(
      kinds.map((kind) => ({ kind, level: "none" as const })),
      0,
    ).max;
  assert.equal(shape(["center", "center", "detail"]), 6);
  assert.equal(
    shape(["center", "center", "center", "reason", "detail", "detail"]),
    11,
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
    15,
  );
});

test("R は full を 1、partial を 0.5 として重みに掛ける。全部言えてその他 2 件なら 1", () => {
  const all = recallOf(
    CHECKLIST.map((c) => ({ kind: c.kind, level: "full" as const })),
    2,
  );
  assert.deepEqual(all, { value: 1, earned: 11, max: 11 });
  // その他は 2 件を超えて渡しても 2 件分
  assert.equal(
    recallOf(
      CHECKLIST.map((c) => ({ kind: c.kind, level: "none" as const })),
      5,
    ).earned,
    1,
  );
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
});

test("ADR の計算例（eiken-pre2）: R = 6.5/11、P = 4/5 → 68 点", () => {
  // 中心 3 つのうち 2 つ、理由が一部、細部 2 つのうち 1 つ、その他 1 件
  const recall = recallOf(
    [
      { kind: "center", level: "full" },
      { kind: "center", level: "full" },
      { kind: "center", level: "none" },
      { kind: "reason", level: "partial" },
      { kind: "detail", level: "full" },
      { kind: "detail", level: "none" },
    ],
    1,
  );
  assert.equal(recall.earned, 6.5);
  assert.equal(recall.max, 11);
  // 言った描写 5 つのうち 1 つが場面に無い物
  const precision = precisionOf([
    claim("a"),
    claim("b"),
    claim("c"),
    claim("d"),
    claim("e", "absent"),
  ]);
  assert.deepEqual(precision, { value: 0.8, correct: 4, said: 5 });
  assert.equal(f1Content(precision.value, recall.value), 68);
});

test("描写の一覧から同じ達成（R = 6.5/11）を作ると、正しい描写は 5 つになり P = 5/6 で 69 点", () => {
  // ADR の例は、項目 4 つとその他 1 件を正しい描写 4 つで言えたことになっている。
  // 描写 1 つが当たる項目は 1 つなので、描写の一覧からは正しい描写が 5 つ要る
  const transcript = "one two three four five six";
  const r = scoreContent(CHECKLIST, transcript, [
    claim("one", "correct", "c1"),
    claim("two", "correct", "c2"),
    claim("three", "correct", "r1", "partial"),
    claim("four", "correct", "d1"),
    claim("five"),
    claim("six", "absent"),
  ]);
  assert.deepEqual(r.recall, { value: 6.5 / 11, earned: 6.5, max: 11 });
  assert.deepEqual(r.precision, { value: 5 / 6, correct: 5, said: 6 });
  assert.equal(r.others, 1);
  assert.equal(r.content, 69);
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
  // 今: R = (2 + 1 + 1) / 11、P = 3/3
  assert.equal(r.content, f1Content(1, 4 / 11));
  // c2 を足す: R = 6/11、正しい描写が 1 つ増えて P = 4/4
  assert.equal(gainOf(r, "c2"), f1Content(1, 6 / 11) - r.content);
  // 一部の r1 が full になる: R = 5/11、P はそのまま
  assert.equal(gainOf(r, "r1"), f1Content(1, 5 / 11) - r.content);
  // もう言えている項目・無い項目は 0
  assert.equal(gainOf(r, "c1"), 0);
  assert.equal(gainOf(r, "nope"), 0);
});

test("gain は、間違いだけの答えでも 0 にならない（正しい描写が増える分 P も上がる）", () => {
  const r = scoreContent(CHECKLIST, "a cat", [claim("a cat", "absent")]);
  assert.equal(r.content, 0);
  // R = 2/11、P = 1/2
  assert.equal(gainOf(r, "c1"), f1Content(1 / 2, 2 / 11));
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
