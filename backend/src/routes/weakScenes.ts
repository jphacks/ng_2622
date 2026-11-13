import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { describeRoute, validator } from "hono-openapi";
import {
  ErrorResponse,
  WeakSceneRequest,
  WeakSceneResponse,
} from "../schemas/http";
import {
  WEAK_SCENE_MAX_BODY_BYTES,
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

export const makeWeakSceneRoutes = () =>
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
      // 中身はこの後の commit でつなぐ
      return c.json(
        errorBody("generation_unavailable", "苦手の場面の生成はまだ無い"),
        503,
      );
    },
  );

export const weakSceneRoutes = makeWeakSceneRoutes();
