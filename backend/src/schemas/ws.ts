import { z } from "zod";
import {
  ErrorCode,
  MAX_PLAYERS,
  Player,
  PlayerId,
  PlayerName,
  PlayerToken,
  RoomId,
  RoomPhase,
  SceneId,
} from "./common";

// WebSocket（GET /rooms/{roomId}/ws）で流れるメッセージ。どれも JSON のテキストで、`type` で種類を見分ける

// iPhone → 部屋

export const JoinMessage = z
  .object({
    type: z.literal("join"),
    name: PlayerName,
    playerId: PlayerId.optional(),
    token: PlayerToken.optional(),
  })
  .meta({
    ref: "JoinMessage",
    description:
      "接続したら最初に送る。ホストは POST /rooms で受け取った playerId と token を、切断から戻る人は welcome で受け取ったものを付ける。初めて入る人は name だけ",
  });

export const StartMessage = z
  .object({
    type: z.literal("start"),
    sceneId: SceneId.optional().meta({
      description: "省くと「おまかせ」（部屋の側でランダムに選ぶ）",
    }),
  })
  .meta({
    ref: "StartMessage",
    description: "ホストだけが送れる。待合のときだけ有効",
  });

export const ClientMessage = z
  .discriminatedUnion("type", [JoinMessage, StartMessage])
  .meta({
    ref: "ClientMessage",
    discriminator: {
      propertyName: "type",
      mapping: {
        join: "#/components/schemas/JoinMessage",
        start: "#/components/schemas/StartMessage",
      },
    },
  });

// 部屋 → iPhone

export const WelcomeMessage = z
  .object({
    type: z.literal("welcome"),
    playerId: PlayerId,
    token: PlayerToken,
    isHost: z.boolean(),
  })
  .meta({
    ref: "WelcomeMessage",
    description:
      "join を受け付けたら本人にだけ送る。playerId と token は端末に保存し、切断から戻るときの join に付ける",
  });

export const RoomMessage = z
  .object({
    type: z.literal("room"),
    roomId: RoomId,
    phase: RoomPhase,
    hostId: PlayerId,
    maxPlayers: z.int().meta({ example: MAX_PLAYERS }),
    players: z.array(Player),
  })
  .meta({
    ref: "RoomMessage",
    description: "部屋の様子。参加者や状態が変わるたびに全員へ送る",
  });

export const RoundMessage = z
  .object({
    type: z.literal("round"),
    round: z.int().min(1).meta({ description: "この部屋で何回目のラウンドか" }),
    sceneId: SceneId,
    startAt: z.int().meta({
      format: "int64",
      description:
        "回転を始める時刻（UNIX 時刻のミリ秒）。全員がこの時刻にそろって始める",
      example: 1792800000000,
    }),
  })
  .meta({
    ref: "RoundMessage",
    description: "ホストがスタートしたら全員へ送る",
  });

export const ErrorMessage = z
  .object({
    type: z.literal("error"),
    code: ErrorCode,
    message: z.string(),
  })
  .meta({
    ref: "ErrorMessage",
    description: "受け付けられなかった操作を、送った本人にだけ返す",
  });

export const ServerMessage = z
  .discriminatedUnion("type", [
    WelcomeMessage,
    RoomMessage,
    RoundMessage,
    ErrorMessage,
  ])
  .meta({
    ref: "ServerMessage",
    discriminator: {
      propertyName: "type",
      mapping: {
        welcome: "#/components/schemas/WelcomeMessage",
        room: "#/components/schemas/RoomMessage",
        round: "#/components/schemas/RoundMessage",
        error: "#/components/schemas/ErrorMessage",
      },
    },
  });

export type ClientMessage = z.infer<typeof ClientMessage>;
export type ServerMessage = z.infer<typeof ServerMessage>;
