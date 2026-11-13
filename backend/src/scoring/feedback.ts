import type { CheckedNextStep } from "./checklist";
import type { Feedback, Rewrite, SpeechAspect, SpeechScore } from "./types";

// 講評のうち、コードが作る・確かめる部分（話し方のコツ、次の一つを話し方にするか、言い換えの引用の確かめ）

// 話し方はこの点以上なら褒めるだけにする
const GOOD_SPEECH = 80;
// 話し方の一番低い点が、内容と表現の低いほうよりこの点以上低ければ、次の一つを話し方にする
const SPEECH_GAP = 20;
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

/**
 * 次の一つを話し方に差し替えるかをコードで決める。Claude には話し方の点を渡さない（Azure と同時に呼ぶため）。
 * 話し方の一番低い点が「内容と表現の低いほう − SPEECH_GAP」以下で、かつ褒めるだけの線（GOOD_SPEECH）より低いときだけ差し替える。
 * 文は話し方のコツ（speechTip）と同じにし、項目は持たない
 */
export const preferSpeech = (
  step: CheckedNextStep,
  score: { content: number; expression: number },
  speech: Pick<SpeechScore, "accuracy" | "fluency" | "prosody" | "words">,
): CheckedNextStep => {
  const lowest = Math.min(speech.accuracy, speech.fluency, speech.prosody);
  if (
    lowest >= GOOD_SPEECH ||
    lowest > Math.min(score.content, score.expression) - SPEECH_GAP
  ) {
    return step;
  }
  return {
    kind: "speech",
    text: speechTip(speech).text,
    item: null,
    contentIfSaid: null,
  };
};

// 文字起こしに無い文の言い換えは、Claude の作り話なので出さない。直した後が同じなら、直す所が無いものとして出さない
export const checkedRewrite = (
  transcript: string,
  rewrite: Rewrite | null,
): Rewrite | null =>
  rewrite &&
  quotedFrom(transcript, rewrite.before) &&
  normalize(rewrite.before) !== normalize(rewrite.after)
    ? rewrite
    : null;
