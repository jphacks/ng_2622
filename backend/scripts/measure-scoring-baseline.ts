// チェックリストの採点（gradeWithChecklist）を、試験用の 3 場面と用意した答えで何度も通し、点のぶれを測る。
// 合格は、同じ答えを 5 回採点した内容の点の幅（最大 − 最小）が、どの答えでも 5 点以内
// （ADR 20261110-score-content-with-checklist-f1 の安定の条件）。
// 表現の点の幅と、表現が 0 点になった回数・0 点で呼び直した回数も出すが、参考で合否には入れない。
// 手書きの文字起こしを渡す。Azure は呼ばず、話し方の 3 つの点は 75 に固定する。Claude を実際に呼ぶので費用がかかる。
//   CLAUDE_API_KEY=... pnpm tsx scripts/measure-scoring-baseline.ts <結果の JSON> [1 答えあたりの回数（既定 5）] [費用の上限ドル（既定 2.5）]
import { writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { grammarFor } from "../src/scoring";
import type { ChecklistItem, Grade } from "../src/scoring/checklist";
import {
  type CreateMessage,
  gradeWithChecklist,
} from "../src/scoring/checklistGrade";
import {
  describeLayoutWithRelations,
  type RelationItem,
} from "../src/scoring/layout";
import eiken2 from "../test/fixtures/checklist-eiken-2.json";
import eiken3 from "../test/fixtures/checklist-eiken-3.json";
import eikenPre2 from "../test/fixtures/checklist-eiken-pre2.json";

// 100 万トークンあたりのドル（Sonnet 5.5。キャッシュの書き込みは 5 分の TTL で入力の 1.25 倍）
const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 };
// 幅がこの点以内なら合格
const MAX_RANGE = 5;
const env = {
  CLAUDE_MODEL: "claude-sonnet-5-5", // wrangler.jsonc の本番と同じ
  CLAUDE_EFFORT: "low",
};

type Fixture = {
  id: string;
  difficulty: Grade;
  description: string;
  checklist: ChecklistItem[];
  items: RelationItem[];
};
type Case = { kind: string; text: string };

// どの場面にも当てはまらない答え
const OFF_SCENE: Case[] = [
  {
    kind: "場面にないこと",
    text: "A teacher is writing on the blackboard. A cat is eating a fish.",
  },
  {
    kind: "難しい語で的外れ",
    text: "Although the weather is beautiful, an elderly gentleman, who seems exhausted, has decided to stroll along the riverside.",
  },
];

const SCENES: { scene: Fixture; cases: Case[] }[] = [
  {
    scene: eiken3 as unknown as Fixture,
    cases: [
      {
        kind: "見本どおり",
        text: "A girl is sitting on a bench. A dog is running on the grass. There is a bicycle next to the bench.",
      },
      {
        kind: "複文で全部",
        text: "While a girl is sitting on a bench with a bicycle next to it, a dog is running across the grass.",
      },
      { kind: "正しい一文だけ", text: "A girl is sitting on a bench." },
      {
        kind: "細部だけ",
        text: "There is a bicycle next to the bench. I can see green grass.",
      },
      {
        kind: "推測を足す",
        text: "A girl is sitting on a bench. I think she is tired. A dog is running on the grass. Maybe it is her dog.",
      },
      {
        kind: "前置詞の誤り",
        text: "A girl is sitting under a bench. A dog is running on the bench. There is a bicycle on the bench.",
      },
      {
        kind: "文法の誤り",
        text: "Girl sit on bench. Dog run on grass. Bicycle is next to bench.",
      },
      { kind: "名前だけ", text: "Girl, dog, bench, bicycle, grass." },
      ...OFF_SCENE,
    ],
  },
  {
    scene: eikenPre2 as unknown as Fixture,
    cases: [
      {
        kind: "見本どおり",
        text: "There is spilled juice on the table. A woman is wiping the table because of the juice. A waiter is bringing a cup. A boy is sitting on a chair. There is a plant next to the boy.",
      },
      {
        kind: "複文で全部",
        text: "A woman is wiping the table because someone spilled juice on it, while a waiter is bringing a cup and a boy is sitting on a chair next to a plant.",
      },
      { kind: "正しい一文だけ", text: "A woman is wiping the table." },
      {
        kind: "細部だけ",
        text: "There is juice on the table. There is a plant near the chair.",
      },
      {
        kind: "推測を足す",
        text: "A woman is wiping the table because the boy spilled his juice. I think she is angry. A waiter is bringing a cup. Maybe it is coffee.",
      },
      {
        kind: "前置詞の誤り",
        text: "A woman is wiping under the table. A waiter is bringing a cup. A boy is sitting on the table. There is a plant on the chair.",
      },
      {
        kind: "文法の誤り",
        text: "Woman wipe table because juice. Waiter bring cup. Boy sit on chair.",
      },
      {
        kind: "名前だけ",
        text: "Woman, waiter, boy, table, juice, cup, chair, plant.",
      },
      ...OFF_SCENE,
    ],
  },
  {
    scene: eiken2 as unknown as Fixture,
    cases: [
      {
        kind: "見本どおり",
        text: "A woman has fallen on the street because her bicycle fell over. A man is helping her stand up. A girl is running with her smartphone to call for help because she saw the accident. An old man is standing near the bench. The bicycle is lying next to the woman. There is a bag on the bench.",
      },
      {
        kind: "複文で全部",
        text: "A woman who was riding a bicycle has fallen on the street, so a man is holding out his hand to help her stand up, and a girl who saw the accident is running with her smartphone so that she can call for help, while an old man is standing near a bench which has a bag on it.",
      },
      {
        kind: "正しい一文だけ",
        text: "A man is helping a woman who has fallen on the street.",
      },
      {
        kind: "細部だけ",
        text: "There is a bag on the bench. A bicycle is lying on the ground.",
      },
      {
        kind: "理由が 1 段だけ",
        text: "A woman has fallen on the street. A man is helping her. A girl is running because she saw the accident. An old man is standing near the bench.",
      },
      {
        kind: "前置詞の誤り",
        text: "A woman has fallen on the bench. A man is holding out his hand to her. A girl is running to the bench. An old man is sitting on the bench.",
      },
      {
        kind: "文法の誤り",
        text: "Woman fall on street because bicycle fall. Man help her stand. Girl run with phone for call help. Old man stand near bench.",
      },
      {
        kind: "名前だけ",
        text: "Woman, man, girl, old man, bicycle, bench, bag, smartphone.",
      },
      ...OFF_SCENE,
    ],
  },
];

const out = process.argv[2];
const reps = Number(process.argv[3] ?? 5);
const limit = Number(process.argv[4] ?? 2.5);
if (!out) throw new Error("結果の JSON の書き出し先が要る");
if (!process.env.CLAUDE_API_KEY) throw new Error("CLAUDE_API_KEY が要る");

// gradeWithChecklist は使用量を返さないので、差し替えた呼び出しの中で拾って費用を積む
let usd = 0;
const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const create: CreateMessage = async (params) => {
  const response = await client.messages.create(params);
  const u = response.usage;
  usd +=
    (u.input_tokens * PRICE.input +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      u.output_tokens * PRICE.output) /
    1e6;
  return response;
};

type Row = {
  scene: string;
  grade: Grade;
  kind: string;
  text: string;
  rep: number;
  ms: number;
} & (
  | {
      content: number;
      expression: number;
      // 表現の点の根拠と、呼び直した回数（表現 0 点か根拠が空）
      expressionBasis: string;
      expressionRetries: number;
      recall: string;
      precision: string;
      items: Record<string, string>;
      claims: unknown[];
      nextStep: unknown;
      rewrite: unknown;
    }
  | { error: string }
);

const rows: Row[] = [];
const jobs = SCENES.flatMap(({ scene, cases }) =>
  cases.flatMap((c) =>
    Array.from({ length: reps }, (_, rep) => ({ scene, c, rep })),
  ),
);

const range = (ns: number[]) => Math.max(...ns) - Math.min(...ns);
// 答えごとに、内容と表現の点の並びと幅をまとめる。途中で止まって回数が足りない答えは合格にしない
const summarize = () =>
  SCENES.flatMap(({ scene, cases }) =>
    cases.map((c) => {
      const done = rows.filter(
        (r) => r.scene === scene.id && r.kind === c.kind && "content" in r,
      ) as Extract<Row, { content: number }>[];
      const content = done.map((r) => r.content);
      const expression = done.map((r) => r.expression);
      return {
        scene: scene.id,
        grade: scene.difficulty,
        kind: c.kind,
        runs: done.length,
        content,
        contentRange: done.length ? range(content) : null,
        expression,
        expressionRange: done.length ? range(expression) : null,
        // 表現 0 点か根拠が空で呼び直した回数（1 回の採点で 2 回まで。その分 Claude を余計に呼んでいて、時間も延びる）
        retries: done.reduce((n, r) => n + r.expressionRetries, 0),
        meanMs: done.length
          ? Math.round(done.reduce((s, r) => s + r.ms, 0) / done.length)
          : null,
        pass: done.length === reps && range(content) <= MAX_RANGE,
      };
    }),
  );

const save = () => {
  const summary = summarize();
  return writeFile(
    out,
    JSON.stringify(
      {
        reps,
        usd,
        maxRange: MAX_RANGE,
        pass: summary.every((s) => s.pass),
        // 参考（合否には入れない）: 表現の点の幅の最大と、表現が 0 点になった回数
        expressionMaxRange: Math.max(
          0,
          ...summary.map((s) => s.expressionRange ?? 0),
        ),
        expressionRetries: summary.reduce((n, s) => n + s.retries, 0),
        expressionZeros: summary.reduce(
          (n, s) => n + s.expression.filter((e) => e === 0).length,
          0,
        ),
        summary,
        rows,
      },
      null,
      1,
    ),
  );
};

let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < jobs.length && usd < limit) {
      const { scene, c, rep } = jobs[next++];
      const base = {
        scene: scene.id,
        grade: scene.difficulty,
        kind: c.kind,
        text: c.text,
        rep,
      };
      const started = performance.now();
      try {
        const g = await gradeWithChecklist(
          env,
          {
            grade: scene.difficulty,
            checklist: scene.checklist,
            sceneData: describeLayoutWithRelations(scene.items) as string,
            description: scene.description,
            // 級の文法の一覧は、本番の採点と同じく生成の定数 GRADES から作る（下の級の分も含む）
            ...grammarFor(scene.difficulty),
            transcript: c.text,
            speech: { accuracy: 75, fluency: 75, prosody: 75 },
          },
          { create },
        );
        const { recall, precision, items, claims } = g.breakdown;
        rows.push({
          ...base,
          ms: Math.round(performance.now() - started),
          content: g.content,
          expression: g.expression,
          expressionBasis: g.expressionBasis,
          expressionRetries: g.expressionRetries,
          recall: `${recall.earned}/${recall.max}`,
          precision: `${precision.correct}/${precision.said}`,
          items: Object.fromEntries(items.map((i) => [i.id, i.level])),
          claims,
          nextStep: g.nextStep,
          rewrite: g.rewrite,
        });
      } catch (e) {
        rows.push({
          ...base,
          ms: Math.round(performance.now() - started),
          error: String(e),
        });
      }
      await save();
      console.log(rows.length, "/", jobs.length, usd.toFixed(3));
    }
  }),
);
await save();

const summary = summarize();
console.table(
  summary.map((s) => ({
    grade: s.grade,
    kind: s.kind,
    content: s.content.join(" "),
    range: s.contentRange,
    expression: s.expression.join(" "),
    "expressionRange（参考）": s.expressionRange,
    呼び直し: s.retries,
    ms: s.meanMs,
    pass: s.pass,
  })),
);
const failed = summary.filter((s) => !s.pass);
console.log(
  failed.length === 0
    ? `合格: どの答えも内容の点の幅が ${MAX_RANGE} 点以内（${usd.toFixed(2)} USD）`
    : `不合格: ${failed.length} / ${summary.length} の答えで幅が ${MAX_RANGE} 点を超えたか、回数が足りない（${usd.toFixed(2)} USD）`,
);
// 参考: 表現の点（合否には入れない）
const zeros = summary.filter((s) => s.expression.includes(0));
console.log(
  `表現の点の幅（参考）: 最大 ${Math.max(0, ...summary.map((s) => s.expressionRange ?? 0))} 点。表現が 0 点になった答え: ${
    zeros.length === 0
      ? "なし"
      : zeros.map((s) => `${s.grade}「${s.kind}」`).join("、")
  }。呼び直した回数（表現 0 点か根拠が空）: ${summary.reduce((n, s) => n + s.retries, 0)}`,
);
if (failed.length > 0) process.exitCode = 1;
