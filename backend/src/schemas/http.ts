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
  "x-transcript": z.string().max(8000).optional().meta({
    description:
      "端末で文字起こしした発話を URL エンコードしたもの（元の文で 2000 文字まで）。あれば発音評価の正解文と内容・表現の採点に使い、無ければ Azure の文字起こしを使う",
  }),
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

export const SceneLayoutQuery = z.object({
  // RoomId（ref 付き）に説明を足すと OpenAPI で RoomId が入力用と出力用に分かれるので、形だけ同じにする
  room: z
    .string()
    .regex(/^\d{4}$/)
    .optional()
    .meta({
      description:
        "部屋のコード（数字 4 桁）。部屋が AI で作った場面（作り置きに無い sceneId）は、その部屋に置いてあるので付けて取る。作り置きの場面には要らない",
      example: "0427",
    }),
});

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

// z.tuple は OpenAPI で prefixItems になり、iOS の swift-openapi-generator が読めない。
// 長さ 3 の配列として書き出し、型だけ 3 つの組に戻す
const Vector = z
  .array(z.number())
  .length(3)
  .transform((v) => v as [number, number, number]);

export const ScoringLayout = z
  .object({
    description: z.string().max(2000).optional().meta({
      description:
        "場面の説明文（英語）。作り置きのときに書いて人が確かめたもの。採点の補足として Claude に渡す",
    }),
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
      "配置の JSON（scenenglish.scene/1）のうち、採点に使う項目。ほかの項目（name・elements など）は送っても無視する。座標や動きの細かい項目（duration など）も読まない",
  });

const Score = z.int().min(0).max(100);

export const ScoreRequest = z
  .object({
    layout: ScoringLayout,
    transcript: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .meta({ description: "発話の文字起こし（英語）" }),
    speech: z
      .object({ accuracy: Score, fluency: Score, prosody: Score })
      .optional()
      .meta({
        description:
          "Azure の話し方の 3 つの点（正確さ・なめらかさ・抑揚）。送ると、次に伸ばす一つに話し方も選ばれる。話し方の点そのものは付けない",
      }),
  })
  .meta({ ref: "ScoreRequest" });

export const ScoreResponse = z
  .object({
    content: Score.meta({
      description: "内容（0〜100）。採点基準の段階で付ける",
    }),
    expression: Score.meta({
      description: "表現（0〜100）。採点基準の段階で付ける",
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
          kind: z.enum(["content", "expression", "speech"]).meta({
            description: "speech は話し方の点を送ったときだけ",
          }),
          text: z.string(),
        }),
        rewrite: Rewrite.nullable().meta({
          description: "直す所が無ければ null",
        }),
      })
      .meta({
        ref: "ContentFeedback",
        description: "講評。次に伸ばす一つは Claude が選ぶ",
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

// 部品と配置の JSON（docs/design/scene-protocol.md）

const Vec3 = z
  .array(z.number())
  .length(3)
  .meta({ description: "[x, y, z]（m）" });

export const PartMeta = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9_]{1,48}$/)
      .meta({ example: "apple_red" }),
    version: z.int().min(1),
    file: z.string().meta({
      description:
        "部品の USDZ のパス（parts/<id>/<version>.usdz。repo では assets/ の下）",
      example: "parts/apple_red/1.usdz",
    }),
    category: z.string().meta({
      description:
        "person・animal・plant・food・furniture・vehicle・building・ground・thing のどれか",
    }),
    words: z.array(
      z.object({ word: z.string(), pos: z.enum(["noun", "verb"]) }),
    ),
    pose: z.string().optional().meta({ description: "人物と動物のポーズ" }),
    size: Vec3.meta({ description: "外接する箱の [幅, 高さ, 奥行き]（m）" }),
    label: z.string().meta({ example: "リンゴ" }),
    anchors: z
      .object({
        top: z
          .number()
          .optional()
          .meta({ description: "上に物を置ける面の高さ（m）" }),
        seat: Vec3.optional().meta({ description: "座る点" }),
        hip: Vec3.optional().meta({
          description: "座るポーズの人の腰の点",
        }),
      })
      .optional()
      .meta({ description: "置き方の手がかりの点" }),
  })
  .meta({ ref: "PartMeta", description: "部品のメタデータ" });

export const ListPartsResponse = z
  .object({ parts: z.array(PartMeta) })
  .meta({ ref: "ListPartsResponse" });

export const SceneLayoutElement = z
  .object({
    id: z.string(),
    label: z.string(),
    points: z.int(),
    accept: z.string(),
    partial: z.string().optional(),
  })
  .meta({ ref: "SceneLayoutElement", description: "描写してほしい要素" });

export const SceneMotion = z
  .object({
    type: z.enum(["fall", "move", "rotate", "sway"]),
    to: Vec3.optional().meta({ description: "move の行き先" }),
    angle: z
      .number()
      .optional()
      .meta({ description: "sway の角度（度、既定 10）" }),
    duration: z.number().meta({ description: "秒" }),
    delay: z.number().optional().meta({ description: "秒（既定 0）" }),
    loop: z.boolean().optional().meta({ description: "既定 true" }),
  })
  .meta({
    ref: "SceneMotion",
    description: "簡単な動き。時刻は round の startAt から数える",
  });

export const SceneLayoutItem = z
  .object({
    key: z.string(),
    part: z.string().meta({
      description: "部品の ID。版を固定するときは apple_red@1",
      example: "apple_red",
    }),
    position: Vec3.meta({ description: "部品の原点（底面の中心）の位置（m）" }),
    yaw: z
      .number()
      .optional()
      .meta({ description: "Y 軸まわりの回転（度、既定 0）" }),
    scale: z.number().optional().meta({ description: "既定 1" }),
    motion: SceneMotion.optional(),
  })
  .meta({ ref: "SceneLayoutItem", description: "置く部品" });

export const SceneLayout = z
  .object({
    protocol: z.literal("scenenglish.scene/1"),
    id: z.string().meta({ example: "gen-7k2m9q4x3a" }),
    name: z.string().meta({ example: "リンゴが落ちる公園" }),
    difficulty: z.enum(["easy", "normal", "hard"]),
    description: z.string(),
    elements: z.array(SceneLayoutElement),
    extraMax: z.int(),
    items: z.array(SceneLayoutItem),
  })
  .meta({
    ref: "SceneLayout",
    description: "配置の JSON（scenenglish.scene/1）",
  });

export const GenerateSceneRequest = z
  .object({
    difficulty: z
      .enum(["easy", "normal", "hard"])
      .meta({ description: "難しさ" }),
    theme: z.string().trim().min(1).max(50).optional().meta({
      description:
        "場面のテーマ（1〜50 文字、任意）。省けば、指示の中のテーマの一覧（公園・カフェ・店・駅・部屋など）から Claude が選ぶ",
      example: "公園",
    }),
  })
  .meta({ ref: "GenerateSceneRequest" });
