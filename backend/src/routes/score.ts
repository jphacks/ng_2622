import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { ErrorResponse, ScoreRequest, ScoreResponse } from "../schemas/http";
import { scoreLayout } from "../scoring/fromLayout";
import { type AppEnv, devOnly, errorBody, jsonContent } from "./shared";

const errorResponse = (description: string) => ({
  description,
  content: jsonContent(ErrorResponse),
});

export const scoreRoutes = new Hono<AppEnv>().post(
  "/score",
  devOnly,
  describeRoute({
    operationId: "scoreLayout",
    tags: ["scoring"],
    summary: "配置と文字起こしから採点する",
    description:
      "場面の配置の JSON（items と description）と発話の文字起こしを送る。部品のメタデータ（名前・words・大きさ）と配置（座標・向き・動き）、説明文を Claude に渡し、内容と表現を採点基準の段階（0・20・40・60・80・100）で付けて講評を返す。画像は使わず、話し方（発音）の点も付けない。",
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
          "layout（items は 1〜40 個）と transcript（1〜2000 文字）を送る。speech の点は 0〜100 の整数",
        ),
        400,
      );
    }
  }),
  async (c) => {
    const result = await scoreLayout(c.env, c.req.valid("json"));
    if (!result.ok) {
      return result.reason === "unknown_parts"
        ? c.json(errorBody("invalid_message", result.message), 400)
        : c.json(errorBody("scoring_failed", result.message), 502);
    }
    const { ok: _, ...body } = result;
    return c.json(body);
  },
);
