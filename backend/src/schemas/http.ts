import { z } from "zod";
import {
  DISTANCES,
  LINKS,
  PATHS,
  RELATIONS,
  SIDES,
  TURNS,
  ZONES,
} from "../scenes/types";
import {
  ChecklistKind,
  Difficulty,
  ErrorCode,
  MAX_PLAYERS,
  PlayerId,
  PlayerName,
  PlayerToken,
  RoomId,
  RoomPhase,
  SceneId,
} from "./common";
import { FeedbackNextStep, PlayerContent, Rewrite } from "./ws";

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

// 採点の口（POST /score）の入力にも同じ形を使う。ref 付きの型を入力と出力の両方で使うと、
// OpenAPI で入力用と出力用（…Output）に分かれるので、入力の側は ref の無い形にする
const checklistItemShape = {
  id: z.string().meta({ description: "場面の中で重ならない ID" }),
  kind: ChecklistKind,
  label: z.string().meta({ description: "振り返りに出す日本語" }),
  accept: z.string().meta({
    description:
      '「言えた」とする英語の言い方。採点の Claude が基準にする。" / " で別の言い方を並べることがある',
  }),
  refs: z.array(z.string()).meta({ description: "項目が指す items の key" }),
};

export const SceneChecklistItem = z.object(checklistItemShape).meta({
  ref: "SceneChecklistItem",
  description: "採点のチェックリストの項目",
});

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
    toward: z.string().optional().meta({
      description:
        "生成で Claude が書いた行き先（相手の key か区画）。アプリは to を使えば足りる",
    }),
    path: z.enum(PATHS).optional(),
  })
  .meta({
    ref: "SceneMotion",
    description: "簡単な動き。時刻は round の startAt から数える",
  });

const placeShape = {
  relation: z.enum(RELATIONS),
  target: z.string().optional().meta({ description: "相手の key" }),
  target2: z.string().optional().meta({ description: "between の 2 つ目" }),
  zone: z.enum(ZONES).optional(),
  spot: z.string().optional(),
  link: z.enum(LINKS).optional(),
  side: z.enum(SIDES).optional(),
  distance: z.enum(DISTANCES).optional(),
  turn: z.enum(TURNS).optional(),
};

export const ScenePlace = z.object(placeShape).meta({
  ref: "ScenePlace",
  description:
    "生成で Claude が書いた置き方の関係。アプリは position を使えば足りる（採点と裏取りが読む）",
});

export const SceneLayoutItem = z
  .object({
    key: z.string(),
    part: z.string().meta({
      description: "部品の ID。版を固定するときは apple_red@1",
      example: "apple_red",
    }),
    place: ScenePlace,
    facing: z.string().optional().meta({
      description:
        "生成で Claude が書いた向き（camera・left・right・away か、向く相手の key）",
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
    protocol: z.literal("scenenglish.scene/2"),
    id: z.string().meta({ example: "gen-7k2m9q4x3a" }),
    name: z.string().meta({ example: "雨のバス停" }),
    difficulty: Difficulty,
    description: z.string().meta({
      description:
        "級の見本の答え（英語）。録音を待つ画面の正答例、振り返りの見本、採点の補足に使う",
    }),
    checklist: z.array(SceneChecklistItem),
    items: z.array(SceneLayoutItem),
  })
  .meta({
    ref: "SceneLayout",
    description: "配置の JSON（scenenglish.scene/2）",
  });

// 部屋を通さない採点の口（POST /score）

// z.tuple は OpenAPI で prefixItems になり、iOS の swift-openapi-generator が読めない。
// 長さ 3 の配列として書き出し、型だけ 3 つの組に戻す
const Vector = z
  .array(z.number())
  .length(3)
  .transform((v) => v as [number, number, number]);

export const ScoringLayout = z
  .object({
    difficulty: Difficulty,
    description: z.string().max(2000).optional().meta({
      description: "級の見本の答え（英語）。採点の補足として Claude に渡す",
    }),
    checklist: z.array(z.object(checklistItemShape)).min(1).max(20),
    items: z
      .array(
        z.object({
          key: z.string().min(1),
          part: z.string().min(1).meta({
            description:
              "部品の ID（assets/parts/index.json）。版を書くときは apple@1",
          }),
          place: z.object(placeShape).optional(),
          facing: z.string().optional(),
          position: Vector,
          yaw: z.number().optional(),
          scale: z.number().optional(),
          motion: z
            .object({
              type: z.enum(["fall", "move", "rotate", "sway"]),
              to: Vector.optional(),
              toward: z.string().optional(),
              path: z.enum(PATHS).optional(),
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
      "配置の JSON（scenenglish.scene/2）のうち、採点に使う項目。ほかの項目（id・name など）は送っても無視する。動きの細かい項目（duration など）も読まない",
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
      description:
        "内容（0〜100）。チェックリストの達成（言えた）と、言ったことの正しさの F1",
    }),
    expression: Score.meta({
      description: "表現（0〜100）。級の文法の一覧に照らした段階で付ける",
    }),
    transcript: z.string(),
    breakdown: PlayerContent,
    feedback: z
      .object({
        nextStep: FeedbackNextStep,
        rewrite: Rewrite.nullable().meta({
          description: "直す所が無ければ null",
        }),
      })
      .meta({
        ref: "ContentFeedback",
        description: "講評（話し方のコツは無い）",
      }),
    mode: z.enum(["live", "fixed"]).meta({
      description: "fixed は外部 API を呼ばない固定の点数（SCORING_MODE）",
    }),
    elapsedMs: z.int(),
  })
  .meta({
    ref: "ScoreResponse",
    description:
      "配置と文字起こしから採点した、内容と表現の点・内容の内訳・講評。nextStep.gain は、話し方の点を変えないとしたときの合計の伸び",
  });

export const GenerateSceneRequest = z
  .object({
    difficulty: Difficulty,
    theme: z.string().trim().min(1).max(50).optional().meta({
      description:
        "場面のテーマ（1〜50 文字、任意）。省けば、指示の中のテーマの一覧（公園・カフェ・店・駅・部屋など）から Claude が選ぶ",
      example: "公園",
    }),
  })
  .meta({ ref: "GenerateSceneRequest" });
