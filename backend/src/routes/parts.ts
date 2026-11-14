import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isObjectId } from "../parts/ids";
import { partMetaKey, partUsdzKey, USDZ_CONTENT_TYPE } from "../parts/store";
import { PARTS } from "../scenes/parts";
import { ListPartsResponse } from "../schemas/http";
import { type AppEnv, jsonContent } from "./shared";

export const partRoutes = new Hono<AppEnv>()
  .get(
    "/parts",
    describeRoute({
      operationId: "listParts",
      tags: ["parts"],
      summary: "部品のメタデータの一覧",
      description:
        "置ける部品と、その大きさ・置き方の点（anchors）。今は Worker に同梱した一覧（src/scenes/parts.json）を返す。その場で作った部品は入らない（配置の JSON に id@版 で出てくる）。",
      responses: {
        200: { description: "一覧", content: jsonContent(ListPartsResponse) },
      },
    }),
    (c) => c.json({ parts: PARTS }),
  )
  .get(
    // 版の後ろの .usdz までを 1 つの値で受ける（:version{...}.usdz の形は Hono で書けない）
    "/parts/:id/:version{[1-9][0-9]{0,5}\\.usdz}",
    describeRoute({
      operationId: "getMadePartUsdz",
      tags: ["parts"],
      summary: "その場で作った部品の USDZ",
      description:
        "その場で作った部品（配置の JSON の part が id@版 のもの）の 3D モデルを R2 から返す。メタデータの file（parts/<id>/<version>.usdz）をこのサーバーの URL に足して取る。同梱の部品はアプリが持っているので、ここでは返さない。一度置いた版は変わらないので、ずっとキャッシュしてよい。",
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^[a-z]+(?:_[a-z]+){0,2}$" },
          description: "部品の ID（物の ID の規約の形）",
          example: "umbrella_stand",
        },
        {
          name: "version",
          in: "path",
          required: true,
          schema: { type: "integer", minimum: 1 },
          description: "版の番号",
          example: 1,
        },
      ],
      responses: {
        200: {
          description:
            "部品の USDZ（cache-control: public, max-age=31536000, immutable）",
          content: {
            [USDZ_CONTENT_TYPE]: {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        404: {
          description:
            "その版の部品が無い（作っている途中で、メタデータがまだ無い版も 404）",
        },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      const version = Number(c.req.param("version").replace(/\.usdz$/, ""));
      if (!isObjectId(id)) return c.body(null, 404);
      // メタデータ（json）の無い版は、作っている途中か置きそこねた物なので返さない（immutable で配らない）
      const meta = await c.env.BUCKET.head(partMetaKey(id, version));
      if (!meta) return c.body(null, 404);
      const object = await c.env.BUCKET.get(partUsdzKey(id, version));
      if (!object) return c.body(null, 404);
      return c.body(object.body, 200, {
        "content-type": USDZ_CONTENT_TYPE,
        "content-length": String(object.size),
        "cache-control": "public, max-age=31536000, immutable",
        etag: object.httpEtag,
      });
    },
  );
