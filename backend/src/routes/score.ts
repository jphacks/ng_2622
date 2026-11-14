import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { parsePartRef } from "../parts/ids";
import { lookupPart } from "../parts/workshop";
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
      "場面の配置の JSON（scenenglish.scene/2 のうち difficulty・description・checklist・items）と発話の文字起こしを送る。部屋の採点と同じチェックリストの採点で、内容（チェックリストの達成と正しさの F1）と表現（級の文法の一覧に照らした段階）を付け、内容の内訳と講評を返す。音声は受けず、話し方（発音）の点は付けない。",
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
          "layout（difficulty・id の重ならない checklist・1〜40 個の items）と transcript（1〜2000 文字）を送る。speech の点は 0〜100 の整数",
        ),
        400,
      );
    }
  }),
  async (c) => {
    const request = c.req.valid("json");
    // 同梱に無い部品（id@版）は、作った部品の置き場（R2）からメタデータを引く
    const versioned = [
      ...new Set(
        request.layout.items.map((i) => i.part).filter((p) => p.includes("@")),
      ),
    ];
    const extra = (
      await Promise.all(
        versioned.map((p) => {
          const ref = parsePartRef(p);
          return ref
            ? lookupPart(c.env, ref.id, ref.version).catch(() => null)
            : null;
        }),
      )
    ).filter((p) => p !== null);
    const result = await scoreLayout(c.env, request, extra);
    if (!result.ok) {
      return result.reason === "unknown_parts"
        ? c.json(errorBody("invalid_message", result.message), 400)
        : c.json(errorBody("scoring_failed", result.message), 502);
    }
    const { ok: _, ...body } = result;
    return c.json(body);
  },
);
