// チェックリストの F1 で内容の点を付けるための型と計算（Claude は呼ばない純粋な関数）。
// 決まりは ADR 20261110-score-content-with-checklist-f1 と docs/design/usecase.md の「採点のときに Claude が返す形」。
// 30 場面を作り直して採点を切り替えるまで、今の採点（score・gradeWithBands）からは呼ばれない

export type Grade = "eiken-3" | "eiken-pre2" | "eiken-2";

export type ChecklistKind = "center" | "reason" | "link" | "detail";

/** 場面の JSON（scenenglish.scene/2）の checklist の 1 項目 */
export type ChecklistItem = {
  id: string;
  kind: ChecklistKind;
  // 振り返りに出す日本語
  label: string;
  // 「言えた」とする英語の言い方
  accept: string;
  // 項目が指す items の key
  refs: string[];
};

export type Verdict =
  | "correct"
  | "contradiction"
  | "absent"
  | "offtopic"
  | "ignored";

/** Claude が返す描写（事実 1 つ） */
export type Claim = {
  // 発話からの引用
  quote: string;
  verdict: Verdict;
  // 当たった checklist の id。無ければ null
  item: string | null;
  level: "full" | "partial" | null;
  // 間違いの理由（日本語）
  note: string | null;
};

export type ItemLevel = "full" | "partial" | "none";

export type ItemResult = {
  id: string;
  kind: ChecklistKind;
  label: string;
  level: ItemLevel;
};

/** アプリへ送る内容の内訳（ws.ts・openapi.json にはまだ入れていない） */
export type ContentBreakdown = {
  // 引用を文字起こしのとおりの文字列に直し、話した順に並べた描写
  claims: Claim[];
  // 項目ごとの達成（checklist の順）
  items: ItemResult[];
  // その他として数えた件数（OTHER_MAX まで）
  others: number;
  // 言えた（再現率）。earned ÷ max
  recall: { value: number; earned: number; max: number };
  // 正しさ（適合率）。correct ÷ said。said は ignored を除いた描写の数
  precision: { value: number; correct: number; said: number };
};

export type ContentResult = ContentBreakdown & {
  // 内容の点（0〜100 の整数）
  content: number;
};

// 重みは仮の値。30 場面を作り直した後に見直すので、ここ 1 か所に置く
export const WEIGHTS: Record<ChecklistKind | "other", number> = {
  center: 2,
  reason: 2,
  link: 2,
  detail: 1,
  other: 0.5,
};
// その他（一覧に無い正しい描写）として数える件数の上限
export const OTHER_MAX = 2;

const LEVEL_VALUE: Record<ItemLevel, number> = {
  full: 1,
  partial: 0.5,
  none: 0,
};

// 語に分ける。大文字小文字・句読点・空白の違いは、語の並びで比べることで無視する
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
type Token = { text: string; start: number; end: number };
const tokenize = (s: string): Token[] =>
  [...s.matchAll(WORD)].map((m) => ({
    text: m[0].toLowerCase().replace(/’/g, "'"),
    start: m.index,
    end: m.index + m[0].length,
  }));

// tokens の from 番目から先で、quote の語の並びが最初に出る位置。無ければ -1
const findFrom = (tokens: Token[], quote: string[], from: number) => {
  for (let i = from; i + quote.length <= tokens.length; i++) {
    if (quote.every((w, j) => tokens[i + j].text === w)) return i;
  }
  return -1;
};

// 項目に当たるのは correct の描写だけなので、それ以外の item・level は消してそろえる
const tidy = (claim: Claim, ids: Set<string>): Claim => {
  if (claim.verdict !== "correct") {
    return { ...claim, item: null, level: null };
  }
  if (claim.item === null || !ids.has(claim.item)) {
    return { ...claim, item: null, level: null, note: null };
  }
  // 項目に当たったのに level が無いときは、低いほう（一部）にする
  return { ...claim, level: claim.level ?? "partial", note: null };
};

/**
 * 引用を文字起こしの中で確かめる。見つからない描写は捨て、見つかったものは
 * 文字起こしに書かれているとおりの文字列に直して、話した順に並べる。
 * 同じ語が 2 回出るときのため、前の描写の終わりから先を探す。そこに無ければ（順が前後した・重なった）頭から探す
 */
export const verifyClaims = (
  transcript: string,
  claims: Claim[],
  checklist: ChecklistItem[] = [],
): Claim[] => {
  const tokens = tokenize(transcript);
  const ids = new Set(checklist.map((c) => c.id));
  const found: { claim: Claim; at: number; order: number }[] = [];
  let cursor = 0;
  claims.forEach((claim, order) => {
    const quote = tokenize(claim.quote).map((t) => t.text);
    if (quote.length === 0) return;
    let at = findFrom(tokens, quote, cursor);
    if (at >= 0) cursor = at + quote.length;
    else at = findFrom(tokens, quote, 0);
    if (at < 0) return;
    const text = transcript.slice(
      tokens[at].start,
      tokens[at + quote.length - 1].end,
    );
    found.push({ claim: { ...tidy(claim, ids), quote: text }, at, order });
  });
  return found
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((f) => f.claim);
};

/** 項目ごとの達成。その項目に当たった correct の描写の最も高い level（無ければ none） */
export const itemResults = (
  checklist: ChecklistItem[],
  claims: Claim[],
): ItemResult[] =>
  checklist.map(({ id, kind, label }) => {
    const levels = claims
      .filter((c) => c.verdict === "correct" && c.item === id)
      .map((c) => c.level);
    const level: ItemLevel = levels.includes("full")
      ? "full"
      : levels.length > 0
        ? "partial"
        : "none";
    return { id, kind, label, level };
  });

/** その他の件数。correct で item が null の描写を OTHER_MAX まで数える */
export const countOthers = (claims: Claim[]) =>
  Math.min(
    OTHER_MAX,
    claims.filter((c) => c.verdict === "correct" && c.item === null).length,
  );

/** 言えた（R）= 言えた重み ÷ 満点の重み。満点にはその他 OTHER_MAX 件分を含める */
export const recallOf = (
  items: Pick<ItemResult, "kind" | "level">[],
  others: number,
): ContentBreakdown["recall"] => {
  const max =
    items.reduce((sum, i) => sum + WEIGHTS[i.kind], 0) +
    WEIGHTS.other * OTHER_MAX;
  const earned =
    items.reduce((sum, i) => sum + WEIGHTS[i.kind] * LEVEL_VALUE[i.level], 0) +
    WEIGHTS.other * Math.min(OTHER_MAX, Math.max(0, others));
  return { value: earned / max, earned, max };
};

/**
 * 正しさ（P）= correct ÷（correct ＋ contradiction ＋ absent ＋ offtopic）。ignored は数えない。
 * 数える描写が 1 つも無いときは 0 にする（そのとき言えた項目も無く R = 0 なので、内容はどちらでも 0 点。
 * 何も言っていないのに「正しさ 100%」と出さないため）
 */
export const precisionOf = (
  claims: Pick<Claim, "verdict">[],
): ContentBreakdown["precision"] => {
  const said = claims.filter((c) => c.verdict !== "ignored").length;
  const correct = claims.filter((c) => c.verdict === "correct").length;
  return { value: said === 0 ? 0 : correct / said, correct, said };
};

/** 内容 = round(100 × 2PR / (P + R))。P + R = 0 なら 0 */
export const f1Content = (precision: number, recall: number) =>
  precision + recall === 0
    ? 0
    : Math.round((100 * 2 * precision * recall) / (precision + recall));

/** Claude が返した描写から、内容の点と内訳を作る */
export const scoreContent = (
  checklist: ChecklistItem[],
  transcript: string,
  rawClaims: Claim[],
): ContentResult => {
  const claims = verifyClaims(transcript, rawClaims, checklist);
  const items = itemResults(checklist, claims);
  const others = countOthers(claims);
  const recall = recallOf(items, others);
  const precision = precisionOf(claims);
  return {
    claims,
    items,
    others,
    recall,
    precision,
    content: f1Content(precision.value, recall.value),
  };
};

/**
 * その項目を full で言えたら、内容が何点伸びるか。
 * 言えていない項目は、正しい描写が 1 つ増えるとして P も動かす。一部の項目は、今の描写が full になるとして P はそのまま
 */
export const gainOf = (result: ContentResult, itemId: string): number => {
  const target = result.items.find((i) => i.id === itemId);
  if (!target || target.level === "full") return 0;
  const recall = recallOf(
    result.items.map((i) => (i.id === itemId ? { ...i, level: "full" } : i)),
    result.others,
  );
  const add = target.level === "none" ? 1 : 0;
  const precision =
    (result.precision.correct + add) / (result.precision.said + add);
  return f1Content(precision, recall.value) - result.content;
};

export type NextStepKind = "content" | "expression" | "speech";

/** Claude が選んだ次の一つ。content のときは言えていない項目の id を付ける */
export type RawNextStep = {
  kind: NextStepKind;
  text: string;
  item: string | null;
};

export type CheckedNextStep = {
  kind: NextStepKind;
  text: string;
  // content のとき、勧める項目の id。全部言えていれば null
  item: string | null;
  // その項目を full で言えたら内容が何点伸びるか。項目が無ければ null
  gain: number | null;
};

// 重みの最も重い言えていない項目（同じ重みなら checklist の順）。言えていない項目が無ければ、一部の項目から選ぶ
const heaviestMissing = (items: ItemResult[]) => {
  const heaviest = (level: ItemLevel) =>
    items
      .filter((i) => i.level === level)
      .reduce<ItemResult | null>(
        (best, i) => (best && WEIGHTS[best.kind] >= WEIGHTS[i.kind] ? best : i),
        null,
      );
  return heaviest("none") ?? heaviest("partial");
};

/**
 * 次の一つを確かめる。content で、返ってきた項目が checklist に無い・もう full で言えているときは、
 * 重みの最も重い言えていない項目に差し替える（文も、その項目のものに替える）
 */
export const checkNextStep = (
  result: ContentResult,
  raw: RawNextStep,
): CheckedNextStep => {
  if (raw.kind !== "content") {
    return { kind: raw.kind, text: raw.text, item: null, gain: null };
  }
  const chosen = result.items.find((i) => i.id === raw.item);
  if (chosen && chosen.level !== "full") {
    return {
      kind: "content",
      text: raw.text,
      item: chosen.id,
      gain: gainOf(result, chosen.id),
    };
  }
  const missing = heaviestMissing(result.items);
  if (!missing) {
    // 項目は全部言えている。Claude の一言（その他の描写や間違いの直し）をそのまま出す
    return { kind: "content", text: raw.text, item: null, gain: null };
  }
  return {
    kind: "content",
    text: `次は「${missing.label}」を足してみよう。`,
    item: missing.id,
    gain: gainOf(result, missing.id),
  };
};
