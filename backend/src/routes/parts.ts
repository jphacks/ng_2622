import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { PARTS } from "../scenes/parts";
import { ListPartsResponse } from "../schemas/http";
import { type AppEnv, jsonContent } from "./shared";

export const partRoutes = new Hono<AppEnv>().get(
  "/parts",
  describeRoute({
    operationId: "listParts",
    tags: ["parts"],
    summary: "部品のメタデータの一覧",
    description:
      "置ける部品と、その大きさ・置き方の点（anchors）。今は Worker に同梱した一覧（src/scenes/parts.json）を返す。",
    responses: {
      200: { description: "一覧", content: jsonContent(ListPartsResponse) },
    },
  }),
  (c) => c.json({ parts: PARTS }),
);
