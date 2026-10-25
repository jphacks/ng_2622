import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describeRoute, validator } from "hono-openapi";
import { isSceneId } from "../domain/scenes";
import { createRoomRepository } from "../repositories/roomRepository";
import { createSceneReviewRepository } from "../repositories/sceneReviewRepository";
import { SceneGenerationError } from "../scenes/generate";
import { findPoolScene } from "../scenes/pool";
import {
  ErrorResponse,
  GenerateSceneRequest,
  ListReviewsQuery,
  ListReviewsResponse,
  ListScenesResponse,
  SceneIdParam,
  SceneLayout,
  SceneLayoutQuery,
  SubmitReviewRequest,
  SubmitReviewResponse,
} from "../schemas/http";
import {
  listReviews,
  listScenesWithRatings,
  submitReview,
} from "../usecases/sceneReviews";
import { generateScene } from "../usecases/scenes";
import { type AppEnv, errorBody, jsonContent } from "./shared";

const errorResponse = (description: string) => ({
  description,
  content: jsonContent(ErrorResponse),
});

const sceneIdParam = validator("param", SceneIdParam, (result, c) => {
  if (!result.success || !isSceneId(result.data.sceneId)) {
    return c.json(errorBody("unknown_scene", "シーンの ID が無い"), 404);
  }
});

const encoder = new TextEncoder();

/** Authorization: Bearer <SCENE_WRITE_TOKEN> か。合言葉が設定されていなければ通さない */
const hasWriteToken = (
  header: string | undefined,
  token: string | undefined,
) => {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = encoder.encode(header.slice("Bearer ".length));
  const b = encoder.encode(token);
  if (a.byteLength !== b.byteLength) return false;
  // 比べる時間が中身で変わらないよう、全部のバイトを見る（Workers の timingSafeEqual は Node のテストに無い）
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

/** 合言葉が要る口の前に置く。本文を読む前に断る */
const requireWriteToken = createMiddleware<AppEnv>(async (c, next) => {
  if (!hasWriteToken(c.req.header("authorization"), c.env.SCENE_WRITE_TOKEN)) {
    return c.json(errorBody("unauthorized", "合言葉が違う"), 401);
  }
  await next();
});

const GENERATION_STATUS = {
  refused: { code: "generation_refused", status: 422 },
  invalid: { code: "generation_failed", status: 422 },
  unavailable: { code: "generation_unavailable", status: 503 },
} as const;

export const sceneRoutes = new Hono<AppEnv>()
  .post(
    "/scenes/generate",
    describeRoute({
      operationId: "generateScene",
      tags: ["scenes"],
      summary: "AI で場面を作る（作り置き用）",
      description:
        "難易度（とテーマ）から、今ある部品だけで配置の JSON（scenenglish.scene/1、id は gen- ＋ 10 文字）を作って返す。保存はしない。作り置きのスクリプトが手元の wrangler dev に向けて呼び、アプリは呼ばない。形が違う・途中で止まった・5xx・接続の失敗のときだけ 1 回やり直す（各回 60 秒まで）。合言葉（Authorization: Bearer <SCENE_WRITE_TOKEN>）が要る。",
      security: [{ sceneWriteToken: [] }],
      responses: {
        200: {
          description: "作った配置の JSON",
          content: jsonContent(SceneLayout),
        },
        400: errorResponse("本文の形が違う（invalid_message）"),
        401: errorResponse("合言葉が違う（unauthorized）"),
        422: errorResponse(
          "作れなかった。Claude が断った（generation_refused）か、応答の形が違った（generation_failed）",
        ),
        503: errorResponse(
          "Claude を呼べない（generation_unavailable。タイムアウト・API の失敗・止めてある）",
        ),
      },
    }),
    requireWriteToken,
    validator("json", GenerateSceneRequest, (result, c) => {
      if (!result.success) {
        return c.json(
          errorBody(
            "invalid_message",
            "difficulty は easy・normal・hard、theme は 1〜50 文字（任意）",
          ),
          400,
        );
      }
    }),
    async (c) => {
      const body = c.req.valid("json");
      try {
        const layout = await generateScene(c.env, {
          difficulty: body.difficulty,
          theme: body.theme,
        });
        return c.json(layout, 200);
      } catch (e) {
        if (!(e instanceof SceneGenerationError)) throw e;
        const { code, status } = GENERATION_STATUS[e.kind];
        return c.json(
          errorBody(code, `作れませんでした: ${e.message}`),
          status,
        );
      }
    },
  )
  .get(
    "/scenes",
    describeRoute({
      operationId: "listScenes",
      tags: ["scenes"],
      summary: "シーンの一覧と★の平均",
      description: "選べるシーンと、それぞれの★の平均と評価した人数を返す。",
      responses: {
        200: { description: "一覧", content: jsonContent(ListScenesResponse) },
      },
    }),
    async (c) => {
      const repository = createSceneReviewRepository(c.env.SCENE_REVIEWS);
      return c.json({ scenes: await listScenesWithRatings(repository) });
    },
  )
  .get(
    "/scenes/:sceneId/layout",
    describeRoute({
      operationId: "getSceneLayout",
      tags: ["scenes"],
      summary: "場面の配置の JSON",
      description:
        "作り置きの場面（gen-…）か、部屋が AI で作った場面の配置の JSON をそのまま返す。round で届いた sceneId の場面を組み立てるのに使う。作り置きに無い場面は room（部屋のコード）を付けると、その部屋が作って置いた配置を返す（部屋が消えると無くなる）。手作りの場面には無い（404）",
      responses: {
        200: { description: "配置の JSON", content: jsonContent(SceneLayout) },
        400: errorResponse("room の形が違う（invalid_message）"),
        404: errorResponse(
          "作り置きの場面にも、room の部屋にも無い（unknown_scene）",
        ),
      },
    }),
    validator("query", SceneLayoutQuery, (result, c) => {
      if (!result.success) {
        return c.json(
          errorBody("invalid_message", "room は部屋のコード（数字 4 桁）"),
          400,
        );
      }
    }),
    async (c) => {
      const sceneId = c.req.param("sceneId");
      const { room } = c.req.valid("query");
      const scene =
        findPoolScene(sceneId) ??
        (room
          ? await createRoomRepository(c.env.ROOM).findSceneLayout(
              room,
              sceneId,
            )
          : null);
      if (!scene) {
        return c.json(errorBody("unknown_scene", "場面が無い"), 404);
      }
      return c.json(scene);
    },
  )
  .get(
    "/scenes/:sceneId/reviews",
    describeRoute({
      operationId: "listReviews",
      tags: ["scenes"],
      summary: "シーンの評価を見る",
      description: "評価（★とコメント）を新しい順に返す。",
      responses: {
        200: { description: "評価", content: jsonContent(ListReviewsResponse) },
        400: errorResponse("limit の形が違う（invalid_message）"),
        404: errorResponse("シーンが無い（unknown_scene）"),
      },
    }),
    sceneIdParam,
    validator("query", ListReviewsQuery, (result, c) => {
      if (!result.success) {
        return c.json(errorBody("invalid_message", "limit は 1〜100"), 400);
      }
    }),
    async (c) => {
      const { sceneId } = c.req.valid("param");
      const { limit } = c.req.valid("query");
      const repository = createSceneReviewRepository(c.env.SCENE_REVIEWS);
      return c.json({ reviews: await listReviews(repository, sceneId, limit) });
    },
  )
  .put(
    "/scenes/:sceneId/reviews",
    describeRoute({
      operationId: "submitReview",
      tags: ["scenes"],
      summary: "シーンを評価する",
      description:
        "★（1〜5）と任意のコメントを送る。同じ reviewerId で送り直すと上書きする。",
      responses: {
        200: {
          description: "保存した",
          content: jsonContent(SubmitReviewResponse),
        },
        400: errorResponse("本文の形が違う（invalid_message）"),
        404: errorResponse("シーンが無い（unknown_scene）"),
      },
    }),
    sceneIdParam,
    validator("json", SubmitReviewRequest, (result, c) => {
      if (!result.success) {
        return c.json(
          errorBody(
            "invalid_message",
            "★は 1〜5、名前は 1〜20 文字、コメントは 200 文字まで",
          ),
          400,
        );
      }
    }),
    async (c) => {
      const { sceneId } = c.req.valid("param");
      const body = c.req.valid("json");
      const repository = createSceneReviewRepository(c.env.SCENE_REVIEWS);
      const summary = await submitReview(repository, {
        sceneId,
        reviewerId: body.reviewerId,
        name: body.name,
        rating: body.rating,
        comment: body.comment || null,
      });
      return c.json(summary);
    },
  );
