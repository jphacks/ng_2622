import type {
  ElementJudgment,
  Feedback,
  LanguageNotes,
  Scene,
  SpeechAspect,
  SpeechScore,
} from "./types";

// 次に伸ばす一つは Claude に選ばせず、点数から決める（採点と講評を食い違わせないため）

// 話し方はこの点以上なら褒めるだけにする
const GOOD_SPEECH = 80;
// 単語の正確さがこれより低ければ、その単語を名指しする
const WEAK_WORD = 60;

// 記号と大文字小文字を無視して、文字起こしに含まれるかを見る
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const quotedFrom = (transcript: string, quote: string) => {
  const q = normalize(quote);
  return q !== "" && ` ${normalize(transcript)} `.includes(` ${q} `);
};

// 言えなかった要素のうち、合計点が最も伸びるもの
export const pickMissingElement = (
  scene: Scene,
  elements: ElementJudgment[],
) => {
  const level = new Map(elements.map((j) => [j.id, j.level]));
  let best: { id: string; label: string; points: number } | null = null;
  for (const e of scene.elements) {
    const l = level.get(e.id) ?? "none";
    if (l === "full") continue;
    const points = l === "partial" && e.partial ? e.points / 2 : e.points;
    if (!best || points > best.points) {
      best = { id: e.id, label: e.label, points };
    }
  }
  return best;
};

export const speechTip = (
  speech: Pick<SpeechScore, "accuracy" | "fluency" | "prosody" | "words">,
): Feedback["speechTip"] => {
  const aspects: SpeechAspect[] = ["accuracy", "fluency", "prosody"];
  const aspect = aspects.reduce((a, b) => (speech[b] < speech[a] ? b : a));
  if (speech[aspect] >= GOOD_SPEECH) {
    return {
      aspect,
      text: "発音・なめらかさ・抑揚ともに安定しています。この調子です。",
    };
  }
  if (aspect === "accuracy") {
    // 赤字を並べると意欲が下がるので、名指しするのは最も低い一語だけ
    const weakest = speech.words
      .filter((w) => w.word && w.accuracy < WEAK_WORD)
      .sort((a, b) => a.accuracy - b.accuracy)[0];
    return {
      aspect,
      text: weakest
        ? `“${weakest.word}” を一音ずつはっきり発音してみよう。`
        : "一語ずつはっきり発音してみよう。",
    };
  }
  if (aspect === "fluency") {
    return {
      aspect,
      text: "言葉の間を短くして、ひと続きで言ってみよう。",
    };
  }
  return {
    aspect,
    text: "文の終わりを少し下げると、抑揚が伝わりやすくなります。",
  };
};

export const buildFeedback = (input: {
  scene: Scene;
  transcript: string;
  elements: ElementJudgment[];
  expression: number;
  speech: Pick<
    SpeechScore,
    "accuracy" | "fluency" | "prosody" | "score" | "words"
  >;
  notes: LanguageNotes;
  // 内容・表現・話し方の重み
  weights: [number, number, number];
}): Feedback => {
  const { scene, transcript, notes, weights } = input;
  const tip = speechTip(input.speech);
  const sum = weights[0] + weights[1] + weights[2];

  const missing = pickMissingElement(scene, input.elements);
  let nextStep: Feedback["nextStep"];
  if (missing) {
    const hint = notes.hints.find((h) => h.id === missing.id)?.text;
    nextStep = {
      kind: "content",
      gain: Math.round((missing.points * weights[0]) / sum),
      text: hint || `次は「${missing.label}」を足してみよう。`,
    };
  } else if (input.expression <= input.speech.score) {
    nextStep = {
      kind: "expression",
      gain: null,
      text: notes.expressionTip || "文をつなげて、もう少し詳しく言ってみよう。",
    };
  } else {
    nextStep = { kind: "speech", gain: null, text: tip.text };
  }

  return { ...checkedNotes(transcript, notes), nextStep, speechTip: tip };
};

// 文字起こしに無い引用は、Claude の作り話なので出さない
export const checkedNotes = (
  transcript: string,
  notes: Pick<LanguageNotes, "strength" | "rewrite">,
) => {
  const strength = quotedFrom(transcript, notes.strength.quote)
    ? notes.strength
    : { quote: "", text: notes.strength.text };
  const rewrite =
    notes.rewrite &&
    quotedFrom(transcript, notes.rewrite.before) &&
    normalize(notes.rewrite.before) !== normalize(notes.rewrite.after)
      ? notes.rewrite
      : null;
  return { strength, rewrite };
};
