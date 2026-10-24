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
  // 描写してほしい要素。言えた要素の点を足したものが内容の点になる
  elements: SceneElement[];
  // 一覧にない正しい描写に出す点の上限。elements の points と足して 100 にする
  extraMax: number;
  // アプリに同梱する動画のファイル名
  video: string;
};

export type SceneElement = {
  id: string;
  // 画面に出す名前（日本語）
  label: string;
  points: number;
  // 満点にする言い方（英語。Claude に渡す）
  accept: string;
  // 半分の点にする言い方。無ければ部分点なし
  partial?: string;
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
  // 要素ごとの判定。内容の点の内訳
  elements: ElementJudgment[];
};

export type ElementJudgment = {
  id: string;
  level: "full" | "partial" | "none";
  // 判定の根拠にした発言
  evidence: string;
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
      // 内容の内訳
      elements: ElementJudgment[];
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
