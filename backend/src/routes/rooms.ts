import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { createRoomRepository } from "../repositories/roomRepository";
import {
  CreateRoomResponse,
  ErrorResponse,
  RoomIdParam,
  RoomSummary,
} from "../schemas/http";
import { connectRoom } from "../usecases/connectRoom";
import { createRoom } from "../usecases/createRoom";
import { getRoom } from "../usecases/getRoom";
import { type AppEnv, errorBody, jsonContent } from "./shared";

const roomIdParam = validator("param", RoomIdParam, (result, c) => {
  if (!result.success) {
    return c.json(errorBody("invalid_message", "部屋のコードは数字 4 桁"), 400);
  }
});

const invalidRoomId = {
  description: "部屋のコードの形が違う（invalid_message）",
  content: jsonContent(ErrorResponse),
};
const roomNotFound = {
  description: "部屋が無い（room_not_found）",
  content: jsonContent(ErrorResponse),
};

export const roomRoutes = new Hono<AppEnv>()
  .post(
    "/rooms",
    describeRoute({
      operationId: "createRoom",
      tags: ["rooms"],
      summary: "部屋を作る",
      description:
        "部屋を作り、部屋のコードと、ホストとして入るための ID と合言葉を返す。",
      responses: {
        201: {
          description: "作った",
          content: jsonContent(CreateRoomResponse),
        },
        503: {
          description: "空いている部屋のコードが無い（server_busy）",
          content: jsonContent(ErrorResponse),
        },
      },
    }),
    async (c) => {
      const room = await createRoom(createRoomRepository(c.env.ROOM));
      if (!room) {
        return c.json(
          errorBody(
            "server_busy",
            "空いている部屋のコードが無い。時間をおいて作り直す",
          ),
          503,
        );
      }
      return c.json(room, 201);
    },
  )
  .get(
    "/rooms/:roomId",
    describeRoute({
      operationId: "getRoom",
      tags: ["rooms"],
      summary: "部屋があるかを確かめる",
      description:
        "部屋に入る画面で、コードが合っているか、満員でないかを確かめる。",
      responses: {
        200: { description: "ある", content: jsonContent(RoomSummary) },
        400: invalidRoomId,
        404: roomNotFound,
      },
    }),
    roomIdParam,
    async (c) => {
      const { roomId } = c.req.valid("param");
      const summary = await getRoom(createRoomRepository(c.env.ROOM), roomId);
      if (!summary) {
        return c.json(errorBody("room_not_found", "部屋が無い"), 404);
      }
      return c.json(summary);
    },
  )
  .get(
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
        404: roomNotFound,
        426: {
          description: "WebSocket の接続ではない（invalid_message）",
          content: jsonContent(ErrorResponse),
        },
      },
    }),
    roomIdParam,
    async (c) => {
      if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
        return c.json(
          errorBody("invalid_message", "WebSocket で接続する"),
          426,
        );
      }
      const { roomId } = c.req.valid("param");
      return connectRoom(createRoomRepository(c.env.ROOM), roomId, c.req.raw);
    },
  );
