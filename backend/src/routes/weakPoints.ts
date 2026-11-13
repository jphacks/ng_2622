import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { describeRoute, validator } from "hono-openapi";
import type { AnalyzeDeps } from "../analysis/weakPoints";
import {
  createUsageCounterRepository,
  type UsageCounterRepository,
} from "../repositories/usageCounterRepository";
import {
  ErrorResponse,
  WeakPointRequest,
  WeakPointResponse,
} from "../schemas/http";
import {
  analyzeWithLimits,
  weakPointLimits,
  weakPointsEnabled,
} from "../usecases/weakPoints";
import { type AppEnv, errorBody, jsonContent } from "./shared";

const errorResponse = (description: string) => ({
  description,
  content: jsonContent(ErrorResponse),
});

/** 止めてあれば、本文を読む前に 503 で断る（PR のプレビューも止めてある） */
const requireEnabled = createMiddleware<AppEnv>(async (c, next) => {
  if (!weakPointsEnabled(c.env)) {
    return c.json(
      errorBody(
        "analysis_unavailable",
        "苦手の分析は止めてある（WEAK_POINT_ANALYSIS が on でない）",
      ),
      503,
    );
  }
  await next();
});

/** 本文の大きさの上限（WEAK_POINT_MAX_BODY_BYTES）。超えたら 413 */
const limitBody = createMiddleware<AppEnv>((c, next) =>
  bodyLimit({
    maxSize: weakPointLimits(c.env).maxBodyBytes,
    onError: (c) =>
      c.json(errorBody("invalid_message", "本文が大きすぎる"), 413),
  })(c, next),
);

export type WeakPointRouteDeps = Pick<AnalyzeDeps, "create" | "now"> & {
  /** 数える場所の差し替え（テスト用）。無ければ USAGE_COUNTER の Durable Object */
  usage?: (env: AppEnv["Bindings"]) => UsageCounterRepository;
};

/** deps はテストで Claude と数える場所を差し替えるためのもの */
export const makeWeakPointRoutes = (deps: WeakPointRouteDeps = {}) =>
  new Hono<AppEnv>().post(
    "/weak-points",
    describeRoute({
      operationId: "analyzeWeakPoints",
      tags: ["analysis"],
      summary: "直近の記録から苦手を分析する",
      description:
        "端末に残した直近の記録（内容の内訳のある 5〜10 件）の文字と、端末で数えた値を送ると、Claude がくり返す癖（内容と表現を合わせて 2〜3 件、自分の文の実例つき）・前より良くなった点・次の 1 回で試すことを書く。実例の引用は送った文字起こしにあるかをサーバーが確かめ、無いものは返さない（癖が全部落ちたら 1 回だけ呼び直す）。録音・名前・端末の ID は送らない。サーバーは本文も結果も保存しない。認証は無く、本文の大きさ・IP ごとの 1 時間の回数・全体の 1 日の回数の上限と、止めるスイッチ（WEAK_POINT_ANALYSIS）で守る。",
      responses: {
        200: {
          description: "確かめを通った分析",
          content: jsonContent(WeakPointResponse),
        },
        400: errorResponse(
          "本文の形が違う（invalid_message）。回が 4 件以下・番号が古い順に 1 からでない・長さや値の範囲の外",
        ),
        413: errorResponse("本文が大きすぎる（invalid_message）"),
        429: errorResponse(
          "回数の上限に達した（rate_limited）。IP ごとの 1 時間の回数か、全体の 1 日の回数",
        ),
        502: errorResponse(
          "Claude が失敗した（analysis_failed）。API の失敗・途中で止まった・JSON が読めない・時間切れ",
        ),
        503: errorResponse(
          "止めてある（analysis_unavailable）。WEAK_POINT_ANALYSIS が on でない（PR のプレビュー）か、Claude のキーが無い",
        ),
      },
    }),
    requireEnabled,
    limitBody,
    validator("json", WeakPointRequest, (result, c) => {
      if (!result.success) {
        // 本文の中身は返さない・ログに出さない
        return c.json(
          errorBody(
            "invalid_message",
            "rounds（5〜10 件。n は古い順に 1 から、transcript は 1〜2000 文字、claims は 30 個まで、missedItems は 12 個まで）と counts を送る",
          ),
          400,
        );
      }
    }),
    async (c) => {
      const usage = deps.usage
        ? deps.usage(c.env)
        : createUsageCounterRepository(c.env.USAGE_COUNTER);
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const result = await analyzeWithLimits(
        c.env,
        usage,
        ip,
        c.req.valid("json"),
        { create: deps.create, now: deps.now },
      );
      if (!result.ok) {
        return c.json(errorBody(result.code, result.message), result.status);
      }
      return c.json(result.body, 200);
    },
  );

export const weakPointRoutes = makeWeakPointRoutes();
