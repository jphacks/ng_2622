import { z } from "zod";
import { CHECKLIST_KINDS, GRADE_IDS } from "../scenes/types";

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

export const PlayerColor = z.int().min(0).max(0xffffff).meta({
  ref: "PlayerColor",
  description: "アバターの色。0xRRGGBB を整数で表す",
  example: 0x5b5be6,
});

export const SceneId = z.string().min(1).meta({
  ref: "SceneId",
  description: "シーンの ID（シーンの JSON の id）",
  example: "gen-7k2m9q4x3a",
});

// 値は scenes/types.ts の GRADE_IDS の 1 か所で決める（場面の difficulty・作り置きの一覧のキーと同じ）
export const Difficulty = z.enum(GRADE_IDS).meta({
  ref: "Difficulty",
  description:
    "場面の難易度（級）。eiken-3: かんたん・eiken-pre2: ふつう・eiken-2: むずかしい。古い値（easy・normal・hard）は受け付けない",
});

export const ChecklistKind = z.enum(CHECKLIST_KINDS).meta({
  ref: "ChecklistKind",
  description:
    "チェックリストの項目の種類。center: 中心（誰が何をしているか）・reason: 理由・link: つながり（原因 → 行動 → 結果や目的）・detail: 細部（位置など）",
});

export const RoomPhase = z
  .enum(["lobby", "generating", "playing", "waiting", "results"])
  .meta({
    ref: "RoomPhase",
    description:
      "部屋の進み具合。lobby: 待合、generating: 部屋が AI で場面を作っている、playing: 回転と録音、waiting: 採点待ち、results: 結果発表",
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
    "server_busy",
    "not_playing",
    "already_submitted",
    "deadline_passed",
    "invalid_audio",
    "not_in_results",
    "scoring_failed",
    "generation_refused",
    "generation_failed",
    "generation_unavailable",
    "rate_limited",
    "analysis_failed",
    "analysis_unavailable",
  ])
  .meta({
    ref: "ErrorCode",
    description: [
      "room_not_found: 部屋が無い",
      "room_full: 満員",
      "invalid_message: メッセージの形が違う",
      "unauthorized: 参加者の ID と合言葉が合わない（POST /scenes/generate では SCENE_WRITE_TOKEN が違う）",
      "not_host: ホストだけができる操作",
      "not_in_lobby: 待合でしかできない操作",
      "unknown_scene: シーンの ID が無い",
      "server_busy: 空いている部屋のコードが無い",
      "not_playing: ラウンド中でない、ラウンドの番号が違う、またはそのラウンドに参加していない",
      "already_submitted: このラウンドの音声はもう受け取った",
      "deadline_passed: このラウンドの音声の締め切り（録音が終わるはずの時刻から 15 秒）を過ぎた。その人は採点できなかった扱いになっている",
      "invalid_audio: 音声が 1 MB までの WAV でない",
      "not_in_results: 結果発表のときにしかできない操作",
      "scoring_failed: 採点の途中で失敗した（Claude の呼び出しなど）",
      "generation_refused: Claude が断った（POST /weak-scenes では 502）",
      "generation_failed: Claude の応答が途中で止まった・形が違った・作り直しても裏取りを通らなかった（POST /weak-scenes では、Claude の失敗・時間切れ・部品を作れなかったも含めて 502）",
      "generation_unavailable: Claude を呼べない（タイムアウト・API の失敗・止めてある。POST /weak-scenes では WEAK_SCENE_GENERATION が on でない・置き場が無い・回数を数える場所が失敗した）",
      "rate_limited: 苦手の分析・苦手の場面の回数の上限（IP ごとの 1 時間か、全体の 1 日）に達した",
      "analysis_failed: 苦手の分析で Claude が失敗した（API の失敗・途中で止まった・JSON が読めない・時間切れ）",
      "analysis_unavailable: 苦手の分析ができない（WEAK_POINT_ANALYSIS が on でない・PR のプレビュー・Claude のキーが無い・回数を数える場所が失敗した）",
    ].join("\n"),
  });

export const Player = z
  .object({
    id: PlayerId,
    name: PlayerName,
    color: PlayerColor,
    isHost: z.boolean(),
    connected: z
      .boolean()
      .meta({ description: "false のときは切断中（復帰を待っている）" }),
  })
  .meta({ ref: "Player" });

export const PlayerStatus = z
  .enum(["talking", "grading", "done", "offline"])
  .meta({
    ref: "PlayerStatus",
    description:
      "ラウンド中の各自の状態。talking: 話している（音声がまだ届いていない）、grading: 採点中、done: 完了（採点できなかった人も含む）、offline: 切断中",
  });
