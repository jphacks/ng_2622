import { z } from "zod";
import {
  ErrorCode,
  MAX_PLAYERS,
  PlayerId,
  PlayerName,
  PlayerToken,
  RoomId,
  RoomPhase,
  SceneId,
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

export const Rating = z.int().min(1).max(5).meta({
  ref: "Rating",
  description: "★の数（1〜5）",
  example: 4,
});

export const RatingSummary = z
  .object({
    average: z.number().nullable().meta({
      description: "★の平均（小数第 1 位まで）。評価が無ければ null",
      example: 4.2,
    }),
    count: z.int().min(0).meta({ description: "評価した人数" }),
  })
  .meta({ ref: "RatingSummary" });

export const SceneSummary = z
  .object({
    id: SceneId,
    name: z.string().meta({ example: "公園" }),
    kind: z.enum(["vanilla"]).meta({
      description:
        "vanilla: 最初から入っているシーン（今後、ユーザーが作るシーンを足す）",
    }),
    rating: RatingSummary,
  })
  .meta({ ref: "SceneSummary" });

export const ListScenesResponse = z
  .object({ scenes: z.array(SceneSummary) })
  .meta({ ref: "ListScenesResponse" });

export const SceneIdParam = z.object({ sceneId: SceneId });

export const ListReviewsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20).meta({
    description: "何件返すか（1〜100、既定 20）",
  }),
});

export const SceneReview = z
  .object({
    name: PlayerName,
    rating: Rating,
    comment: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ ref: "SceneReview", description: "評価 1 件（新しい順に並ぶ）" });

export const ListReviewsResponse = z
  .object({ reviews: z.array(SceneReview) })
  .meta({ ref: "ListReviewsResponse" });

export const SubmitReviewRequest = z
  .object({
    reviewerId: z.uuid().meta({
      description:
        "評価した人の ID。端末ごとに 1 つ作って覚えておく。同じ ID で送り直すと上書きする",
    }),
    name: PlayerName,
    rating: Rating,
    comment: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .meta({ description: "コメント（200 文字まで。空なら無し）" }),
  })
  .meta({ ref: "SubmitReviewRequest" });

export const SubmitReviewResponse = z
  .object({
    average: z.number().meta({ example: 4.2 }),
    count: z.int().min(1),
  })
  .meta({
    ref: "SubmitReviewResponse",
    description: "保存したあとの、そのシーンの★の平均と人数",
  });

export const SubmitAudioResponse = z
  .object({ status: z.literal("grading") })
  .meta({
    ref: "SubmitAudioResponse",
    description:
      "受け取って採点を始めた。点数は返さず、全員の採点がそろったら WebSocket の results で届く",
  });
