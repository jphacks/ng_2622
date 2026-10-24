import { z } from "zod";
import {
  ErrorCode,
  MAX_PLAYERS,
  PlayerId,
  PlayerToken,
  RoomId,
  RoomPhase,
} from "./common";

export const CreateRoomResponse = z
  .object({
    roomId: RoomId,
    playerId: PlayerId,
    token: PlayerToken,
  })
  .meta({
    ref: "CreateRoomResponse",
    description:
      "作った部屋と、ホストとして入るための ID と合言葉。続けて WebSocket の join で送る",
  });

export const RoomSummary = z
  .object({
    roomId: RoomId,
    phase: RoomPhase,
    playerCount: z.int().min(0),
    maxPlayers: z.int().meta({ example: MAX_PLAYERS }),
  })
  .meta({
    ref: "RoomSummary",
    description: "部屋に入る前の確認用（あるか、満員でないか）",
  });

export const ErrorResponse = z
  .object({
    error: z.object({ code: ErrorCode, message: z.string() }),
  })
  .meta({ ref: "ErrorResponse" });

export const RoomIdParam = z.object({ roomId: RoomId });

export const AudioParams = z.object({
  roomId: RoomId,
  round: z
    .string()
    .regex(/^[1-9]\d*$/)
    .meta({ description: "ラウンドの番号（round の round）", example: "1" }),
});

export const AudioHeaders = z.object({
  "x-player-id": PlayerId,
  authorization: z
    .string()
    .regex(/^Bearer \S+$/)
    .meta({ description: "Bearer と合言葉（welcome の token）" }),
});

export const SubmitAudioResponse = z
  .object({ status: z.literal("grading") })
  .meta({
    ref: "SubmitAudioResponse",
    description:
      "受け取って採点を始めた。点数は返さず、全員の採点がそろったら WebSocket の results で届く",
  });
