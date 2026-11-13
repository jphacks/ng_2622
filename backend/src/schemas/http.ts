import { z } from "zod";
import {
  DISTANCES,
  GRADE_IDS,
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

export const Title = z
  .object({
    id: z.string().meta({
      description:
        "広告の名前と 3D のファイルの sha256 の先頭 8 文字。アプリは覚えている id と違えば取り直す",
      example: "jphacks-2026-ecc5df64",
    }),
    caption: z.string().meta({
      description:
        "広告主の名前。アプリは、アプリに固定の「PR」の札（サーバーからは変えられない）の横に出す",
      example: "JPHACKS",
    }),
    model: z.string().meta({
      description:
        "3D（USDZ）の絶対 URL。Worker の静的アセットとして同じホストで配る",
      example: "https://example.workers.dev/title/hackathon.usdz?v=ecc5df64",
    }),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .meta({
        description:
          "3D のファイルの中身の sha256（16 進数の小文字）。合わなければアプリは捨てる",
      }),
    expiresAt: z.iso.datetime().meta({
      description:
        "出す期間の終わり（秒までの UTC）。過ぎたら、サーバーにつながらなくてもアプリは消して既定の場面に戻す",
      example: "2026-11-15T14:59:59Z",
    }),
  })
  .meta({
    ref: "Title",
    description: "タイトル画面（ホーム）に、既定の場面の代わりに出す 3D",
  });

export const TitleResponse = z
  .object({
    title: Title.nullable().meta({
      description:
        "今出すタイトル。出すものが無ければ null（アプリは覚えているものを消し、既定の場面を出す）",
    }),
  })
  .meta({ ref: "TitleResponse" });

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
    checklist: z
      .array(z.object(checklistItemShape))
      .min(1)
      .max(20)
      // Claude に渡す項目の id の enum に、同じ id が入らないようにする
      .refine((list) => new Set(list.map((c) => c.id)).size === list.length, {
        message: "checklist の id が重なっている",
      }),
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
        expressionBasis: z.string().nullable().meta({
          description:
            "表現の点の根拠（英語 1 文）。部屋の結果の Feedback.expressionBasis と同じ。根拠が無いとき（3 語未満、呼び直しても空、固定の点数のモード）は null",
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

// 苦手の分析の口（POST /weak-points）。設計は docs/design/weak-point-analysis.md の 3。
// 本文は端末の記録の文字だけ。録音・名前・端末や記録の ID・日時・場面の ID は受け取らない（知らない欄は捨てる）

/** 1 回の分析に送る回の数（内容の内訳のある記録の直近 10 件。4 件以下はアプリが呼ばない） */
export const WEAK_POINT_MIN_ROUNDS = 5;
export const WEAK_POINT_MAX_ROUNDS = 10;

const RoundNumber = z.int().min(1).max(WEAK_POINT_MAX_ROUNDS);

// null を許す欄は、欄が無くても null と同じに読む（iOS の生成器の型は nil の欄を書かずに送るため）
const WeakPointRound = z.object({
  n: RoundNumber.meta({
    description:
      "回の番号。古い順に 1 から振る（rounds の並びと同じ）。記録の ID は送らず、アプリが番号と記録の ID を対応させる",
  }),
  // Difficulty（ref 付き）を nullable にすると anyOf になり、iOS の生成器が読めないので、同じ値の enum を直に書く
  grade: z.enum(GRADE_IDS).nullish().meta({
    description:
      "級（記録の difficulty。eiken-3・eiken-pre2・eiken-2）。級は混ざってよい。分からなければ null（Claude には級は不明と渡す）",
  }),
  transcript: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .meta({ description: "文字起こし（1〜2000 文字）" }),
  claims: z
    .array(
      z.object({
        quote: z.string().max(2000),
        verdict: z.enum(["correct", "contradiction", "absent", "offtopic"]),
        item: z.string().max(100).nullish(),
        note: z.string().max(500).nullish(),
      }),
    )
    .max(30)
    .meta({
      description:
        "描写ごとの判定（記録の content.claims の quote・verdict・item・note）。0〜30 個",
    }),
  rewrite: z
    .object({
      before: z.string().max(2000),
      after: z.string().max(2000),
      reason: z.string().max(500),
    })
    .nullish()
    .meta({ description: "言い直しの例（記録の feedback.rewrite）" }),
  nextStep: z
    .object({
      kind: z.enum(["content", "expression", "speech"]),
      text: z.string().max(500),
      item: z.string().max(100).nullish(),
    })
    .nullish()
    .meta({
      description:
        "次の一つ（記録の feedback.nextStep の kind・text・item）。gain は送らない",
    }),
  expressionBasis: z.string().max(1000).nullish().meta({
    description:
      "表現の根拠（記録の feedback.expressionBasis）。欄の無い前の記録・3 語未満の回・固定の点数のモードは null",
  }),
  scene: z.object({
    description: z
      .string()
      .max(1000)
      .meta({ description: "場面の見本の答えの全文（1000 文字まで）" }),
    missedItems: z
      .array(
        z.object({
          id: z.string().max(100),
          kind: ChecklistKind,
          label: z.string().max(200),
          accept: z.string().max(500),
          level: z.enum(["none", "partial"]),
        }),
      )
      .max(12)
      .meta({
        description:
          "言えなかった（none）・一部だけ言えた（partial）チェックリストの項目。0〜12 個",
      }),
  }),
});

const Average = z.number().min(0).max(100);
const WeakPointHalf = z.object({
  rounds: z
    .int()
    .min(1)
    .max(WEAK_POINT_MAX_ROUNDS / 2)
    .meta({
      description: "その半分の回の数（⌊回の数 / 2⌋）",
    }),
  content: Average.meta({ description: "内容の点の平均" }),
  expression: Average.meta({ description: "表現の点の平均" }),
});

const Tally = z.int().min(0);

export const WeakPointRequest = z
  .object({
    rounds: z
      .array(WeakPointRound)
      .min(WEAK_POINT_MIN_ROUNDS)
      .max(WEAK_POINT_MAX_ROUNDS)
      // 引用の確かめで回を番号で引くので、番号は古い順に 1 から欠けずに振る
      .refine((rounds) => rounds.every((r, i) => r.n === i + 1), {
        message: "n は古い順に 1 から振る",
      })
      .meta({ description: "直近の回（5〜10 件）。古い順" }),
    counts: z
      .object({
        rounds: z
          .int()
          .min(WEAK_POINT_MIN_ROUNDS)
          .max(WEAK_POINT_MAX_ROUNDS)
          .meta({ description: "数えた回の数" }),
        kinds: z
          .array(
            z.object({
              kind: ChecklistKind,
              earned: z.number().min(0).meta({
                description:
                  "言えた項目の値の合計（full 1・partial 0.5・none 0。重みは掛けない）",
              }),
              total: z.int().min(1).meta({ description: "その種類の項目の数" }),
            }),
          )
          .max(4)
          .meta({
            description:
              "項目の種類ごとの言えた割合の分子と分母。total が 0 の種類は入れない",
          }),
        verdicts: z
          .object({
            correct: Tally,
            contradiction: Tally,
            absent: Tally,
            offtopic: Tally,
          })
          .meta({ description: "判定の種類ごとの描写の数" }),
        halves: z.object({ first: WeakPointHalf, second: WeakPointHalf }).meta({
          description:
            "点の前半と後半（古いほうと新しいほうの ⌊回の数 / 2⌋ 回。奇数なら真ん中の 1 回は使わない）",
        }),
      })
      .meta({
        description:
          "端末で数えた値（docs/design/weak-point-analysis.md の 4）。Claude には参考として渡し、文に数字を書かせない",
      }),
  })
  .meta({
    ref: "WeakPointRequest",
    description:
      "苦手の分析に送る、直近の記録の文字と端末で数えた値。録音・名前・端末や記録の ID・遊んだ日時・場面の ID は送らない。サーバーは保存しない",
  });

export const WeakPointViewpoint = z.enum(["content", "expression"]).meta({
  ref: "WeakPointViewpoint",
  description:
    "英検の二次試験の評価の観点。content: 内容（応答内容・情報量）・expression: 表現（語い・文法・語法）",
});

export const WeakPointQuote = z
  .object({
    n: RoundNumber.meta({ description: "回の番号（送った rounds の n）" }),
    quote: z.string().meta({
      description:
        "その回の文字起こし（transcript）に書かれているとおりの文字列。サーバーが確かめ、見つからない引用は返さない",
    }),
  })
  .meta({ ref: "WeakPointQuote", description: "自分の文の引用" });

export const WeakPointHabit = z
  .object({
    viewpoint: WeakPointViewpoint,
    title: z.string().meta({
      description: "短い見出し（日本語。例「理由をつけずに終わる」）",
    }),
    what: z
      .string()
      .meta({ description: "何が起きているか（日本語 1〜2 文）" }),
    examples: z.array(WeakPointQuote).min(2).max(3).meta({
      description:
        "自分の文の実例。2 つ以上の違う回にまたがる（2〜3 個。新しい回から、同じ回の中は話した順）",
    }),
    fix: z
      .string()
      .meta({ description: "直し方（日本語 1 文と、短い英語の例）" }),
  })
  .meta({ ref: "WeakPointHabit", description: "くり返す癖" });

export const WeakPointImprovement = z
  .object({
    viewpoint: WeakPointViewpoint,
    text: z.string().meta({ description: "良くなった点（日本語 1 文）" }),
    example: WeakPointQuote,
  })
  .meta({
    ref: "WeakPointImprovement",
    description:
      "前より良くなった点。example は根拠の引用で、後半の回（新しいほうの ⌊回の数 / 2⌋ 回）から引く",
  });

export const WeakPointNextTry = z
  .object({
    viewpoint: WeakPointViewpoint,
    text: z.string().meta({
      description: "次の 1 回で試すこと（日本語 1 文と、短い英語の例）",
    }),
  })
  .meta({
    ref: "WeakPointNextTry",
    description: "次の 1 回で試すこと。苦手の画面の「次はここ」に出す",
  });

export const WeakPointResponse = z
  .object({
    habits: z.array(WeakPointHabit).max(3).meta({
      description:
        "くり返す癖（内容と表現を合わせて 2〜3 件を頼む）。確かめを通ったものだけなので 0〜1 件のこともある。空なら「くり返す癖は見つかりませんでした」",
    }),
    improvement: WeakPointImprovement.nullable().meta({
      description:
        "前より良くなった点。良くなっていない・根拠の引用が後半の回に見つからないときは null（欄を出さない）",
    }),
    nextTry: WeakPointNextTry.nullable().meta({
      description:
        "次の 1 回で試すこと。確かめで落ちたら null（アプリが数える分析から「次はここ」の代わりを出す）",
    }),
    retries: z.int().min(0).max(1).meta({
      description: "確かめで癖が全部落ちて Claude を呼び直した回数（0〜1）",
    }),
  })
  .meta({
    ref: "WeakPointResponse",
    description:
      "確かめを通った苦手の分析。サーバーは保存しない。文に割合や点の数字は入らない（数字はアプリが数えた値を出す）",
  });

// 苦手の場面の口（POST /weak-scenes）。設計は docs/design/part-generation.md。
// 本文は級・苦手の種類・AI の分析の癖の題と直し方・次に試すことだけ。本人の英文の引用・名前・端末の ID は受け取らない（知らない欄は捨てる）

/** 苦手の場面の ID の形（"weak-" ＋ uuid）。部屋の start の sceneId にそのまま使う */
export const WEAK_SCENE_ID =
  /^weak-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 苦手の場面の名前と一言の長さの上限（文字）。Claude が長く書いたらサーバーが切る */
export const WEAK_SCENE_NAME_MAX = 30;
export const WEAK_SCENE_PITCH_MAX = 60;

/** 1 つの場面でその場で作る部品の数の上限（費用のヒューズ） */
export const WEAK_SCENE_MAX_NEW_PARTS = 4;

export const WeakSceneHabit = z
  .object({
    viewpoint: WeakPointViewpoint,
    title: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .meta({ description: "癖の見出し（分析の habits[].title）" }),
    fix: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .meta({ description: "直し方（分析の habits[].fix）" }),
  })
  .meta({
    ref: "WeakSceneHabit",
    description:
      "苦手の分析の癖のうち、題と直し方だけ。実例の引用（examples）と what は送らない",
  });

export const WeakSceneNextTry = z
  .object({
    viewpoint: WeakPointViewpoint,
    text: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .meta({ description: "次の 1 回で試すこと（分析の nextTry.text）" }),
  })
  .meta({ ref: "WeakSceneNextTry" });

export const WeakSceneRequest = z
  .object({
    // ref 付きの型に .meta で説明を足すと、元の型の説明が書き換わり、入力用と出力用にも分かれるので、説明は外に書く
    difficulty: Difficulty,
    kinds: z.array(ChecklistKind).min(1).max(4).meta({
      description:
        "項目の種類を、端末が数えた言えた割合の低い順に（分母 0 の種類は除く）。サーバーはその級に有る最初の種類を狙う（eiken-3 に reason・link、eiken-pre2 に link は無い）。どれも級に無ければ center にする。重なった種類は 1 つとみる",
    }),
    habits: z.array(WeakSceneHabit).max(3).optional().meta({
      description:
        "AI の分析の癖（0〜3 個）。表現の癖は使わせる文法に、内容の癖は描く物に効かせる",
    }),
    nextTry: WeakSceneNextTry.optional(),
  })
  .meta({
    ref: "WeakSceneRequest",
    description:
      "苦手の場面を作るのに送る、級と苦手。difficulty はその人の直近の記録の級（場面はこの級で作る）、nextTry は AI の分析の次に試すこと（任意）。本人の英文の引用・録音・名前・端末の ID は送らない。サーバーは本文を保存しない（作った場面だけを置く）",
  });

export const WeakSceneResponse = z
  .object({
    sceneId: z.string().regex(WEAK_SCENE_ID).meta({
      description:
        "作った場面の ID（weak- ＋ uuid）。部屋の start の sceneId に送ると、この場面でラウンドが始まる",
      example: "weak-0f8fad5b-d9cb-469f-a165-70867728950e",
    }),
    name: z
      .string()
      .max(WEAK_SCENE_NAME_MAX)
      .meta({
        description: `場面の名前（日本語、${WEAK_SCENE_NAME_MAX} 文字まで。layout.name と同じ）`,
        example: "雨の公園",
      }),
    difficulty: Difficulty,
    focus: ChecklistKind,
    pitch: z
      .string()
      .max(WEAK_SCENE_PITCH_MAX)
      .meta({
        description: `場面の一言（日本語、${WEAK_SCENE_PITCH_MAX} 文字まで。長ければサーバーが切る）`,
        example: "because で理由を言いやすい場面です",
      }),
    layout: SceneLayout,
    createdParts: z
      .array(z.string())
      .max(WEAK_SCENE_MAX_NEW_PARTS)
      .meta({
        description:
          "その場で作った部品の id@版（0〜4 個）。アプリに同梱していない部品で、GET /parts/{id}/{version}.usdz で取る",
        example: ["teapot_red@1"],
      }),
  })
  .meta({
    ref: "WeakSceneResponse",
    description:
      "作った苦手の場面。サーバーの置き場（R2）にも置いてあり、部屋が sceneId で読む。focus は実際に狙った項目の種類（kinds のうち、その級に有る最初の種類）。layout は配置の JSON（scenenglish.scene/2。部屋で遊ぶ場面と同じ形）で、その場で作った部品は part が id@版（小さな絵を出す・部品を先に取っておくのに使う）",
  });
