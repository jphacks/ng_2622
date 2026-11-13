import { tokenize } from "../scoring/checklist";

// 苦手の分析で Claude が返した文の確かめ（Claude は呼ばない純粋な関数）。
// 決まりは docs/design/weak-point-analysis.md の 6。引用は採点の verifyClaims と同じ比べ方（checklist.ts の tokenize。
// 大文字小文字・句読点・空白を無視）で文字起こしに探し、見つかれば文字起こしに書かれているとおりの文字列に直す。
// 見つからない引用は捨てる

export type Viewpoint = "content" | "expression";
export type Quote = { n: number; quote: string };
export type Habit = {
  viewpoint: Viewpoint;
  title: string;
  what: string;
  examples: Quote[];
  fix: string;
};
export type Improvement = {
  viewpoint: Viewpoint;
  text: string;
  example: Quote;
};
export type NextTry = { viewpoint: Viewpoint; text: string };

/** 確かめを通った分析（POST /weak-points の本文から retries を除いたもの） */
export type Analysis = {
  habits: Habit[];
  improvement: Improvement | null;
  nextTry: NextTry | null;
};

/** Claude が返した形。structured output で schema は守られるが、念のため欄が欠けていても読めるようにする */
export type RawAnalysis = {
  habits?: Partial<Habit>[];
  improvement?: Partial<Improvement> | null;
  nextTry?: Partial<NextTry> | null;
};

/** 1 つの癖が落ちた理由。quote は引用の確かめ（見つかった実例が 2 つ以上の違う回にまたがらない） */
export type HabitDrop = "viewpoint" | "empty" | "number" | "quote" | "overflow";

/** 確かめの結果の数（ログと測定に使う。文字起こしの中身は入れない） */
export type VerifyStats = {
  // Claude が返した癖の数（確かめる前）
  habits: number;
  // 確かめを通った癖の数
  kept: number;
  dropped: Record<HabitDrop, number>;
  // 実例（確かめる前の数と、送った回の文字起こしに見つかった数）
  examples: { total: number; found: number };
  // 良くなった点: none は Claude が null を返した。それ以外の落ちた理由は half（後半の回でない）・quote・empty・number・viewpoint
  improvement:
    | "kept"
    | "none"
    | "half"
    | "quote"
    | "empty"
    | "number"
    | "viewpoint";
  nextTry: "kept" | "none" | "empty" | "number" | "viewpoint";
};

/** 送った回のうち、引用の確かめに使う欄 */
export type RoundText = { n: number; transcript: string };

/** 1 回の分析に出す癖の数の上限 */
export const MAX_HABITS = 3;
/** 1 つの癖に出す実例の数の上限 */
export const MAX_EXAMPLES = 3;

const VIEWPOINTS: readonly string[] = ["content", "expression"];

// 割合・点の数字（画面の数字と食い違わせないため）。「次の 1 回」は当てないよう「回」は入れない。
// 英語の例の "two dogs" のような数の語は数字でないので当たらない
const NUMBER = /[0-9０-９]+(?:[.,．][0-9０-９]+)?\s*(?:%|％|点|割)/;

export const hasNumber = (text: string) => NUMBER.test(text);

const blank = (text: unknown): boolean =>
  typeof text !== "string" || text.trim() === "";

/** 後半の回の番号（新しいほうの ⌊回の数 / 2⌋ 回）。奇数なら真ん中の 1 回は前半にも後半にも入れない */
export const secondHalf = (count: number): number[] => {
  const h = Math.floor(count / 2);
  return Array.from({ length: h }, (_, i) => count - h + 1 + i);
};

type Found = Quote & { at: number; length: number };

/** 引用が文字起こしに語の並びとして出る最初の位置（語の番号と数）と、文字起こしのとおりの文字列 */
export const locateQuote = (
  transcript: string,
  quote: string,
): { text: string; at: number; length: number } | undefined => {
  const words = tokenize(quote).map((t) => t.text);
  if (words.length === 0) return undefined;
  const tokens = tokenize(transcript);
  for (let at = 0; at + words.length <= tokens.length; at++) {
    if (words.every((w, j) => tokens[at + j].text === w)) {
      return {
        text: transcript.slice(
          tokens[at].start,
          tokens[at + words.length - 1].end,
        ),
        at,
        length: words.length,
      };
    }
  }
  return undefined;
};

/**
 * 出す実例を選ぶ（3 つまで）。違う回のものを先に、新しい回から 1 回に 1 つ（その回で先に話したもの）選び、
 * 3 つに足りなければ残りの実例を新しい回から足す。返すのも新しい回から（同じ回の中は話した順）
 */
export const pickExamples = (found: Found[]): Quote[] => {
  // 新しい回から、同じ回の中は話した順
  const newestFirst = [...found].sort((a, b) => b.n - a.n || a.at - b.at);
  const picked: Found[] = [];
  for (const f of newestFirst) {
    if (picked.length >= MAX_EXAMPLES) break;
    if (!picked.some((p) => p.n === f.n)) picked.push(f);
  }
  for (const f of newestFirst) {
    if (picked.length >= MAX_EXAMPLES) break;
    if (!picked.includes(f)) picked.push(f);
  }
  return picked
    .sort((a, b) => b.n - a.n || a.at - b.at)
    .map(({ n, quote }) => ({ n, quote }));
};

/** 引用を送った回の文字起こしに探す。見つかれば文字起こしのとおりの文字列に直す */
const find = (
  byN: Map<number, string>,
  raw: Partial<Quote> | undefined,
): Found | undefined => {
  if (!raw || typeof raw.n !== "number" || typeof raw.quote !== "string") {
    return undefined;
  }
  const transcript = byN.get(raw.n);
  if (transcript === undefined) return undefined;
  const located = locateQuote(transcript, raw.quote);
  if (!located) return undefined;
  return {
    n: raw.n,
    quote: located.text,
    at: located.at,
    length: located.length,
  };
};

/**
 * Claude が返した分析を確かめる。癖は、観点・空の欄・数字（見出しも含む）・引用（2 つ以上の違う回）の順に見て落とし、
 * 通ったものを返った順に 3 件まで残す。実例は同じ回の同じ引用を 1 つにし、pickExamples で 3 つまで選ぶ
 */
export const verifyAnalysis = (
  rounds: RoundText[],
  raw: RawAnalysis,
): { analysis: Analysis; stats: VerifyStats } => {
  const byN = new Map(rounds.map((r) => [r.n, r.transcript]));
  const dropped: Record<HabitDrop, number> = {
    viewpoint: 0,
    empty: 0,
    number: 0,
    quote: 0,
    overflow: 0,
  };
  const examples = { total: 0, found: 0 };
  const habits: Habit[] = [];
  const rawHabits = Array.isArray(raw.habits) ? raw.habits : [];

  for (const h of rawHabits) {
    const rawExamples = Array.isArray(h.examples) ? h.examples : [];
    examples.total += rawExamples.length;
    const found: Found[] = [];
    for (const e of rawExamples) {
      const f = find(byN, e);
      if (!f) continue;
      examples.found++;
      if (
        !found.some(
          (g) => g.n === f.n && g.at === f.at && g.length === f.length,
        )
      ) {
        found.push(f);
      }
    }
    if (!h.viewpoint || !VIEWPOINTS.includes(h.viewpoint)) {
      dropped.viewpoint++;
      continue;
    }
    if (blank(h.title) || blank(h.what) || blank(h.fix)) {
      dropped.empty++;
      continue;
    }
    const title = (h.title as string).trim();
    const what = (h.what as string).trim();
    const fix = (h.fix as string).trim();
    if ([title, what, fix].some(hasNumber)) {
      dropped.number++;
      continue;
    }
    if (new Set(found.map((f) => f.n)).size < 2) {
      dropped.quote++;
      continue;
    }
    if (habits.length >= MAX_HABITS) {
      dropped.overflow++;
      continue;
    }
    habits.push({
      viewpoint: h.viewpoint,
      title,
      what,
      examples: pickExamples(found),
      fix,
    });
  }

  const improvement = checkImprovement(byN, rounds.length, raw.improvement);
  const nextTry = checkNextTry(raw.nextTry);
  return {
    analysis: {
      habits,
      improvement: improvement.value,
      nextTry: nextTry.value,
    },
    stats: {
      habits: rawHabits.length,
      kept: habits.length,
      dropped,
      examples,
      improvement: improvement.status,
      nextTry: nextTry.status,
    },
  };
};

const checkImprovement = (
  byN: Map<number, string>,
  count: number,
  raw: Partial<Improvement> | null | undefined,
): { value: Improvement | null; status: VerifyStats["improvement"] } => {
  if (!raw) return { value: null, status: "none" };
  if (!raw.viewpoint || !VIEWPOINTS.includes(raw.viewpoint)) {
    return { value: null, status: "viewpoint" };
  }
  if (blank(raw.text)) return { value: null, status: "empty" };
  const text = (raw.text as string).trim();
  if (hasNumber(text)) return { value: null, status: "number" };
  if (!raw.example || !secondHalf(count).includes(raw.example.n as number)) {
    return { value: null, status: "half" };
  }
  const found = find(byN, raw.example);
  if (!found) return { value: null, status: "quote" };
  return {
    value: {
      viewpoint: raw.viewpoint,
      text,
      example: { n: found.n, quote: found.quote },
    },
    status: "kept",
  };
};

const checkNextTry = (
  raw: Partial<NextTry> | null | undefined,
): { value: NextTry | null; status: VerifyStats["nextTry"] } => {
  if (!raw) return { value: null, status: "none" };
  if (!raw.viewpoint || !VIEWPOINTS.includes(raw.viewpoint)) {
    return { value: null, status: "viewpoint" };
  }
  if (blank(raw.text)) return { value: null, status: "empty" };
  const text = (raw.text as string).trim();
  if (hasNumber(text)) return { value: null, status: "number" };
  return { value: { viewpoint: raw.viewpoint, text }, status: "kept" };
};
