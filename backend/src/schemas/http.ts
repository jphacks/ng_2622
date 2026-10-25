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
import { Rewrite } from "./ws";

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

const Vector = z.tuple([z.number(), z.number(), z.number()]);

export const ScoringLayout = z
  .object({
    difficulty: z
      .enum(["easy", "normal", "hard"])
      .optional()
      .meta({ description: "難しさ。要素の数が変わる（省くと easy）" }),
    items: z
      .array(
        z.object({
          key: z.string().min(1),
          part: z.string().min(1).meta({
            description:
              "部品の ID（assets/parts/index.json）。版を書くときは apple@1",
          }),
          position: Vector,
          yaw: z.number().optional(),
          scale: z.number().optional(),
          motion: z
            .object({
              type: z.enum(["fall", "move", "rotate", "sway"]),
              to: Vector.optional(),
            })
            .optional(),
        }),
      )
      .min(1)
      .max(40),
  })
  .meta({
    ref: "ScoringLayout",
    description:
      "配置の JSON（scenenglish.scene/1）のうち、採点に使う項目。ほかの項目（name・description・elements など）は送っても無視する。座標や動きの細かい項目（duration など）も読まない",
  });

const SceneKey = z.string().trim().min(1).max(128).optional().meta({
  description:
    "同じ場面をまとめるキー（例: 部屋のコードとラウンドの番号）。同じキーの人は、最初に作った同じ基準で採点される。省くと配置の中身から決める",
});

export const ScoreRequest = z
  .object({
    layout: ScoringLayout,
    transcript: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .meta({ description: "発話の文字起こし（英語）" }),
    sceneKey: SceneKey,
  })
  .meta({ ref: "ScoreRequest" });

export const PrepareRubricRequest = z
  .object({ layout: ScoringLayout, sceneKey: SceneKey })
  .meta({ ref: "PrepareRubricRequest" });

const ScoredScene = z
  .object({
    name: z.string().meta({ description: "場面の名前（日本語）" }),
    description: z
      .string()
      .meta({ description: "配置から作った場面の説明（英語）" }),
  })
  .meta({ ref: "ScoredScene" });

export const PrepareRubricResponse = z
  .object({
    sceneKey: z.string(),
    created: z
      .boolean()
      .meta({ description: "この呼び出しで作ったか。false は覚えていたもの" }),
    scene: ScoredScene,
    elements: z.array(
      z
        .object({
          id: z.string(),
          label: z.string().meta({ description: "要素の名前（日本語）" }),
          points: z.int().meta({ description: "配点" }),
        })
        .meta({ ref: "RubricElement" }),
    ),
  })
  .meta({
    ref: "PrepareRubricResponse",
    description: "用意した採点の基準",
  });

export const ScoreResponse = z
  .object({
    sceneKey: z.string().meta({
      description:
        "採点の基準を覚えたキー。sceneKey を送ったら key:<sceneKey>、省いたら layout:<配置のハッシュ>",
    }),
    content: z.number().min(0).max(100).meta({
      description: "内容（0〜100）。部分点で 0.5 刻みになることがある",
    }),
    expression: z.int().min(0).max(100).meta({ description: "表現（0〜100）" }),
    scene: ScoredScene,
    elements: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string().meta({ description: "要素の名前（日本語）" }),
            points: z.int().meta({ description: "配点" }),
            level: z.enum(["full", "partial", "none"]),
            evidence: z
              .string()
              .meta({ description: "判定の根拠にした発言。none なら空" }),
          })
          .meta({ ref: "ScoredElement" }),
      )
      .meta({
        description:
          "配置から作った要素ごとの判定。配点の合計は 90 で、残りの 10 は一覧にない正しい描写に出す。発話が短すぎるときは判定せず、全部 none",
      }),
    transcript: z.string(),
    feedback: z
      .object({
        strength: z.object({
          quote: z.string().meta({
            description:
              "根拠にした本人の発話（文字起こしから引用）。無ければ空",
          }),
          text: z.string(),
        }),
        nextStep: z.object({
          kind: z.enum(["content", "expression"]),
          gain: z.int().nullable().meta({
            description: "足すと内容の点が何点伸びるか。内容の要素のときだけ",
          }),
          text: z.string(),
        }),
        rewrite: Rewrite.nullable().meta({
          description: "直す所が無ければ null",
        }),
      })
      .meta({
        ref: "ContentFeedback",
        description: "講評（話し方を除く）",
      }),
    mode: z.enum(["live", "fixed"]).meta({
      description: "fixed は外部 API を呼ばない固定の点数（SCORING_MODE）",
    }),
    elapsedMs: z.int(),
  })
  .meta({
    ref: "ScoreResponse",
    description: "配置と文字起こしから採点した、内容と表現の点と講評",
  });
