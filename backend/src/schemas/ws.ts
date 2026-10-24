import { z } from "zod";
import {
  ErrorCode,
  MAX_PLAYERS,
  Player,
  PlayerColor,
  PlayerId,
  PlayerName,
  PlayerStatus,
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
    color: PlayerColor.optional().meta({
      description: "省くと部屋の側で空いている色を選ぶ",
    }),
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

export const CloseMessage = z.object({ type: z.literal("close") }).meta({
  ref: "CloseMessage",
  description:
    "ホストだけが送れる。ラウンドを締め切って結果発表に進む。採点がまだの人は「採点できませんでした」になる",
});

export const AgainMessage = z.object({ type: z.literal("again") }).meta({
  ref: "AgainMessage",
  description:
    "ホストだけが送れる。結果発表から同じ顔ぶれで待合に戻る（phase が lobby の room が全員に届く）",
});

export const SkipMessage = z
  .object({
    type: z.literal("skip"),
    round: z.int().min(1).meta({ description: "round の round" }),
  })
  .meta({
    ref: "SkipMessage",
    description:
      "音声を送らずにこのラウンドを終える（マイクが使えない・録れなかったとき）。その人は done になり、結果では「採点できませんでした」（rank・score が null）になる。音声を送った後は already_submitted",
  });

export const LeaveMessage = z.object({ type: z.literal("leave") }).meta({
  ref: "LeaveMessage",
  description:
    "部屋から抜ける。席が空き、以後は同じ合言葉でも戻れない。ホストが抜けたら、次に入った人がホストになる。部屋が接続を閉じる",
});

export const ClientMessage = z
  .discriminatedUnion("type", [
    JoinMessage,
    StartMessage,
    CloseMessage,
    AgainMessage,
    SkipMessage,
    LeaveMessage,
  ])
  .meta({
    ref: "ClientMessage",
    discriminator: {
      propertyName: "type",
      mapping: {
        join: "#/components/schemas/JoinMessage",
        start: "#/components/schemas/StartMessage",
        close: "#/components/schemas/CloseMessage",
        again: "#/components/schemas/AgainMessage",
        skip: "#/components/schemas/SkipMessage",
        leave: "#/components/schemas/LeaveMessage",
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

export const ProgressMessage = z
  .object({
    type: z.literal("progress"),
    round: z.int().min(1),
    players: z.array(z.object({ id: PlayerId, status: PlayerStatus })),
  })
  .meta({
    ref: "ProgressMessage",
    description:
      "ラウンド中の各自の状態。変わるたびに全員へ送る。名前と色は room に載っている。点数は伏せる",
  });

const Points = z.int().min(0).max(100);

export const PlayerScore = z
  .object({
    content: Points,
    expression: Points,
    speech: Points.meta({ description: "話し方" }),
    total: Points.meta({ description: "重み付きの合計。順位はこれで決める" }),
  })
  .meta({ ref: "PlayerScore", description: "点数（各 0〜100 の整数）" });

export const PlayerResult = z
  .object({
    id: PlayerId,
    name: PlayerName,
    color: PlayerColor,
    rank: z
      .int()
      .min(1)
      .nullable()
      .meta({ description: "順位。同点は同じ順位。採点できなかった人は null" }),
    score: PlayerScore.nullable().meta({
      description: "採点できなかった人（締め切られた・失敗した）は null",
    }),
    transcript: z
      .string()
      .meta({ description: "文字起こし。採点できなかった人は空" }),
    comment: z
      .string()
      .meta({ description: "講評の一言。採点できなかった人は空" }),
    modelAnswer: z
      .string()
      .meta({ description: "模範表現（英文）。採点できなかった人は空" }),
  })
  .meta({ ref: "PlayerResult" });

export const ResultsMessage = z
  .object({
    type: z.literal("results"),
    round: z.int().min(1),
    sceneId: SceneId,
    sceneName: z.string().meta({ example: "公園" }),
    players: z.array(PlayerResult).meta({
      description:
        "順位の順（1 位が先頭）。採点できなかった人は最後。全員分の内訳を載せるので、自分の分は playerId で選ぶ",
    }),
  })
  .meta({
    ref: "ResultsMessage",
    description:
      "全員の採点がそろうか、ホストが締め切ったら全員へ送る。結果発表のときに戻ってきた人にも送り直す",
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
    ProgressMessage,
    ResultsMessage,
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
        progress: "#/components/schemas/ProgressMessage",
        results: "#/components/schemas/ResultsMessage",
        error: "#/components/schemas/ErrorMessage",
      },
    },
  });

export type ClientMessage = z.infer<typeof ClientMessage>;
export type ServerMessage = z.infer<typeof ServerMessage>;
