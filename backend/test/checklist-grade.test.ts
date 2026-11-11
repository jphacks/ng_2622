import assert from "node:assert/strict";
import { test } from "node:test";
import parts from "../../assets/parts/index.json";
import {
  type ChecklistItem,
  type Grade,
  recallOf,
} from "../src/scoring/checklist";
import {
  type ChecklistJudgment,
  type CreateMessage,
  checklistPrompt,
  gradeWithChecklist,
} from "../src/scoring/checklistGrade";
import { ClaudeError } from "../src/scoring/claude";
import {
  describeLayout,
  describeLayoutWithRelations,
  type RelationItem,
} from "../src/scoring/layout";
import eiken2 from "./fixtures/checklist-eiken-2.json";
import eiken3 from "./fixtures/checklist-eiken-3.json";
import eikenPre2 from "./fixtures/checklist-eiken-pre2.json";

type Fixture = {
  protocol: string;
  id: string;
  difficulty: Grade;
  description: string;
  checklist: ChecklistItem[];
  items: RelationItem[];
};
const FIXTURES = [eiken3, eikenPre2, eiken2] as unknown as Fixture[];

// 級の形（ADR 20261110-score-content-with-checklist-f1 と scene-protocol.md）
const SHAPES: Record<Grade, Record<string, number>> = {
  "eiken-3": { center: 2, detail: 1 },
  "eiken-pre2": { center: 3, reason: 1, detail: 2 },
  "eiken-2": { center: 4, reason: 1, link: 1, detail: 2 },
};
const MAX: Record<Grade, number> = {
  "eiken-3": 5,
  "eiken-pre2": 10,
  "eiken-2": 14,
};

// ---- 試験用の場面 ----

for (const scene of FIXTURES) {
  test(`試験用の場面 ${scene.id}: scene/2 の形で、checklist が級の形どおり`, () => {
    assert.equal(scene.protocol, "scenenglish.scene/2");
    const counts: Record<string, number> = {};
    for (const c of scene.checklist) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    assert.deepEqual(counts, SHAPES[scene.difficulty]);
    assert.equal(
      recallOf(
        scene.checklist.map((c) => ({ kind: c.kind, level: "none" as const })),
        0,
      ).max,
      MAX[scene.difficulty],
    );
    assert.equal(
      new Set(scene.checklist.map((c) => c.id)).size,
      scene.checklist.length,
    );
  });

  test(`試験用の場面 ${scene.id}: 裏取り（refs・部品・accept）が通る`, () => {
    const keys = new Set(scene.items.map((i) => i.key));
    const ids = new Set((parts as { id: string }[]).map((p) => p.id));
    for (const item of scene.items) {
      assert.ok(ids.has(item.part), `部品 ${item.part} が無い`);
      const target = item.place?.target;
      if (target) assert.ok(keys.has(target), `place の相手 ${target} が無い`);
    }
    const description = scene.description.toLowerCase();
    for (const c of scene.checklist) {
      for (const ref of c.refs)
        assert.ok(keys.has(ref), `${c.id} の refs ${ref} が無い`);
      if (c.kind === "reason" || c.kind === "link")
        assert.ok(c.refs.length >= 2, c.id);
      assert.ok(
        description.includes(c.accept.toLowerCase()),
        `${c.id} の accept が description に無い`,
      );
    }
  });
}

// ---- 場面の情報（関係つき） ----

test("describeLayoutWithRelations は、座標の行に place・facing・動きの行き先を書き足す", () => {
  const text = describeLayoutWithRelations(
    eiken2.items as unknown as RelationItem[],
  );
  assert.ok(text);
  assert.match(text, /^Coordinates: /);
  assert.match(text, /\nRelations: /);
  assert.match(
    text,
    /- bag: かばん.*\n {2}words: bag\n {2}size: .*\n {2}position: \[2\.9, 0\.48, -2\.52\]\n {2}place: on bench/,
  );
  assert.match(
    text,
    /place: relate woman \(link hand, side front, distance touch, turn toward\)/,
  );
  assert.match(
    text,
    /- oldman: [\s\S]*?yaw: -27\n {2}place: next_to bench\n {2}facing: woman/,
  );
  assert.match(
    text,
    /motion: moves in a straight line to \[-3\.6, 0, 1\.6\]\n {2}place: near woman\n {2}moves toward: left/,
  );
  assert.match(text, /place: ground \(zone back_right\)/);
});

test("関係の無い items では、describeLayout の行をそのまま含む（describeLayout は変えていない）", () => {
  const items = [
    {
      key: "grass",
      part: "grass_patch",
      position: [0, 0, 0] as [number, number, number],
    },
    {
      key: "dog",
      part: "animal_run_dog_a",
      position: [1, 0, 2] as [number, number, number],
      yaw: 90,
    },
  ];
  const plain = describeLayout(items);
  const withRelations = describeLayoutWithRelations(items);
  assert.ok(plain && withRelations);
  assert.doesNotMatch(plain, /Relations:/);
  const things = (s: string) => s.slice(s.indexOf("Things ("));
  assert.equal(things(withRelations), things(plain));
  // 地面だけ・知らない部品だけなら null
  assert.equal(describeLayoutWithRelations([items[0]]), null);
  assert.equal(
    describeLayoutWithRelations([
      { key: "x", part: "no_such_part", position: [0, 0, 0] },
    ]),
    null,
  );
});

// ---- Claude を呼ぶ採点（偽の応答） ----

const GRAMMAR = [
  "present continuous (is running)",
  "there is / there are",
  "because",
];
const TRANSCRIPT =
  "A woman is wiping the table because juice is on it. A boy is sitting. I think he is tired. There is a dog under the table.";

const inputFor = (transcript = TRANSCRIPT) => ({
  grade: eikenPre2.difficulty as Grade,
  checklist: eikenPre2.checklist as ChecklistItem[],
  sceneData: describeLayoutWithRelations(
    eikenPre2.items as unknown as RelationItem[],
  ) as string,
  description: eikenPre2.description,
  grammar: GRAMMAR,
  transcript,
  speech: { accuracy: 90, fluency: 70, prosody: 80 },
});

const JUDGED: ChecklistJudgment = {
  claims: [
    {
      quote: "a woman is wiping the table",
      verdict: "correct",
      item: "woman_wipe",
      level: "full",
      note: null,
    },
    {
      quote: "because juice is on it",
      verdict: "correct",
      item: "why_wipe",
      level: "full",
      note: null,
    },
    {
      quote: "a boy is sitting",
      verdict: "correct",
      item: "boy_sit",
      level: "partial",
      note: null,
    },
    {
      quote: "I think he is tired",
      verdict: "ignored",
      item: null,
      level: null,
      note: null,
    },
    {
      quote: "there is a dog under the table",
      verdict: "absent",
      item: null,
      level: null,
      note: "犬は場面にいません",
    },
    // 文字起こしに無い引用（捨てられる）
    {
      quote: "a waiter is bringing a cup",
      verdict: "correct",
      item: "waiter_bring",
      level: "full",
      note: null,
    },
  ],
  expression: 78.4,
  strength: { quote: "because juice is on it", text: "理由を言えた" },
  nextStep: { kind: "content", text: "店員も足そう", item: "woman_wipe" },
  rewrite: null,
};

const fake = (
  judged: unknown,
  calls: Parameters<CreateMessage>[0][] = [],
  stop_reason = "end_turn",
): CreateMessage =>
  (async (params) => {
    calls.push(params);
    return {
      stop_reason,
      content: [{ type: "text", text: JSON.stringify(judged) }],
    };
  }) as CreateMessage;

// 送った schema を、テストで見る深さまでの型で取り出す
type Props = Record<string, unknown>;
const schemaOf = (call: Parameters<CreateMessage>[0]) => {
  const format = call.output_config?.format as unknown as {
    schema: {
      required: string[];
      properties: {
        claims: { items: { properties: Props } };
        nextStep: { properties: { kind: { enum: string[] }; item: unknown } };
      };
    };
  };
  assert.ok(format);
  return format.schema;
};

test("gradeWithChecklist: 偽の応答から、内容の点・内訳・次の一つをコードで作る", async () => {
  const r = await gradeWithChecklist({}, inputFor(), { create: fake(JUDGED) });
  // 言えた: 中心 2 + 理由 2 + 中心の一部 1 = 5 / 10。正しさ: 3 / 4（ignored と捨てた描写は数えない）
  assert.deepEqual(r.breakdown.recall, { value: 0.5, earned: 5, max: 10 });
  assert.deepEqual(r.breakdown.precision, { value: 0.75, correct: 3, said: 4 });
  assert.equal(r.content, 60); // 2 × 0.75 × 0.5 / 1.25 = 0.6
  assert.equal(r.expression, 78);
  assert.deepEqual(
    r.breakdown.claims.map((c) => c.quote),
    [
      "A woman is wiping the table",
      "because juice is on it",
      "A boy is sitting",
      "I think he is tired",
      "There is a dog under the table",
    ],
  );
  assert.deepEqual(
    r.breakdown.items.map((i) => i.level),
    ["full", "none", "partial", "full", "none", "none"],
  );
  assert.equal(r.breakdown.items[0].label, "女の人がテーブルを拭いている");
  // Claude はもう言えた項目を勧めたので、言えていない中で最も重い項目（店員）に差し替える
  assert.equal(r.nextStep.kind, "content");
  assert.equal(r.nextStep.item, "waiter_bring");
  assert.equal(
    r.nextStep.text,
    "次は「店員がカップを運んでいる」を足してみよう。",
  );
  assert.equal(r.nextStep.gain, 75 - 60); // R = 7/10、P = 4/5 → 75
  assert.deepEqual(r.strength, JUDGED.strength);
  assert.equal(r.rewrite, null);
});

test("gradeWithChecklist: Claude に渡す本文と schema", async () => {
  const calls: Parameters<CreateMessage>[0][] = [];
  await gradeWithChecklist(
    { CLAUDE_MODEL: "claude-sonnet-5-5", CLAUDE_EFFORT: "low" },
    { ...inputFor(), grammarAbove: ["so that"] },
    { create: fake(JUDGED, calls) },
  );
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.model, "claude-sonnet-5-5");
  assert.equal(call.output_config?.effort, "low");
  const user = call.messages[0].content as string;
  assert.match(
    user,
    /^Grade: eiken-pre2\n\nGrammar list \(the player's grade and the easier grades below it\):\n- present continuous/,
  );
  assert.match(user, /Forms added in the next grade up:\n- so that/);
  assert.match(user, /Scene data:\nCoordinates: [\s\S]*\nRelations: /);
  assert.match(
    user,
    /- why_wipe \[reason\] 女の人がテーブルを拭いている理由 \/ accept: a woman is wiping the table because of the juice \/ refs: juice, woman/,
  );
  assert.match(user, /Model answer \(supplement\): There is spilled juice/);
  assert.match(user, /pronunciation 90, fluency 70, intonation 80/);
  assert.ok(user.endsWith(`Transcript: ${TRANSCRIPT}`));

  // 重みと F1 の式は渡さない
  const system = call.system as string;
  for (const text of [system, user]) {
    assert.doesNotMatch(text, /F1|precision|recall|weight/i);
  }
  // content の点は返させず、item は checklist の id に限る
  const format = {
    type: call.output_config?.format?.type,
    schema: schemaOf(call),
  };
  assert.equal(format.type, "json_schema");
  assert.deepEqual(format.schema.required, [
    "claims",
    "expression",
    "strength",
    "nextStep",
    "rewrite",
  ]);
  assert.ok(!("content" in format.schema.properties));
  const ids = eikenPre2.checklist.map((c) => c.id);
  assert.deepEqual(format.schema.properties.claims.items.properties.item, {
    anyOf: [{ type: "string", enum: ids }, { type: "null" }],
  });
  assert.deepEqual(format.schema.properties.nextStep.properties.item, {
    anyOf: [{ type: "string", enum: ids }, { type: "null" }],
  });
  assert.deepEqual(format.schema.properties.nextStep.properties.kind, {
    type: "string",
    enum: ["content", "expression", "speech"],
  });
});

test("話し方の点が無ければ、本文に入れず speech も選ばせない。文法の一つ上が無ければその段も入れない", async () => {
  const calls: Parameters<CreateMessage>[0][] = [];
  const { speech: _speech, ...input } = inputFor();
  await gradeWithChecklist({}, input, { create: fake(JUDGED, calls) });
  const user = calls[0].messages[0].content as string;
  assert.doesNotMatch(user, /Speech scores|next grade up/);
  assert.equal(checklistPrompt(input), user);
  const schema = schemaOf(calls[0]);
  assert.deepEqual(schema.properties.nextStep.properties.kind.enum, [
    "content",
    "expression",
  ]);
});

test("表現の点は 0〜100 に丸める。表現を勧めたときは項目も gain も無い", async () => {
  const r = await gradeWithChecklist({}, inputFor(), {
    create: fake({
      ...JUDGED,
      expression: 140,
      nextStep: { kind: "expression", text: "because を使おう", item: null },
    }),
  });
  assert.equal(r.expression, 100);
  assert.deepEqual(r.nextStep, {
    kind: "expression",
    text: "because を使おう",
    item: null,
    gain: null,
  });
});

// ---- 2026-11-11 の実測で見つかった問題（偽の応答で、計算の側を確かめる） ----

const grade3 = (transcript: string, claims: ChecklistJudgment["claims"]) =>
  gradeWithChecklist(
    {},
    {
      grade: "eiken-3",
      checklist: eiken3.checklist as ChecklistItem[],
      sceneData: describeLayoutWithRelations(
        eiken3.items as unknown as RelationItem[],
      ) as string,
      description: eiken3.description,
      grammar: GRAMMAR,
      transcript,
    },
    {
      create: fake({
        ...JUDGED,
        claims,
        nextStep: { kind: "expression", text: "t", item: null },
      }),
    },
  );
const ok = (
  quote: string,
  item: string | null = null,
  level: "full" | "partial" | null = item ? "full" : null,
) => ({ quote, verdict: "correct" as const, item, level, note: null });
const wrong = (quote: string) => ({
  quote,
  verdict: "contradiction" as const,
  item: null,
  level: null,
  note: "位置が違います",
});

test("問題 1: 見本どおりに言えば、その他が無くても内容は 100 点", async () => {
  for (const scene of FIXTURES) {
    const r = await gradeWithChecklist(
      {},
      {
        grade: scene.difficulty,
        checklist: scene.checklist,
        sceneData: describeLayoutWithRelations(scene.items) as string,
        grammar: GRAMMAR,
        transcript: scene.description,
      },
      {
        create: fake({
          ...JUDGED,
          // 見本の答えは accept を全部含むので、accept をそのまま引用にする（1 つの文が 2 つの項目に当たるものは重なる）
          claims: scene.checklist.map((c) => ok(c.accept, c.id)),
          nextStep: { kind: "expression", text: "t", item: null },
        }),
      },
    );
    assert.equal(r.breakdown.claims.length, scene.checklist.length, scene.id);
    assert.equal(r.breakdown.recall.earned, MAX[scene.difficulty]);
    assert.equal(r.breakdown.recall.max, MAX[scene.difficulty]);
    assert.equal(r.content, 100, scene.id);
  }
});

test("問題 2: 名前だけの答えはその他にしかならず、正しい 1 文だけの答えより低い", async () => {
  const names = await grade3("Girl, dog, bench, bicycle, grass.", [
    ok("Girl"),
    ok("dog"),
    ok("bench"),
    ok("bicycle", "bicycle", "partial"),
    ok("grass"),
  ]);
  // その他 2 件（1）＋ 細部の一部（0.5）= 1.5 / 5。中心には当たらない
  assert.deepEqual(names.breakdown.recall, { value: 0.3, earned: 1.5, max: 5 });
  assert.deepEqual(
    names.breakdown.items.map((i) => i.level),
    ["none", "none", "partial"],
  );
  assert.equal(names.content, 46);
  const sentence = await grade3("A girl is sitting on a bench.", [
    ok("A girl is sitting on a bench", "girl_sit"),
  ]);
  assert.equal(sentence.content, 57); // R = 2/5、P = 1
  assert.ok(names.content < sentence.content);
});

test("問題 3: 位置だけ誤った文は、動作の描写が残り 0 点にならない", async () => {
  const r = await grade3(
    "A girl is sitting under a bench. A dog is running on the bench. There is a bicycle on the bench.",
    [
      ok("A girl is sitting", "girl_sit", "partial"),
      wrong("under a bench"),
      ok("A dog is running", "dog_run", "partial"),
      wrong("on the bench"),
      ok("There is a bicycle", "bicycle", "partial"),
      wrong("on the bench"),
    ],
  );
  // 2 つの "on the bench" は別の場所なので両方残る
  assert.deepEqual(
    r.breakdown.claims.map((c) => c.quote),
    [
      "A girl is sitting",
      "under a bench",
      "A dog is running",
      "on the bench",
      "There is a bicycle",
      "on the bench",
    ],
  );
  assert.deepEqual(r.breakdown.recall, { value: 0.5, earned: 2.5, max: 5 });
  assert.deepEqual(r.breakdown.precision, { value: 0.5, correct: 3, said: 6 });
  assert.equal(r.content, 50);
});

test("問題 4: 1 つの文が 2 つの項目に当たるとき、重なる引用の描写で両方に付く", async () => {
  const transcript =
    "A girl who saw the accident is running with her smartphone so that she can call for help.";
  const r = await gradeWithChecklist(
    {},
    {
      grade: "eiken-2",
      checklist: eiken2.checklist as ChecklistItem[],
      sceneData: describeLayoutWithRelations(
        eiken2.items as unknown as RelationItem[],
      ) as string,
      grammar: GRAMMAR,
      transcript,
    },
    {
      create: fake({
        ...JUDGED,
        claims: [
          ok(
            "a girl who saw the accident is running with her smartphone so that she can call for help",
            "girl_call",
          ),
          ok(
            "a girl who saw the accident is running with her smartphone",
            "girl_run",
          ),
        ],
        nextStep: { kind: "expression", text: "t", item: null },
      }),
    },
  );
  const level = (id: string) =>
    r.breakdown.items.find((i) => i.id === id)?.level;
  assert.equal(level("girl_call"), "full");
  assert.equal(level("girl_run"), "full");
  assert.deepEqual(r.breakdown.recall, { value: 4 / 14, earned: 4, max: 14 });
  assert.deepEqual(r.breakdown.precision, { value: 1, correct: 2, said: 2 });
});

test("指示に、描写の分け方・名前だけの扱い・accept の区切り・表現の見方が書いてある", async () => {
  const calls: Parameters<CreateMessage>[0][] = [];
  await gradeWithChecklist({}, inputFor(), { create: fake(JUDGED, calls) });
  const system = calls[0].system as string;
  for (const text of [
    "into separate claims",
    "A wrong position does not make the action wrong",
    "make one claim for each item; their quotes may overlap",
    'separated by " / ", saying any one of them is enough',
    "never hits them",
    "Judge the English of the whole transcript",
    "0: Only when the transcript has no English words to judge.",
  ]) {
    assert.ok(system.includes(text), text);
  }
});

test("Claude が途中で止まった・本文が無いときは ClaudeError", async () => {
  await assert.rejects(
    gradeWithChecklist({}, inputFor(), {
      create: fake(JUDGED, [], "max_tokens"),
    }),
    ClaudeError,
  );
  await assert.rejects(
    gradeWithChecklist({}, inputFor(), {
      create: (async () => ({
        stop_reason: "end_turn",
        content: [],
      })) as CreateMessage,
    }),
    ClaudeError,
  );
});

test("create を渡さず CLAUDE_API_KEY も無ければ、外を呼ばずに ClaudeError", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("呼ばない");
  }) as typeof fetch;
  try {
    await assert.rejects(gradeWithChecklist({}, inputFor()), ClaudeError);
  } finally {
    globalThis.fetch = realFetch;
  }
});
