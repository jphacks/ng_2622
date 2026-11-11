import { z } from "zod";
import {
  ChecklistKind,
  Difficulty,
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
      description:
        "作り置きの場面の ID を指定して始める（手元で試すとき用）。sceneId も difficulty も省くと「おまかせ」で、部屋が全部の級の作り置きの場面からランダムに選ぶ。difficulty と一緒には送れない",
    }),
    difficulty: Difficulty.optional().meta({
      description:
        "この難易度の場面を部屋に用意させる。部屋が AI で作れるとき（生成が on で、その部屋で作らせた回数が 20 回未満）は、まず phase が generating の room が全員に届き、部屋が AI で場面を作る（10 秒まで）。作れなかったとき・作れないときは、作り置きの場面のうちその部屋でまだ出ていないものからランダムに 1 つ選ぶ（全部出たら最初に戻る）。どちらの場合も sceneId は round で届く。AI で作った場面の配置は GET /scenes/{sceneId}/layout?room=<部屋のコード> で取る。sceneId と一緒に送ると invalid_message",
    }),
  })
  .meta({
    ref: "StartMessage",
    description:
      "ホストだけが送れる。待合のときだけ有効（generating の間に送ると not_in_lobby）。ラウンドが始まったときにつながっている人がラウンドの参加者になる（切断中の人は入らない）。generating の間にホストが leave すると、生成をやめて作り置きの場面でラウンドを始める",
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
    description:
      "部屋の様子。参加者や状態が変わるたびに全員へ送る。ホストが抜けるか、切断したまま 30 秒戻らなければ、hostId はつながっている人のうち先に入った人に替わる",
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

export const Rewrite = z
  .object({
    before: z
      .string()
      .meta({ description: "本人の発話（文字起こしから引用）" }),
    after: z.string().meta({ description: "自然に直した英文" }),
    reason: z.string().meta({ description: "直した理由（日本語）" }),
  })
  .meta({ ref: "Rewrite", description: "本人の一文の言い換え" });

export const ContentClaim = z
  .object({
    quote: z.string().meta({
      description:
        "発話からの引用。文字起こし（transcript）に書かれているとおりの文字列。前の描写が終わった位置から先を、そのままの文字列で探すと下線を引ける（1 つの文が 2 つの項目に当たるときは、引用が重なることがある）",
    }),
    verdict: z.enum(["correct", "contradiction", "absent", "offtopic"]).meta({
      description:
        "correct: 場面と合う・contradiction: 場面と矛盾する・absent: 場面に無い物や人・offtopic: 場面と関係が無い。数えない描写（推測やつなぎの言葉）は送らない",
    }),
    item: z.string().nullable().meta({
      description:
        "当たったチェックリストの項目の id（items の id）。correct で null なら、一覧に無い正しい描写（その他）。correct 以外は null",
    }),
    level: z.enum(["full", "partial"]).nullable().meta({
      description:
        "項目に当たったときの達成（full: 言えた・partial: 一部）。item が null なら null",
    }),
    note: z.string().nullable().meta({
      description: "間違いの理由（日本語）。correct のときは null",
    }),
  })
  .meta({
    ref: "ContentClaim",
    description: "発話を事実 1 つずつに分けた描写と、その判定",
  });

export const ContentItem = z
  .object({
    id: z.string(),
    kind: ChecklistKind,
    label: z.string().meta({ description: "振り返りに出す日本語" }),
    level: z.enum(["full", "partial", "none"]).meta({
      description: "full: 言えた・partial: 一部・none: 言えていない",
    }),
  })
  .meta({
    ref: "ContentItem",
    description: "チェックリストの項目ごとの達成",
  });

const Count = z.number().min(0);

export const PlayerContent = z
  .object({
    claims: z
      .array(ContentClaim)
      .meta({ description: "話した順。数えない描写は入らない" }),
    items: z
      .array(ContentItem)
      .meta({ description: "場面のチェックリストの順" }),
    others: z.int().min(0).meta({
      description: "その他（一覧に無い正しい描写）として数えた件数。2 件まで",
    }),
    recall: z
      .object({
        earned: Count.meta({
          description:
            "言えた重み（中心・理由・つながり 2、細部 1、一部は半分、その他 1 件 0.5。max で頭打ち）",
        }),
        max: Count.meta({ description: "満点の重み（項目だけの合計）" }),
      })
      .meta({ description: "言えた（再現率）の分子と分母" }),
    precision: z
      .object({
        correct: z.int().min(0).meta({ description: "正しい描写の数" }),
        said: z
          .int()
          .min(0)
          .meta({ description: "言った描写の数（claims の数と同じ）" }),
      })
      .meta({ description: "正しさ（適合率）の分子と分母" }),
  })
  .meta({
    ref: "PlayerContent",
    description:
      "内容の点の内訳。内容 = 100 × 2PR / (P + R)、R = recall.earned ÷ recall.max、P = precision.correct ÷ precision.said（どちらも分母が 0 なら 0）",
  });

export const FeedbackNextStep = z
  .object({
    kind: z.enum(["content", "expression", "speech"]),
    text: z.string(),
    item: z.string().nullable().meta({
      description:
        "kind が content のとき、勧めるチェックリストの項目の id（content.items の id）。項目を全部言えているとき・短すぎる発話のとき・content 以外は null",
    }),
    gain: z.int().nullable().meta({
      description:
        "その項目を言えたら、合計の点（score.total）が何点伸びるか。item が null のときは null",
    }),
  })
  .meta({
    ref: "FeedbackNextStep",
    description:
      "次に伸ばす一つ。内容・表現・話し方のどれを勧めるかは採点の Claude が選ぶ",
  });

export const Feedback = z
  .object({
    nextStep: FeedbackNextStep,
    rewrite: Rewrite.nullable().meta({
      description: "直す所が無ければ null",
    }),
    speechTip: z
      .object({
        aspect: z.enum(["accuracy", "fluency", "prosody"]),
        text: z.string(),
      })
      .meta({
        ref: "FeedbackSpeechTip",
        description: "話し方のコツ。発音・なめらかさ・抑揚のうち最も低いもの",
      }),
  })
  .meta({ ref: "Feedback", description: "振り返りの講評" });

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
    content: PlayerContent.nullable().meta({
      description:
        "内容の点の内訳（描写の一覧・項目ごとの達成・言えたと正しさ）。全員分が届く。採点できなかった人は null",
    }),
    feedback: Feedback.nullable().meta({
      description:
        "振り返りに出す講評。全員分が届くが、詳しく出すのは本人の画面だけにする。採点できなかった人は null",
    }),
  })
  .meta({ ref: "PlayerResult" });

export const ResultsMessage = z
  .object({
    type: z.literal("results"),
    round: z.int().min(1),
    sceneId: SceneId,
    sceneName: z.string().meta({ example: "雨のバス停" }),
    players: z.array(PlayerResult).meta({
      description:
        "順位の順（1 位が先頭）。採点できなかった人は最後。全員分の内訳を載せるので、自分の分は playerId で選ぶ",
    }),
  })
  .meta({
    ref: "ResultsMessage",
    description:
      "全員の採点がそろうか、締め切りの時刻が来たら全員へ送る。締め切りは、録音が終わるはずの時刻（round の startAt + 回転 3 秒 + 録音 20 秒）から、音声が 10 秒・採点が 30 秒。音声を送っていない人と、採点が間に合わなかった人は「採点できませんでした」（rank・score が null）。結果発表のときに戻ってきた人にも送り直す",
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
