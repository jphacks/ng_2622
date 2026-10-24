// 採点の入出力の型。部屋（Durable Object）からは score() とこの型だけを使う

export type ScoringEnv = {
  AZURE_API_KEY?: string;
  AZURE_LOCATION?: string;
  CLAUDE_API_KEY?: string;
  // "live": Azure と Claude を呼ぶ ／ "fixed": 外部 API を呼ばず固定の点数を返す（止めるスイッチ）
  SCORING_MODE?: string;
  // 内容・表現・話し方の重み。"50,25,25" の形
  SCORE_WEIGHTS?: string;
  CLAUDE_MODEL?: string;
};

export type Scene = {
  id: string;
  name: string;
  // Claude に渡す場面の説明（英語）
  description: string;
  // 描写してほしい要素
  elements: string[];
  // アプリに同梱する動画のファイル名
  video: string;
};

export type SpeechScore = {
  transcript: string;
  accuracy: number;
  fluency: number;
  prosody: number;
  // 上の 3 つの平均。PronScore はこれらをまとめた点なので使わない
  score: number;
};

export type LanguageScore = {
  content: number;
  expression: number;
  // 講評の一言（日本語）
  comment: string;
  // 模範表現（英語）
  modelAnswer: string;
};

export type ScoreResult =
  | {
      ok: true;
      sceneId: string;
      // 重み付きの合計（0〜100）。順位はこれで決める
      total: number;
      content: number;
      expression: number;
      speech: number;
      transcript: string;
      comment: string;
      modelAnswer: string;
      // 話し方の内訳
      speechDetail: { accuracy: number; fluency: number; prosody: number };
      mode: "live" | "fixed";
      elapsedMs: number;
    }
  | {
      ok: false;
      sceneId: string;
      reason: "invalid_audio" | "unknown_scene" | "no_speech" | "api_error";
      message: string;
    };
