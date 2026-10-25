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
  // 配置から採点の基準を作るモデルと effort。無ければ CLAUDE_MODEL・CLAUDE_EFFORT
  CLAUDE_RUBRIC_MODEL?: string;
  CLAUDE_RUBRIC_EFFORT?: string;
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
  // 配置の JSON と部品のメタデータから作った基準か。true なら description に場面のすべてが書いてあるので、
  // 一覧にない描写は description と合うものだけ加点し、description に無い色などには反応しない
  fromLayout?: boolean;
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
  // 単語ごとの正確さ。話し方の一言で、直す単語を一つ選ぶのに使う
  words: { word: string; accuracy: number; errorType: string }[];
};

export type LanguageScore = {
  content: number;
  expression: number;
  // 要素ごとの判定。内容の点の内訳
  elements: ElementJudgment[];
  // 講評の材料。どれを出すかは feedback.ts が点数から決める
  notes: LanguageNotes;
};

// Claude が書く講評の材料（日本語。引用だけ英語）
export type LanguageNotes = {
  // できたこと。quote は文字起こしからそのまま引く
  strength: { quote: string; text: string };
  // 言えなかった要素ごとの一言ヒント
  hints: { id: string; text: string }[];
  // 表現を伸ばす一言
  expressionTip: string;
  // 本人の一文を自然に直したもの。直す所が無ければ null
  rewrite: Rewrite | null;
};

export type Rewrite = { before: string; after: string; reason: string };

export type SpeechAspect = "accuracy" | "fluency" | "prosody";

// 振り返りに出す講評。次に伸ばすのは一つだけ
export type Feedback = {
  strength: { quote: string; text: string };
  nextStep: {
    kind: "content" | "expression" | "speech";
    // 合計点で何点伸びるか。内容の要素のときだけ出す
    gain: number | null;
    text: string;
  };
  rewrite: Rewrite | null;
  speechTip: { aspect: SpeechAspect; text: string };
};

// 話し方の点が無いときの講評（配置から採点する POST /score）。次に伸ばすのは内容か表現
export type ContentFeedback = {
  strength: Feedback["strength"];
  nextStep: {
    kind: "content" | "expression";
    // 内容の点（0〜100）で何点伸びるか。内容の要素のときだけ出す
    gain: number | null;
    text: string;
  };
  rewrite: Rewrite | null;
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
      feedback: Feedback;
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
