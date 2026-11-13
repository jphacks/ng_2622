import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { describeRoute, validator } from "hono-openapi";
import {
  createUsageCounterRepository,
  type UsageCounterRepository,
} from "../repositories/usageCounterRepository";
import {
  ErrorResponse,
  WeakSceneRequest,
  WeakSceneResponse,
} from "../schemas/http";
import {
  makeWithLimits,
  WEAK_SCENE_MAX_BODY_BYTES,
  WEAK_SCENE_TIME_LIMIT_MS,
  type WeakSceneInput,
  type WeakSceneOutcome,
  weakScenesEnabled,
} from "../usecases/weakScenes";
import { type AppEnv, errorBody, jsonContent } from "./shared";

const errorResponse = (description: string) => ({
  description,
  content: jsonContent(ErrorResponse),
});

/** 止めてあれば、本文を読む前に 503 で断る（PR のプレビューも止めてある） */
const requireEnabled = createMiddleware<AppEnv>(async (c, next) => {
  if (!weakScenesEnabled(c.env)) {
    return c.json(
      errorBody(
        "generation_unavailable",
        "苦手の場面の生成は止めてある（WEAK_SCENE_GENERATION が on でない）",
      ),
      503,
    );
  }
  await next();
});

/** 本文の大きさの上限。級・種類・癖の題と直し方だけなので小さい */
const limitBody = bodyLimit({
  maxSize: WEAK_SCENE_MAX_BODY_BYTES,
  onError: (c) => c.json(errorBody("invalid_message", "本文が大きすぎる"), 413),
});

export type WeakSceneRouteDeps = {
  /** 数える場所の差し替え（テスト用）。無ければ USAGE_COUNTER の weak-scenes の分 */
  usage?: (env: AppEnv["Bindings"]) => UsageCounterRepository;
  /** 作る関数の差し替え（テスト用）。無ければ Durable Object（WEAK_SCENE_MAKER）の中で作る */
  make?: (
    env: AppEnv["Bindings"],
    input: WeakSceneInput,
  ) => Promise<WeakSceneOutcome>;
  /** 待つ時間の上限（ms。テスト用）。無ければ WEAK_SCENE_TIME_LIMIT_MS */
  timeLimitMs?: number;
};

/**
 * 作る関数を、上限の時間（90 秒）まで待つ。生成は 84 秒で締め切るが、作る所が返ってこないときの安全網として、
 * 時間が来たら 502 を返す（作る所はそのまま止まらずに終わることがあるが、その結果は使わない）
 */
const withinTimeLimit = async (
  make: Promise<WeakSceneOutcome>,
  ms: number,
): Promise<WeakSceneOutcome> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<WeakSceneOutcome>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          ok: false,
          code: "generation_failed",
          status: 502,
          message: "苦手の場面を作れませんでした（時間切れ）",
        }),
      ms,
    );
  });
  try {
    return await Promise.race([make, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** 1 回ごとに新しい WeakSceneMaker で作る（CPU の重い裏取りと座標の計算を Worker で動かさない） */
const makeInDurableObject = async (
  env: AppEnv["Bindings"],
  input: WeakSceneInput,
): Promise<WeakSceneOutcome> => {
  try {
    return await env.WEAK_SCENE_MAKER.get(
      env.WEAK_SCENE_MAKER.newUniqueId(),
    ).make(input);
  } catch (e) {
    // Durable Object が落ちた（CPU の上限・思わぬ例外など）。中身は出さず、502 にする
    console.error(
      JSON.stringify({
        event: "weak_scene_maker_failed",
        name: e instanceof Error ? e.name : "Error",
        message: e instanceof Error ? e.message.slice(0, 200) : "",
      }),
    );
    return {
      ok: false,
      code: "generation_failed",
      status: 502,
      message: "苦手の場面を作れませんでした（作る所が途中で止まった）",
    };
  }
};

/** deps はテストで数える場所と作る関数を差し替えるためのもの */
export const makeWeakSceneRoutes = (deps: WeakSceneRouteDeps = {}) =>
  new Hono<AppEnv>().post(
    "/weak-scenes",
    describeRoute({
      operationId: "generateWeakScene",
      tags: ["scenes"],
      summary: "苦手を練習する場面を作る",
      description:
        "級と苦手（言えた割合の低い項目の種類・AI の分析の癖の題と直し方・次に試すこと）を送ると、その苦手を練習する場面を AI で作り、サーバーの置き場（R2 の weak-scenes/<sceneId>.json）に置いて返す。苦手の種類の項目を目立たせ、表現の癖に合う文法を使わせる（項目の種類の数は級のまま）。手持ちの部品に無い物は、その場で 3D の部品を作る（1 場面 4 個まで）。部屋の start にこの sceneId を送ると、この場面でラウンドが始まる。本人の英文の引用は送らない。認証は無く、IP ごとの 1 時間の回数・全体の 1 日の回数の上限と、止めるスイッチ（WEAK_SCENE_GENERATION）で守る。時間は 90 秒まで。",
      responses: {
        200: {
          description: "作った場面",
          content: jsonContent(WeakSceneResponse),
        },
        400: errorResponse(
          "本文の形が違う（invalid_message）。級・種類の値の外、kinds が 0 個か 5 個以上、habits が 4 個以上、文字の長さの外",
        ),
        413: errorResponse("本文が大きすぎる（invalid_message）"),
        429: errorResponse(
          "回数の上限に達した（rate_limited）。IP ごとの 1 時間の回数か、全体の 1 日の回数",
        ),
        502: errorResponse(
          "作れなかった（generation_failed・generation_refused）。Claude の失敗・断った・時間切れ、部品を作れなかった、作り直しても裏取りを通らなかった",
        ),
        503: errorResponse(
          "作れない（generation_unavailable）。WEAK_SCENE_GENERATION が on でない（PR のプレビュー）、Claude のキーや置き場が無い、または回数を数える場所（UsageCounter）が失敗した",
        ),
      },
    }),
    requireEnabled,
    limitBody,
    validator("json", WeakSceneRequest, (result, c) => {
      if (!result.success) {
        // 本文の中身は返さない・ログに出さない
        return c.json(
          errorBody(
            "invalid_message",
            "difficulty（eiken-3・eiken-pre2・eiken-2）と kinds（center・reason・link・detail を 1〜4 個）を送る。habits は 3 個まで（title は 80 文字、fix は 200 文字まで）、nextTry.text は 200 文字まで",
          ),
          400,
        );
      }
    }),
    async (c) => {
      const usage = deps.usage
        ? deps.usage(c.env)
        : createUsageCounterRepository(c.env.USAGE_COUNTER, "weak-scenes");
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const make = deps.make ?? makeInDurableObject;
      const result = await makeWithLimits(
        c.env,
        usage,
        ip,
        c.req.valid("json"),
        (input) =>
          withinTimeLimit(
            make(c.env, input),
            deps.timeLimitMs ?? WEAK_SCENE_TIME_LIMIT_MS,
          ),
      );
      if (!result.ok) {
        return c.json(errorBody(result.code, result.message), result.status);
      }
      return c.json(result.body, 200);
    },
  );

export const weakSceneRoutes = makeWeakSceneRoutes();
