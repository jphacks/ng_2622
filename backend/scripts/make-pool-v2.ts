// 作り置きの場面（scenenglish.scene/2）を、級ごとにまとめて作る。
// 級ごとに generateVerifiedScene（裏取りで落ちたら理由を足して 2 回まで作り直す）を順に呼び、
// 通った場面を <出力>/<id>.json に書く。全部の試行は <出力>/log.json に残す。Claude を実際に呼ぶので費用がかかる。
//   CLAUDE_API_KEY=... pnpm tsx scripts/make-pool-v2.ts <出力のディレクトリ> [--count 12] [--grade eiken-3,eiken-2] [--max-usd 3] [--start 0]
// - --count: 級ごとに作る（試す）数。既定 12
// - --grade: 作る級（, 区切りか、何度も書く）。省けば 3 つとも
// - --max-usd: 費用の上限（ドル）。合計がこれに達したら、次の場面を作らずに止まる。既定 3
// - --start: 開始番号。テーマの一覧（12 個）をここから順に回し、id の連番もここから付ける。続きを作るときに使う。既定 0
// テーマは今の 12 個を順に回す。その級で先に通った場面（出力のディレクトリに元からある場面も）の要約を avoid に渡し、違う場面を書かせる。
// 1 つ落ちても、API が失敗しても、記録して次へ進む。同じ id のファイルがあれば、その番号は作らずに飛ばす。
// ここで作った場面は候補。絵（scripts/scene/render_layout.py）に描いて人が選んでから repo に入れる。
// 料金は 100 万トークンあたりのドル（Sonnet 5.5。キャッシュの書き込みは 5 分の TTL で入力の 1.25 倍）。
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { composeLayoutV2 } from "../src/scenes/compose-v2";
import {
  type CreateMessage,
  type GenerateEnv,
  SceneGenerationError,
  THEMES,
} from "../src/scenes/generate";
import {
  generateVerifiedScene,
  SceneVerificationError,
} from "../src/scenes/generate-v2";
import { PARTS } from "../src/scenes/parts";
import { GRADE_IDS, type GradeId, type ScenePlanV2 } from "../src/scenes/types";
import { overusedCauses, summarizeScene } from "../src/scenes/variety";
import type { Problem } from "../src/scenes/verify";

const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 };

/** usage 1 回ぶんの費用（ドル） */
export const usdOf = (u: Anthropic.Usage) =>
  (u.input_tokens * PRICE.input +
    (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
    (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
    u.output_tokens * PRICE.output) /
  1e6;

const GRADE_SLUG: Record<GradeId, string> = {
  "eiken-3": "eiken3",
  "eiken-pre2": "pre2",
  "eiken-2": "eiken2",
};

/** テーマの英語の名前（かっこの中の先頭）を id に使う形にする。公園（park）→ park、駅（train station）→ train-station */
const themeSlug = (theme: string) => {
  const english = theme.match(/[（(]([^,）)]+)/)?.[1] ?? theme;
  const slug = english
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "scene";
};

/**
 * 作り置きの /2 の場面の id。gen-v2-<級>-<テーマ>-<連番 2 桁>（例: gen-v2-pre2-bus-stop-11）。
 * アプリは gen- で始まる id を「AI で作った場面」とみるので、先頭は今の作り置き（gen- ＋ 10 文字）と同じにし、
 * 続く v2- で /2 と分かるようにする。連番は級の中の番号（開始番号 + 1 から）なので、同じ級の中で重ならない
 */
export const poolSceneId = (grade: GradeId, theme: string, number: number) =>
  `gen-v2-${GRADE_SLUG[grade]}-${themeSlug(theme)}-${String(number).padStart(2, "0")}`;

export type PoolOptions = {
  out: string;
  /** 級ごとに作る（試す）数 */
  count: number;
  grades: GradeId[];
  /** 費用の上限（ドル） */
  maxUsd: number;
  /** 開始番号（テーマの回し始めと、id の連番） */
  start: number;
};

export type PoolAttempt = {
  grade: GradeId;
  /** 級の中の番号（id の連番と同じ） */
  number: number;
  theme: string;
  id: string;
  /** passed: 通って書いた、rejected: 作り直しても裏取りを通らなかった、error: API の失敗など、skipped: 同じ id のファイルがあった */
  result: "passed" | "rejected" | "error" | "skipped";
  /** 回ごとに落ちた理由（通った場面でも、作り直す前の回の理由が入る） */
  rejected: {
    code: Problem["code"];
    stage: Problem["stage"];
    message: string;
  }[][];
  error?: string;
  /** Claude を呼んだ回数と、作り直した回数（通ったときだけ） */
  calls: number;
  remakes?: number;
  sec: number;
  usd: number;
};

export type PoolLog = {
  options: PoolOptions;
  /** 費用の上限で止まったか */
  stopped: boolean;
  usd: number;
  summary: {
    grade: GradeId;
    tried: number;
    passed: number;
    rejected: number;
    error: number;
    usd: number;
    /** 通った場面で、同じ理由の原因が 3 場面を超えているもの */
    overused: { cause: string; count: number }[];
  }[];
  attempts: PoolAttempt[];
};

export type PoolDeps = {
  env: GenerateEnv;
  /** Claude の呼び出し。テストでは偽の応答に差し替える */
  create?: CreateMessage;
  now?: () => number;
  /** 進み具合を出す先（既定は stderr） */
  print?: (line: string) => void;
};

const problemsOf = (rounds: Problem[][]) =>
  rounds.map((round) =>
    round.map((p) => ({ code: p.code, stage: p.stage, message: p.message })),
  );

/** 出力のディレクトリに元からある、その級の場面（続きを作るとき、同じ場面を避けるために読む） */
const existingScenes = (out: string, grade: GradeId): ScenePlanV2[] =>
  readdirSync(out)
    .filter(
      (f) =>
        f.startsWith(`gen-v2-${GRADE_SLUG[grade]}-`) && f.endsWith(".json"),
    )
    .sort()
    .flatMap((f) => {
      try {
        return [JSON.parse(readFileSync(join(out, f), "utf8")) as ScenePlanV2];
      } catch {
        return [];
      }
    });

/** 作り置きの場面をまとめて作る。返すのは log.json に書いたものと同じ */
export async function makePool(
  options: PoolOptions,
  deps: PoolDeps,
): Promise<PoolLog> {
  const now = deps.now ?? (() => performance.now());
  const print = deps.print ?? ((line: string) => console.error(line));
  mkdirSync(options.out, { recursive: true });

  // 呼び出しを包んで、回数と費用を数える（落ちた場面・失敗した場面の分も数えるため）
  const real =
    deps.create ??
    (() => {
      const client = new Anthropic({
        apiKey: deps.env.CLAUDE_API_KEY,
        maxRetries: 0,
      });
      return ((params, callOptions) =>
        client.messages.create(params, callOptions)) as CreateMessage;
    })();
  let calls = 0;
  let usd = 0;
  const create: CreateMessage = async (params, callOptions) => {
    calls++;
    const response = await real(params, callOptions);
    usd += usdOf(response.usage);
    return response;
  };

  const attempts: PoolAttempt[] = [];
  const passed = new Map<GradeId, ScenePlanV2[]>();
  let stopped = false;
  const logOf = (): PoolLog => ({
    options,
    stopped,
    usd,
    summary: options.grades.map((grade) => {
      const mine = attempts.filter((a) => a.grade === grade);
      const count = (r: PoolAttempt["result"]) =>
        mine.filter((a) => a.result === r).length;
      return {
        grade,
        tried: mine.filter((a) => a.result !== "skipped").length,
        passed: count("passed"),
        rejected: count("rejected"),
        error: count("error"),
        usd: mine.reduce((a, b) => a + b.usd, 0),
        overused: overusedCauses(passed.get(grade) ?? [], PARTS),
      };
    }),
    attempts,
  });
  const save = () =>
    writeFile(
      join(options.out, "log.json"),
      `${JSON.stringify(logOf(), null, 2)}\n`,
    );

  grades: for (const grade of options.grades) {
    const scenes = existingScenes(options.out, grade);
    passed.set(grade, scenes);
    for (let i = 0; i < options.count; i++) {
      if (usd >= options.maxUsd) {
        stopped = true;
        print(
          `費用が上限に達したので止める（$${usd.toFixed(2)} / 上限 $${options.maxUsd}）`,
        );
        break grades;
      }
      const number = options.start + i + 1;
      const theme = THEMES[(options.start + i) % THEMES.length];
      const id = poolSceneId(grade, theme, number);
      const file = join(options.out, `${id}.json`);
      const attempt: PoolAttempt = {
        grade,
        number,
        theme,
        id,
        result: "skipped",
        rejected: [],
        calls: 0,
        sec: 0,
        usd: 0,
      };
      attempts.push(attempt);
      if (existsSync(file)) {
        print(`${id} はもうあるので飛ばす`);
        continue;
      }
      const before = { calls, usd, at: now() };
      try {
        const made = await generateVerifiedScene(
          deps.env,
          PARTS,
          { grade, theme, avoid: scenes.map(summarizeScene) },
          { create },
        );
        const layout = composeLayoutV2(made.plan, PARTS, { id, grade });
        await writeFile(file, `${JSON.stringify(layout, null, 2)}\n`);
        scenes.push(made.plan);
        attempt.result = "passed";
        attempt.remakes = made.remakes;
        attempt.rejected = problemsOf(made.rejected);
      } catch (e) {
        if (e instanceof SceneVerificationError) {
          attempt.result = "rejected";
          attempt.rejected = problemsOf(e.rejected);
        } else {
          attempt.result = "error";
          attempt.error =
            e instanceof SceneGenerationError
              ? `${e.kind}: ${e.message}`
              : e instanceof Error
                ? e.message
                : String(e);
        }
      }
      attempt.calls = calls - before.calls;
      attempt.usd = usd - before.usd;
      attempt.sec = Math.round((now() - before.at) / 100) / 10;
      const last = attempt.rejected[attempt.rejected.length - 1] ?? [];
      const note =
        attempt.result === "passed"
          ? `通った（作り直し ${attempt.remakes} 回）`
          : attempt.result === "rejected"
            ? `落ちた（${last.map((p) => p.code).join(", ")}）`
            : `失敗（${attempt.error}）`;
      print(
        `${id} ${note} 呼び出し ${attempt.calls} 回 ${attempt.sec} 秒 $${attempt.usd.toFixed(4)}`,
      );
      // 途中で止まっても記録が残るよう、1 場面ごとに書く
      await save();
    }
  }

  const log = logOf();
  await save();
  print("\n| 級 | 試した | 通った | 落ちた | 失敗 | 費用 |");
  print("| --- | --- | --- | --- | --- | --- |");
  for (const s of log.summary) {
    print(
      `| ${s.grade} | ${s.tried} | ${s.passed} | ${s.rejected} | ${s.error} | $${s.usd.toFixed(2)} |`,
    );
    for (const o of s.overused) {
      print(
        `${s.grade}: 原因 ${o.cause} が ${o.count} 場面で使われている（目安は 3 場面まで）`,
      );
    }
  }
  print(`合計 $${log.usd.toFixed(2)}${log.stopped ? "（上限で止めた）" : ""}`);
  return log;
}

/** コマンドラインの引数を読む。分からない引数・値は Error を投げる */
export const parseArgs = (argv: string[]): PoolOptions => {
  const options: PoolOptions = {
    out: "",
    count: 12,
    grades: [],
    maxUsd: 3,
    start: 0,
  };
  const number = (name: string, raw: string | undefined, min: number) => {
    const n = Number(raw);
    if (raw === undefined || !Number.isFinite(n) || n < min) {
      throw new Error(`${name} の値が違う: ${raw}`);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--count") options.count = number(arg, argv[++i], 1);
    else if (arg === "--max-usd") options.maxUsd = number(arg, argv[++i], 0);
    else if (arg === "--start") options.start = number(arg, argv[++i], 0);
    else if (arg === "--grade") {
      for (const g of (argv[++i] ?? "").split(",")) {
        if (!GRADE_IDS.includes(g as GradeId)) {
          throw new Error(
            `--grade の値が違う: ${g}（${GRADE_IDS.join("・")}）`,
          );
        }
        options.grades.push(g as GradeId);
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`知らない引数: ${arg}`);
    } else if (!options.out) options.out = arg;
    else throw new Error(`余分な引数: ${arg}`);
  }
  if (!options.out) throw new Error("出力のディレクトリが要る");
  if (!Number.isInteger(options.count) || !Number.isInteger(options.start)) {
    throw new Error("--count と --start は整数にする");
  }
  if (options.grades.length === 0) options.grades = [...GRADE_IDS];
  return options;
};

// スクリプトとして動かしたときだけ実行する（テストからは makePool を直に呼ぶ）
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let options: PoolOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    console.error(
      "使い方: CLAUDE_API_KEY=... pnpm tsx scripts/make-pool-v2.ts <出力のディレクトリ> [--count 12] [--grade eiken-3,eiken-2] [--max-usd 3] [--start 0]",
    );
    process.exit(2);
  }
  if (!process.env.CLAUDE_API_KEY) {
    console.error("CLAUDE_API_KEY が要る（環境変数で渡す）");
    process.exit(2);
  }
  await makePool(options, {
    env: {
      CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
      CLAUDE_SCENE_MODEL: process.env.CLAUDE_SCENE_MODEL,
      CLAUDE_SCENE_EFFORT: process.env.CLAUDE_SCENE_EFFORT,
    },
  });
}
