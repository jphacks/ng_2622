import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { createSceneRubricRepository } from "../repositories/sceneRubricRepository";
import {
  ErrorResponse,
  PrepareRubricRequest,
  PrepareRubricResponse,
  ScoreRequest,
  ScoreResponse,
} from "../schemas/http";
import { prepareRubric, scoreLayout } from "../scoring/fromLayout";
import { type AppEnv, devOnly, errorBody, jsonContent } from "./shared";

const errorResponse = (description: string) => ({
  description,
  content: jsonContent(ErrorResponse),
});

// 失敗の理由から、返す状態コードとエラーコードを決める
const failure = (reason: "unknown_parts" | "api_error") =>
  reason === "unknown_parts"
    ? { code: "invalid_message" as const, status: 400 as const }
    : { code: "scoring_failed" as const, status: 502 as const };

export const scoreRoutes = new Hono<AppEnv>()
  .post(
    "/score",
    devOnly,
    describeRoute({
      operationId: "scoreLayout",
      tags: ["scoring"],
      summary: "配置と文字起こしから採点する",
      description:
        "場面の配置の JSON（items）と発話の文字起こしを送る。配置と部品のメタデータ（名前・ポーズ・大きさ・あれば色）から採点の基準（場面の説明・要素・配点）を作り、内容と表現の点と講評を返す。画像は使わず、話し方（発音）も採点しない。同じ sceneKey（省いたら同じ配置）の基準は 1 日覚えて使い回すので、同じ場面の全員が同じ基準で採点される。",
      responses: {
        200: { description: "採点した", content: jsonContent(ScoreResponse) },
        400: errorResponse(
          "本文の形が違う・部品が 1 つも見つからない（invalid_message）",
        ),
        502: errorResponse("採点の途中で失敗した（scoring_failed）"),
      },
    }),
    validator("json", ScoreRequest, (result, c) => {
      if (!result.success) {
        return c.json(
          errorBody(
            "invalid_message",
            "layout（items は 1〜40 個）と transcript（1〜2000 文字）を送る。sceneKey は 1〜128 文字",
          ),
          400,
        );
      }
    }),
    async (c) => {
      const result = await scoreLayout(
        c.env,
        createSceneRubricRepository(c.env.SCENE_RUBRICS),
        c.req.valid("json"),
      );
      if (!result.ok) {
        const { code, status } = failure(result.reason);
        return c.json(errorBody(code, result.message), status);
      }
      const { ok: _, ...body } = result;
      return c.json(body);
    },
  )
  .post(
    "/score/rubric",
    devOnly,
    describeRoute({
      operationId: "prepareRubric",
      tags: ["scoring"],
      summary: "採点の基準を先に作っておく",
      description:
        "場面を選んだとき（ラウンドの前）に呼ぶと、採点の基準を作って覚えておく。あとの POST /score は基準を作る時間を待たずに済む。もう覚えていれば、それを返す。SCORING_MODE が fixed のときも基準は作る。",
      responses: {
        200: {
          description: "基準を用意した",
          content: jsonContent(PrepareRubricResponse),
        },
        400: errorResponse(
          "本文の形が違う・部品が 1 つも見つからない（invalid_message）",
        ),
        502: errorResponse("基準を作る途中で失敗した（scoring_failed）"),
      },
    }),
    validator("json", PrepareRubricRequest, (result, c) => {
      if (!result.success) {
        return c.json(
          errorBody(
            "invalid_message",
            "layout（items は 1〜40 個）を送る。sceneKey は 1〜128 文字",
          ),
          400,
        );
      }
    }),
    async (c) => {
      const result = await prepareRubric(
        c.env,
        createSceneRubricRepository(c.env.SCENE_RUBRICS),
        c.req.valid("json"),
      );
      if (!result.ok) {
        const { code, status } = failure(result.reason);
        return c.json(errorBody(code, result.message), status);
      }
      return c.json({
        sceneKey: result.sceneKey,
        created: result.created,
        scene: {
          name: result.rubric.name,
          description: result.rubric.description,
        },
        elements: result.rubric.elements.map((e) => ({
          id: e.id,
          label: e.label,
          points: e.points,
        })),
      });
    },
  );
