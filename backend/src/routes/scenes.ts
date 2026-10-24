import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { isSceneId } from "../domain/scenes";
import { createSceneReviewRepository } from "../repositories/sceneReviewRepository";
import {
  ErrorResponse,
  ListReviewsQuery,
  ListReviewsResponse,
  ListScenesResponse,
  SceneIdParam,
  SubmitReviewRequest,
  SubmitReviewResponse,
} from "../schemas/http";
import {
  listReviews,
  listScenesWithRatings,
  submitReview,
} from "../usecases/sceneReviews";
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

export const sceneRoutes = new Hono<AppEnv>()
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
