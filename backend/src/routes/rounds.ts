import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { createRoomRepository } from "../repositories/roomRepository";
import {
  AudioHeaders,
  AudioParams,
  ErrorResponse,
  SubmitAudioResponse,
} from "../schemas/http";
import { MAX_AUDIO_BYTES, submitAudio } from "../usecases/submitAudio";
import { type AppEnv, errorBody, jsonContent } from "./shared";

const errorStatus = {
  invalid_audio: 400,
  unauthorized: 401,
  room_not_found: 404,
  not_playing: 409,
  already_submitted: 409,
} as const;

const errorResponse = (description: string) => ({
  description,
  content: jsonContent(ErrorResponse),
});

export const roundRoutes = new Hono<AppEnv>().post(
  "/rooms/:roomId/rounds/:round/audio",
  describeRoute({
    operationId: "submitAudio",
    tags: ["rounds"],
    summary: "自分の音声を送る",
    description:
      "話し終えたら、録音した WAV（16 kHz・16 bit・モノラル、1 MB まで）を本文にそのまま載せて送る。1 ラウンドに 1 回だけ。受け取ったらすぐ 202 を返し、採点は部屋の側で続ける。進み具合は WebSocket の progress、点数は全員の採点がそろったら results で届く。",
    requestBody: {
      required: true,
      content: {
        "audio/wav": { schema: { type: "string", format: "binary" } },
      },
    },
    responses: {
      202: {
        description: "受け取って採点を始めた",
        content: jsonContent(SubmitAudioResponse),
      },
      400: errorResponse(
        "コード・番号・ヘッダーの形が違う（invalid_message）、または音声が WAV でない（invalid_audio）",
      ),
      401: errorResponse("参加者の ID と合言葉が合わない（unauthorized）"),
      404: errorResponse("部屋が無い（room_not_found）"),
      409: errorResponse(
        "ラウンド中でない・番号が違う・参加していない（not_playing）、またはもう送った（already_submitted）",
      ),
      413: errorResponse("1 MB を超えている（invalid_audio）"),
    },
  }),
  validator("param", AudioParams, (result, c) => {
    if (!result.success) {
      return c.json(
        errorBody(
          "invalid_message",
          "部屋のコードは数字 4 桁、ラウンドの番号は 1 以上",
        ),
        400,
      );
    }
  }),
  validator("header", AudioHeaders, (result, c) => {
    if (!result.success) {
      return c.json(
        errorBody(
          "invalid_message",
          "X-Player-Id と Authorization: Bearer <合言葉> を付ける",
        ),
        400,
      );
    }
  }),
  async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > MAX_AUDIO_BYTES) {
      return c.json(errorBody("invalid_audio", "1 MB までにする"), 413);
    }
    const { roomId, round } = c.req.valid("param");
    const headers = c.req.valid("header");
    const result = await submitAudio(
      createRoomRepository(c.env.ROOM),
      c.env,
      (promise) => c.executionCtx.waitUntil(promise),
      {
        roomId,
        round: Number(round),
        playerId: headers["x-player-id"],
        token: headers.authorization.slice("Bearer ".length),
        audio: await c.req.arrayBuffer(),
      },
    );
    if (!result.ok) {
      const status =
        errorStatus[result.error.code as keyof typeof errorStatus] ?? 400;
      return c.json({ error: result.error }, status);
    }
    return c.json({ status: "grading" as const }, 202);
  },
);
