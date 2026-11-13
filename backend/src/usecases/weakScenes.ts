import type { z } from "zod";
import type { UsageLimits } from "../durable-objects/usageCounter";
import type { UsageCounterRepository } from "../repositories/usageCounterRepository";
import type {
  WeakSceneRecord,
  WeakSceneStore,
} from "../repositories/weakSceneRepository";
import { composeLayoutV2 } from "../scenes/compose-v2";
import {
  type CreateMessage,
  type GenerateEnv,
  SceneGenerationError,
} from "../scenes/generate";
import {
  generateVerifiedScene,
  PartBuildError,
  SceneVerificationError,
  type Workshop,
} from "../scenes/generate-v2";
import { MAX_NEW_PARTS, withVersions } from "../scenes/lookup";
import { PARTS } from "../scenes/parts";
import { pickFocus } from "../scenes/weak";
import type { WeakSceneRequest, WeakSceneResponse } from "../schemas/http";
import { rateKeyOf } from "./weakPoints";

// 苦手の場面の口（POST /weak-scenes）の中身。止めるスイッチ・回数の上限を見てから、苦手を入れた場面を作り、
// R2 の weak-scenes/<sceneId>.json に置いて返す（docs/design/part-generation.md）。
// 本文（癖の題と直し方など）は保存せず、ログにも出さない。ログに残すのは級・狙った種類・作った部品の数・時間・トークンだけ

export type WeakSceneEnv = GenerateEnv & {
  // "on" のときだけ作る。PR のプレビューは off（wrangler.jsonc の previews）
  WEAK_SCENE_GENERATION?: string;
  // IP ごとの 1 時間の回数・全体の 1 日（日本時間）の回数（受け付けた 1 回で 1 つ。作り直しや部品は数えない）
  WEAK_SCENE_IP_PER_HOUR?: string;
  WEAK_SCENE_DAILY_LIMIT?: string;
};

export type WeakSceneInput = z.infer<typeof WeakSceneRequest>;
export type WeakSceneBody = z.infer<typeof WeakSceneResponse>;

/** 本文の大きさの上限（バイト）。癖 3 個の題と直し方・次に試すことで 2 KB ほど */
export const WEAK_SCENE_MAX_BODY_BYTES = 8_192;

/** サーバーの上限時間（ms）。生成はこれより前に締め切り、置き場に置いて返す余裕を残す */
export const WEAK_SCENE_TIME_LIMIT_MS = 90_000;
const GENERATION_BUDGET_MS = 84_000;
/** Claude の 1 回の上限（ms）。2 回目と部品の注文で 30 秒近くかかることがある */
const CALL_TIMEOUT_MS = 45_000;

// vars が無い・読めないときの値（普段の値。wrangler.jsonc と同じ）
const DEFAULTS = { perHour: 5, daily: 40 };

const count = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(n) && n >= 0
    ? n
    : fallback;
};

/** 止めるスイッチ。on のときだけ動かす（変数が無い・on 以外なら止める） */
export const weakScenesEnabled = (env: WeakSceneEnv) =>
  env.WEAK_SCENE_GENERATION === "on";

export const weakSceneLimits = (env: WeakSceneEnv): UsageLimits => ({
  perHour: count(env.WEAK_SCENE_IP_PER_HOUR, DEFAULTS.perHour),
  daily: count(env.WEAK_SCENE_DAILY_LIMIT, DEFAULTS.daily),
});

export type WeakSceneOutcome =
  | { ok: true; body: WeakSceneBody }
  | {
      ok: false;
      code:
        | "rate_limited"
        | "generation_failed"
        | "generation_refused"
        | "generation_unavailable";
      status: 429 | 502 | 503;
      message: string;
    };

/** 差し替えられるもの（テスト用）。無ければ本物（Claude・部品を作る口・R2） */
export type WeakSceneDeps = {
  create?: CreateMessage;
  workshop: Workshop;
  store: WeakSceneStore;
  newId?: () => string;
  /** 生成の締め切りまでの時間（ms）。テストで短くする */
  budgetMs?: number;
};

const unavailable = (message: string): WeakSceneOutcome => ({
  ok: false,
  code: "generation_unavailable",
  status: 503,
  message,
});

/**
 * 苦手を入れた場面を作って置く（上限は数えない。呼ぶ側が数える）。
 * 狙う種類は kinds のうちその級に有る最初の種類。2 回目は ID の規約で引き、足りない部品はその場で作る（1 場面 4 個まで）。
 * 失敗（Claude・部品・裏取り・時間切れ）は 502、Claude のキーが無いときは 503
 */
export async function makeWeakScene(
  env: WeakSceneEnv,
  input: WeakSceneInput,
  deps: WeakSceneDeps,
): Promise<WeakSceneOutcome> {
  if (!env.CLAUDE_API_KEY && !deps.create) {
    return unavailable("苦手の場面の生成は止めてある（CLAUDE_API_KEY が無い）");
  }
  const started = Date.now();
  const focus = pickFocus(input.difficulty, input.kinds);
  const budget = deps.budgetMs ?? GENERATION_BUDGET_MS;
  const signal = AbortSignal.timeout(budget);
  try {
    const result = await generateVerifiedScene(
      env,
      PARTS,
      {
        grade: input.difficulty,
        weak: {
          kind: focus,
          habits: input.habits ?? [],
          ...(input.nextTry ? { nextTry: input.nextTry } : {}),
        },
      },
      {
        ...(deps.create ? { create: deps.create } : {}),
        lookup: { workshop: deps.workshop, maxNew: MAX_NEW_PARTS },
      },
      {
        timeoutMs: CALL_TIMEOUT_MS,
        signal,
        deadline: started + budget,
      },
    );
    const sceneId = `weak-${(deps.newId ?? (() => crypto.randomUUID()))()}`;
    const layout = withVersions(
      composeLayoutV2(result.plan, [...PARTS, ...result.extraParts], {
        id: sceneId,
        grade: input.difficulty,
      }),
      result.extraParts,
    );
    if (layout.items.length === 0) {
      throw new SceneGenerationError("invalid", "置ける部品が無かった");
    }
    const body: WeakSceneBody = {
      sceneId,
      name: layout.name,
      difficulty: input.difficulty,
      focus,
      pitch: result.pitch ?? "",
      layout,
      createdParts: result.extraParts.map((p) => `${p.id}@${p.version}`),
    };
    const record: WeakSceneRecord = {
      ...body,
      parts: result.extraParts,
      createdAt: new Date().toISOString(),
    };
    await deps.store.put(record);
    console.log(
      JSON.stringify({
        event: "weak_scene_generated",
        sceneId,
        grade: input.difficulty,
        focus,
        habits: input.habits?.length ?? 0,
        model: result.model,
        remakes: result.remakes,
        rejected: result.rejected.map((r) => r.map((p) => p.code)),
        made: result.madeParts,
        // 部品を作るのに Claude に払った額（USD。部品を作る口のログの合計）
        partsUsd: Number(
          result.partLogs.reduce((n, l) => n + l.usd, 0).toFixed(4),
        ),
        partsMs: result.partLogs.map((l) => l.ms),
        reused: result.extraParts
          .map((p) => p.id)
          .filter((id) => !result.madeParts.includes(id)),
        elapsedMs: Date.now() - started,
        usage: result.usage,
      }),
    );
    return { ok: true, body };
  } catch (e) {
    if (!(e instanceof SceneGenerationError)) throw e;
    console.error(
      JSON.stringify({
        event: "weak_scene_failed",
        grade: input.difficulty,
        focus,
        kind: e.kind,
        reason:
          e instanceof PartBuildError
            ? "parts"
            : e instanceof SceneVerificationError
              ? "verification"
              : "claude",
        problems:
          e instanceof SceneVerificationError
            ? e.rejected.map((r) => r.map((p) => p.code))
            : undefined,
        message: e.message,
        elapsedMs: Date.now() - started,
      }),
    );
    return {
      ok: false,
      code: e.kind === "refused" ? "generation_refused" : "generation_failed",
      status: 502,
      message: `苦手の場面を作れませんでした: ${e.message}`,
    };
  }
}

/**
 * 回数の上限を数えてから作る。ip は接続元の IP（CF-Connecting-IP）、usage は数える場所（UsageCounter の weak-scenes の分）、
 * make は作る関数（本物は Durable Object の中で makeWeakScene を動かす）。
 * 数える場所が失敗したら 503（数えずに作らない）。上限なら 429
 */
export async function makeWithLimits(
  env: WeakSceneEnv,
  usage: UsageCounterRepository,
  ip: string,
  input: WeakSceneInput,
  make: (input: WeakSceneInput) => Promise<WeakSceneOutcome>,
): Promise<WeakSceneOutcome> {
  if (!env.CLAUDE_API_KEY) {
    return unavailable("苦手の場面の生成は止めてある（CLAUDE_API_KEY が無い）");
  }
  let taken: Awaited<ReturnType<UsageCounterRepository["take"]>>;
  try {
    taken = await usage.take(rateKeyOf(ip), weakSceneLimits(env));
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "weak_scene_counter_failed",
        name: e instanceof Error ? e.name : "Error",
      }),
    );
    return unavailable("苦手の場面の回数を数えられなかった");
  }
  if (!taken.ok) {
    console.log(
      JSON.stringify({ event: "weak_scene_limited", reason: taken.reason }),
    );
    return {
      ok: false,
      code: "rate_limited",
      status: 429,
      message:
        taken.reason === "ip_hourly"
          ? "苦手の場面の回数が、この 1 時間の上限に達した"
          : "苦手の場面の回数が、今日の上限に達した",
    };
  }
  return make(input);
}
