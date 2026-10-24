import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import {
  describeRoute,
  openAPIRouteHandler,
  resolver,
  validator,
} from "hono-openapi";
import { openAPIOptions } from "./openapi";
import {
  CreateRoomResponse,
  ErrorResponse,
  RoomIdParam,
  RoomSummary,
} from "./schemas/http";
import { type ScoringEnv, score } from "./scoring";

// ルートの定義。Worker の入口（index.ts）と OpenAPI の生成スクリプトの両方から読むので、
// Cloudflare の実行環境にしか無いもの（cloudflare:workers など）はここで import しない

type Env = ScoringEnv & {
  // "true" のときだけ /dev/* を開く。手元の .dev.vars にだけ書き、デプロイ先には入れない
  ENABLE_DEV_ROUTES?: string;
};

const app = new Hono<{ Bindings: Env }>();

const json = (schema: Parameters<typeof resolver>[0]) => ({
  "application/json": { schema: resolver(schema) },
});

// 部屋のコードの形が違うときは、ほかのエラーと同じ ErrorResponse の形で 400 を返す
const roomIdParam = validator("param", RoomIdParam, (result, c) => {
  if (!result.success) {
    return c.json(
      {
        error: { code: "invalid_message", message: "部屋のコードは数字 4 桁" },
      },
      400,
    );
  }
});
const invalidRoomId = {
  description: "部屋のコードの形が違う（invalid_message）",
  content: json(ErrorResponse),
};

// 動いているかの確認用（デプロイ後の疎通確認にも使う）
app.get(
  "/health",
  describeRoute({
    operationId: "getHealth",
    tags: ["system"],
    summary: "動いているかの確認",
    responses: {
      200: {
        description: "ok",
        content: { "text/plain": { schema: { type: "string" } } },
      },
    },
  }),
  (c) => c.text("ok"),
);

// 部屋なしで採点だけを試す。multipart で audio（WAV）と sceneId を送る。OpenAPI には載せない
app.post("/dev/score", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "true") return c.notFound();
  const form = await c.req.formData();
  const audio = form.get("audio");
  const sceneId = form.get("sceneId");
  if (!(audio instanceof File) || typeof sceneId !== "string") {
    return c.json({ error: "audio（ファイル）と sceneId が要る" }, 400);
  }
  return c.json(await score(c.env, await audio.arrayBuffer(), sceneId));
});

app.post(
  "/rooms",
  describeRoute({
    operationId: "createRoom",
    tags: ["rooms"],
    summary: "部屋を作る",
    description:
      "部屋を作り、部屋のコードと、ホストとして入るための ID と合言葉を返す。",
    responses: {
      201: { description: "作った", content: json(CreateRoomResponse) },
    },
  }),
  (c) => c.text("not implemented", 501),
);

app.get(
  "/rooms/:roomId",
  describeRoute({
    operationId: "getRoom",
    tags: ["rooms"],
    summary: "部屋があるかを確かめる",
    description:
      "部屋に入る画面で、コードが合っているか、満員でないかを確かめる。",
    responses: {
      200: { description: "ある", content: json(RoomSummary) },
      400: invalidRoomId,
      404: {
        description: "部屋が無い（room_not_found）",
        content: json(ErrorResponse),
      },
    },
  }),
  roomIdParam,
  (c) => c.text("not implemented", 501),
);

app.get(
  "/rooms/:roomId/ws",
  describeRoute({
    operationId: "connectRoom",
    tags: ["rooms"],
    summary: "WebSocket で部屋に入る",
    description:
      "WebSocket に切り替える。つないだら最初に JoinMessage を送る。以後のメッセージの型は components.schemas の ClientMessage と ServerMessage。",
    responses: {
      101: { description: "WebSocket に切り替えた" },
      400: invalidRoomId,
      404: {
        description: "部屋が無い（room_not_found）",
        content: json(ErrorResponse),
      },
      426: { description: "WebSocket の接続ではない" },
    },
  }),
  roomIdParam,
  (c) => c.text("not implemented", 501),
);

app.get("/openapi.json", openAPIRouteHandler(app, openAPIOptions));
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

export default app;
