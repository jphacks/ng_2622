// 苦手の分析の測定（scripts/measure-weak-points.ts）に使う記録の組を作る。
// 癖を仕込んで手で書いた文字起こし（test/fixtures/weak-points/transcripts.json）を、作り置きの場面の配置と一緒に
// 採点の口（POST /score。部屋と同じチェックリストの採点）に文字だけ通し、記録の形（端末の scenenglish.record/1 の
// scene と result）から、アプリが POST /weak-points に送る本文（rounds と counts）を作って
// test/fixtures/weak-points/<人>.json に書く。数え方は docs/design/weak-point-analysis.md の 4（端末で数えるものと同じ式）。
// 音声は使わず、話し方の点は送らない（分析には送らないので影響しない）。Claude を実際に呼ぶので費用がかかる（30 回で約 0.5 USD）。
//   CLAUDE_API_KEY=... pnpm tsx scripts/make-weak-point-fixtures.ts [費用の上限ドル（既定 1）] [--only person-2] [--url http://localhost:8787]
// --only を付けると、その人の記録の組だけを作り直す（ほかの person-*.json は書き換えない）
// --url を付けないときは、POST /score の口（src/routes/score.ts）をこのプロセスの中で呼ぶ（wrangler dev は要らない。
// 費用は Claude の応答の usage から数える）。--url を付けると、手元の wrangler dev（pnpm dev）の POST /score を呼ぶ
// （費用は 1 回 0.02 USD と見積もる）
import { readFile, writeFile } from "node:fs/promises";
import { findPoolScene } from "../src/scenes/pool";
import type { ChecklistKind, GradeId } from "../src/scenes/types";
import { WEAK_POINT_MAX_ROUNDS } from "../src/schemas/http";

// 100 万トークンあたりのドル（Sonnet 5.5）
const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 };
const ESTIMATE_PER_CALL = 0.02;
// wrangler.jsonc の本番と同じ採点の設定
const SCORING_ENV = {
  ENABLE_DEV_ROUTES: "true",
  SCORING_MODE: "live",
  SCORE_WEIGHTS: "50,25,25",
  CLAUDE_MODEL: "claude-sonnet-5-5",
  CLAUDE_EFFORT: "low",
};

const dir = new URL("../test/fixtures/weak-points/", import.meta.url);

type SourceRound = {
  scene: string;
  transcript: string;
  // null と書いた回は、欄の無い前の記録のまねで、採点の根拠を null にして送る
  expressionBasis?: null;
};
type Person = {
  id: string;
  label: string;
  planted: unknown[];
  rounds: SourceRound[];
  [key: string]: unknown;
};

type ScoreBody = {
  content: number;
  expression: number;
  transcript: string;
  breakdown: {
    claims: {
      quote: string;
      verdict: "correct" | "contradiction" | "absent" | "offtopic";
      item: string | null;
      note: string | null;
    }[];
    items: {
      id: string;
      kind: ChecklistKind;
      label: string;
      level: "full" | "partial" | "none";
    }[];
  };
  feedback: {
    nextStep: {
      kind: "content" | "expression" | "speech";
      text: string;
      item: string | null;
    };
    rewrite: { before: string; after: string; reason: string } | null;
    expressionBasis: string | null;
  };
  mode: string;
};

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const url = option("--url");
const only = option("--only");
const rest = args.filter(
  (a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"),
);
const cap = Number(rest[0] ?? 1);
if (!url && !process.env.CLAUDE_API_KEY) {
  console.error(
    "CLAUDE_API_KEY が要る（--url のときは wrangler dev の側に要る）",
  );
  process.exit(2);
}

// このプロセスの中で呼ぶときは、Claude の応答の usage を fetch の所で拾って費用を数える
let usd = 0;
let measuredCalls = 0;
if (!url) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const response = await original(input, init);
    const target =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (target.includes("api.anthropic.com")) {
      try {
        const u = (await response.clone().json()).usage;
        if (u) {
          measuredCalls++;
          usd +=
            ((u.input_tokens ?? 0) * PRICE.input +
              (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
              (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
              (u.output_tokens ?? 0) * PRICE.output) /
            1e6;
        }
      } catch {
        // usage が読めない応答（失敗など）は数えない
      }
    }
    return response;
  };
}

const score = async (
  layout: unknown,
  transcript: string,
): Promise<ScoreBody> => {
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ layout, transcript }),
  };
  let res: Response;
  if (url) {
    res = await fetch(`${url}/score`, request);
    usd += ESTIMATE_PER_CALL;
  } else {
    const { default: app } = await import("../src/app");
    res = await app.request("/score", request, {
      ...SCORING_ENV,
      CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
    });
  }
  if (!res.ok)
    throw new Error(`POST /score が ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as ScoreBody;
  if (body.mode !== "live")
    throw new Error(
      "固定の点数のモードで採点された（SCORING_MODE を live に）",
    );
  return body;
};

const LEVEL_VALUE = { full: 1, partial: 0.5, none: 0 } as const;
const KINDS: ChecklistKind[] = ["center", "reason", "link", "detail"];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const source = JSON.parse(
  await readFile(new URL("transcripts.json", dir), "utf8"),
) as {
  persons: Person[];
};

const persons = source.persons.filter((p) => !only || p.id === only);
if (persons.length === 0) throw new Error(`記録の組が無い: ${only}`);
for (const person of persons) {
  if (person.rounds.length > WEAK_POINT_MAX_ROUNDS)
    throw new Error(`${person.id} の回が多すぎる`);
  const rounds = [];
  const scores: {
    n: number;
    scene: string;
    content: number;
    expression: number;
  }[] = [];
  const items: ScoreBody["breakdown"]["items"][] = [];
  for (const [i, r] of person.rounds.entries()) {
    if (usd >= cap) {
      console.error(
        `費用の上限 ${cap} USD に達したので止める（${usd.toFixed(3)} USD）`,
      );
      process.exit(1);
    }
    const scene = findPoolScene(r.scene);
    if (!scene) throw new Error(`作り置きに無い場面: ${r.scene}`);
    const graded = await score(
      {
        difficulty: scene.difficulty,
        description: scene.description,
        checklist: scene.checklist,
        items: scene.items,
      },
      r.transcript,
    );
    const byId = new Map(scene.checklist.map((c) => [c.id, c]));
    rounds.push({
      n: i + 1,
      grade: scene.difficulty as GradeId,
      transcript: graded.transcript,
      claims: graded.breakdown.claims.map((c) => ({
        quote: c.quote,
        verdict: c.verdict,
        item: c.item,
        note: c.note,
      })),
      rewrite: graded.feedback.rewrite,
      nextStep: {
        kind: graded.feedback.nextStep.kind,
        text: graded.feedback.nextStep.text,
        item: graded.feedback.nextStep.item,
      },
      expressionBasis:
        r.expressionBasis === null ? null : graded.feedback.expressionBasis,
      scene: {
        description: scene.description,
        missedItems: graded.breakdown.items
          .filter((it) => it.level !== "full")
          .map((it) => ({
            id: it.id,
            kind: it.kind,
            label: it.label,
            accept: byId.get(it.id)?.accept ?? "",
            level: it.level as "none" | "partial",
          })),
      },
    });
    items.push(graded.breakdown.items);
    scores.push({
      n: i + 1,
      scene: r.scene,
      content: graded.content,
      expression: graded.expression,
    });
    console.log(
      `${person.id} ${i + 1} 回目 ${r.scene}: 内容 ${graded.content}・表現 ${graded.expression}（${usd.toFixed(3)} USD）`,
    );
  }

  // 端末で数えるもの（docs/design/weak-point-analysis.md の 4）
  const kinds = KINDS.map((kind) => {
    const of = items.flat().filter((it) => it.kind === kind);
    return {
      kind,
      earned: of.reduce((a, it) => a + LEVEL_VALUE[it.level], 0),
      total: of.length,
    };
  }).filter((k) => k.total > 0);
  const verdicts = { correct: 0, contradiction: 0, absent: 0, offtopic: 0 };
  for (const r of rounds) for (const c of r.claims) verdicts[c.verdict]++;
  const h = Math.floor(rounds.length / 2);
  const half = (part: typeof scores) => ({
    rounds: part.length,
    content: mean(part.map((s) => s.content)),
    expression: mean(part.map((s) => s.expression)),
  });
  const { rounds: _, ...meta } = person;
  const fixture = {
    ...meta,
    scores,
    request: {
      rounds,
      counts: {
        rounds: rounds.length,
        kinds,
        verdicts,
        halves: {
          first: half(scores.slice(0, h)),
          second: half(scores.slice(-h)),
        },
      },
    },
  };
  await writeFile(
    new URL(`${person.id}.json`, dir),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
  console.log(`${person.id}.json を書いた`);
}
if (!url && measuredCalls === 0) {
  console.error("Claude の usage を拾えなかった（費用は数えていない）");
}
console.log(`費用 ${usd.toFixed(3)} USD${url ? "（見積もり）" : ""}`);
