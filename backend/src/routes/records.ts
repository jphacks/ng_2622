import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { createPlayRecordRepository } from "../repositories/playRecordRepository";
import {
  ErrorResponse,
  ListMyRecordsResponse,
  MyRecordsHeaders,
} from "../schemas/http";
import { type AppEnv, errorBody, jsonContent } from "./shared";

// 本人のきろく。端末の ID で、その端末の記録だけを返す（ほかの人の記録は、その人の ID を知らなければ取れない）
export const recordRoutes = new Hono<AppEnv>().get(
  "/records/mine",
  describeRoute({
    operationId: "listMyRecords",
    tags: ["records"],
    summary: "自分のきろく",
    description:
      "X-Device-Id の端末で遊んで採点できたラウンドを、新しい順に返す。きろくの画面（点数と語数の推移・過去の振り返り）に使う",
    responses: {
      200: {
        description: "きろく",
        content: jsonContent(ListMyRecordsResponse),
      },
      400: {
        description: "X-Device-Id が無い・形が違う（invalid_message）",
        content: jsonContent(ErrorResponse),
      },
    },
  }),
  validator("header", MyRecordsHeaders, (result, c) => {
    if (!result.success) {
      return c.json(
        errorBody("invalid_message", "X-Device-Id に端末の ID（UUID）を付ける"),
        400,
      );
    }
  }),
  async (c) => {
    const deviceId = c.req.valid("header")["x-device-id"];
    const records = await createPlayRecordRepository(
      c.env.PLAY_RECORDS,
    ).listByDevice(deviceId);
    return c.json({ records }, 200);
  },
);
