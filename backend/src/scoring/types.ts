import type { NextStepKind, SentContent } from "./checklist";

// 採点の入出力の型。部屋（Durable Object）からは score() とこの型だけを使う

export type ScoringEnv = {
  AZURE_API_KEY?: string;
  AZURE_LOCATION?: string;
  CLAUDE_API_KEY?: string;
  // "live": Azure と Claude を呼ぶ ／ "fixed": 外部 API を呼ばず固定の点数を返す（止めるスイッチ）
  SCORING_MODE?: string;
  // 内容・表現・話し方の重み。"50,25,25" の形
  SCORE_WEIGHTS?: string;
  // 採点に使う Claude のモデルと effort（low・medium・high・xhigh・max）。無ければ claude.ts の既定
  CLAUDE_MODEL?: string;
  CLAUDE_EFFORT?: string;
};

export type SpeechScore = {
  transcript: string;
  accuracy: number;
  fluency: number;
  prosody: number;
  // 上の 3 つの平均。PronScore はこれらをまとめた点なので使わない
  score: number;
  // 単語ごとの正確さ。話し方の一言で、直す単語を一つ選ぶのに使う
  words: { word: string; accuracy: number; errorType: string }[];
};

export type Rewrite = { before: string; after: string; reason: string };

export type SpeechAspect = "accuracy" | "fluency" | "prosody";

// Azure の話し方の 3 つの点。Claude が次に伸ばす一つを選ぶ材料
export type SpeechAspects = Pick<
  SpeechScore,
  "accuracy" | "fluency" | "prosody"
>;

/** 次に伸ばす一つ。Claude が選び、内容のときの項目はコードが確かめる（checklist.ts の checkNextStep） */
export type NextStep = {
  kind: NextStepKind;
  text: string;
  // 内容のとき、勧めるチェックリストの項目の id。それ以外と、項目が無いときは null
  item: string | null;
  // その項目を言えたら合計の点が何点伸びるか（重み付きの合計の差）。項目が無いときは null
  gain: number | null;
};

// 振り返りに出す講評。次に伸ばすのは一つだけ
export type Feedback = {
  nextStep: NextStep;
  // 本人の一文の言い換え。直す所が無ければ null
  rewrite: Rewrite | null;
  // 話し方のコツ。Azure の点からコードが作る
  speechTip: { aspect: SpeechAspect; text: string };
  // 表現の点の根拠（英語 1 文）。採点の Claude が書く。
  // 3 語未満で Claude を呼ばなかった・呼び直しても空だった・固定の点数のモードは null
  expressionBasis: string | null;
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
      // 内容の内訳（描写の一覧・項目ごとの達成・言えたと正しさの分子と分母）
      breakdown: SentContent;
      feedback: Feedback;
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
