import { z } from "zod";

// HTTP と WebSocket の両方で使う型。`.meta({ ref })` を付けたものは OpenAPI の components.schemas に名前付きで出る

/** 1 部屋に入れる人数の上限 */
export const MAX_PLAYERS = 5;

export const RoomId = z
  .string()
  .regex(/^\d{4}$/)
  .meta({
    ref: "RoomId",
    description: "部屋のコード（数字 4 桁）",
    example: "0427",
  });

export const PlayerId = z
  .uuid()
  .meta({ ref: "PlayerId", description: "部屋の中での参加者の ID" });

export const PlayerToken = z.string().min(1).meta({
  ref: "PlayerToken",
  description:
    "参加者ごとの合言葉。切断からの復帰とホストの確認に使う。他の人に見せない",
});

export const PlayerName = z.string().trim().min(1).max(20).meta({
  ref: "PlayerName",
  description: "表示名（1〜20 文字）",
  example: "はなこ",
});

export const SceneId = z.string().min(1).meta({
  ref: "SceneId",
  description: "シーンの ID（シーンの JSON の id）",
  example: "park",
});

export const RoomPhase = z
  .enum(["lobby", "playing", "waiting", "results"])
  .meta({
    ref: "RoomPhase",
    description:
      "部屋の進み具合。lobby: 待合、playing: 回転と録音、waiting: 採点待ち、results: 結果発表",
  });

export const ErrorCode = z
  .enum([
    "room_not_found",
    "room_full",
    "invalid_message",
    "unauthorized",
    "not_host",
    "not_in_lobby",
    "unknown_scene",
  ])
  .meta({
    ref: "ErrorCode",
    description: [
      "room_not_found: 部屋が無い",
      "room_full: 満員",
      "invalid_message: メッセージの形が違う",
      "unauthorized: 参加者の ID と合言葉が合わない",
      "not_host: ホストだけができる操作",
      "not_in_lobby: 待合でしかできない操作",
      "unknown_scene: シーンの ID が無い",
    ].join("\n"),
  });

export const Player = z
  .object({
    id: PlayerId,
    name: PlayerName,
    isHost: z.boolean(),
    connected: z
      .boolean()
      .meta({ description: "false のときは切断中（復帰を待っている）" }),
  })
  .meta({ ref: "Player" });
