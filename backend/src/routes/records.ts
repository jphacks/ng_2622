import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { createPlayRecordRepository } from "../repositories/playRecordRepository";
import {
  ErrorResponse,
  ListRecordsQuery,
  ListRecordsResponse,
} from "../schemas/http";
import { type AppEnv, errorBody, hasBearerToken, jsonContent } from "./shared";

// 利用実験の記録を、チームが集計するために取る口（scripts/records/summary.py が呼ぶ）。アプリは呼ばない
export const recordRoutes = new Hono<AppEnv>().get(
  "/records",
  describeRoute({
    operationId: "listRecords",
    tags: ["records"],
    summary: "利用実験の記録を取る（チームの集計用）",
    description:
      "1 人 1 ラウンドの記録を古い順に返す。音声を送るときに X-Device-Id を付けた人の、採点できたラウンドだけが残る。180 日を過ぎた行は消える。合言葉（Authorization: Bearer <RECORDS_TOKEN>）が要り、RECORDS_TOKEN が設定されていなければ誰も読めない。",
    security: [{ recordsToken: [] }],
    responses: {
      200: { description: "記録", content: jsonContent(ListRecordsResponse) },
      400: {
        description: "after・limit の形が違う（invalid_message）",
        content: jsonContent(ErrorResponse),
      },
      401: {
        description: "合言葉が違う・設定されていない（unauthorized）",
        content: jsonContent(ErrorResponse),
      },
    },
  }),
  async (c, next) => {
    if (!hasBearerToken(c.req.header("authorization"), c.env.RECORDS_TOKEN)) {
      return c.json(errorBody("unauthorized", "合言葉が違う"), 401);
    }
    await next();
  },
  validator("query", ListRecordsQuery, (result, c) => {
    if (!result.success) {
      return c.json(
        errorBody("invalid_message", "after は 0 以上、limit は 1〜1000"),
        400,
      );
    }
  }),
  async (c) => {
    const { after, limit } = c.req.valid("query");
    const repository = createPlayRecordRepository(c.env.PLAY_RECORDS);
    const records = await repository.list(after, limit);
    const next = records.length === limit ? (records.at(-1)?.id ?? null) : null;
    return c.json({ records, next });
  },
);
