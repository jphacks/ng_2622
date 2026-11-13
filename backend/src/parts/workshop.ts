import type { Part } from "../scenes/types";
import { isBundledPart, isObjectId, MAX_ID_LENGTH } from "./ids";
import { makePart } from "./make";
import { refusedTerm } from "./policy";
import { readPartMeta, savePart } from "./store";
import {
  PART_CATEGORIES,
  type PartCategory,
  type PartsClaudeEnv,
  type WriteDeps,
} from "./write";

// 部品をその場で作る口（POST /weak-scenes などの場面の生成が使う）。決めたことの正本は docs/design/part-generation.md。
// - lookupPart: R2 に置いた部品のメタデータを引く（同梱の部品は引かない。同梱は src/scenes/parts.ts の PARTS）
// - ensureParts: 注文の部品をそろえる。R2 に既にある ID は作らずにメタデータを返し、無い物だけ並べて作る
//   （Claude に部品表を書かせ → 組み → 検査 → R2 に置く）
// 組み立ては呼んだ側の CPU で動く（1 個で初回 7〜12 ms）。Worker の無料プランの 10 ms を超えるので、
// 場面の生成と同じ Durable Object（WeakSceneMaker）の中から呼ぶ。テストや手元の確かめでは直に呼んでよい

export { isBundledPart, isObjectId, OBJECT_ID, parsePartId } from "./ids";
export { PART_CATEGORIES } from "./write";

/** 作る部品の注文 */
export type PartOrder = {
  /** 物の ID の規約の形（ids.ts の isObjectId）。同梱の ID と重ねない */
  id: string;
  category: PartCategory;
  /** 日本語の名前 */
  label: string;
  /** 英語の名詞（1 つ以上）。メタデータの words（pos は noun）になる */
  words: string[];
  /** m。幅・高さ・奥行き（プロトコルの座標。高さは Y） */
  size: [number, number, number];
  /** 英語 1 文。形と色 */
  description: string;
  /** 上に物を置けるか（true なら anchors.top を付ける） */
  top?: boolean;
};

/** 作った（R2 にある）部品のメタデータ。index.json の 1 件と同じ形（id・version・file・category・words・size・label・anchors?） */
export type MadePart = Part;

/** R2（BUCKET）と Claude のキー・モデル（CLAUDE_API_KEY・CLAUDE_PART_*、無ければ CLAUDE_SCENE_*） */
export type PartsEnv = { BUCKET: R2Bucket } & PartsClaudeEnv;

export type EnsureOptions = {
  /** 止めたら、まだできていない部品を失敗として返す（Claude の呼び出しも止める） */
  signal?: AbortSignal;
  /** 1 回に新しく作る数の上限。超えた注文は失敗として返す */
  maxNew: number;
  /** Claude の 1 回の呼び出しの上限（ms）。既定 60 秒。検査に落ちると書き直しで 2 回呼ぶ */
  timeoutMs?: number;
  /** Claude の呼び出しと時計の差し替え（テスト用） */
  deps?: WriteDeps;
};

export type EnsureResult = {
  /** そろった部品（注文の順。同じ ID の注文は 1 つにまとめる） */
  parts: MadePart[];
  failed: { id: string; reason: string }[];
};

/** 1 個の部品の結果（ログと測定用。作ったときだけ時間と費用が入る） */
export type MadeLog = {
  id: string;
  made: boolean;
  ms: number;
  usd: number;
  attempts: number;
  tris: number;
};

const WORD = /^[a-z][a-z' -]{0,39}$/;
const MIN_SIZE = 0.01;
const MAX_SIZE = 8;

const MAX_LABEL = 40;
const MAX_DESCRIPTION = 300;

/** 注文の形を確かめる。よければ null、だめなら理由（作らない物の語を含む注文も、Claude を呼ばずに断る） */
export const orderProblem = (order: PartOrder): string | null => {
  if (typeof order.id !== "string" || !isObjectId(order.id))
    return `ID が物の規約に合わない（英小文字の名詞か名詞_区別、${MAX_ID_LENGTH} 文字まで）`;
  if (isBundledPart(order.id)) return "同梱の部品と同じ ID";
  if (
    typeof order.category !== "string" ||
    !(PART_CATEGORIES as readonly string[]).includes(order.category)
  )
    return `category は ${PART_CATEGORIES.join("・")} のどれか`;
  if (
    typeof order.label !== "string" ||
    order.label.length < 1 ||
    order.label.length > MAX_LABEL
  )
    return `label は 1〜${MAX_LABEL} 文字`;
  if (
    !Array.isArray(order.words) ||
    order.words.length < 1 ||
    order.words.length > 5 ||
    !order.words.every((w) => typeof w === "string" && WORD.test(w))
  )
    return "words は英小文字の名詞を 1〜5 個";
  if (
    !Array.isArray(order.size) ||
    order.size.length !== 3 ||
    !order.size.every(
      (v) =>
        typeof v === "number" &&
        Number.isFinite(v) &&
        v >= MIN_SIZE &&
        v <= MAX_SIZE,
    )
  )
    return `size は ${MIN_SIZE}〜${MAX_SIZE} m の数を 3 つ`;
  if (
    typeof order.description !== "string" ||
    order.description.length < 1 ||
    order.description.length > MAX_DESCRIPTION
  )
    return `description は 1〜${MAX_DESCRIPTION} 文字`;
  if (order.top !== undefined && typeof order.top !== "boolean")
    return "top は true か false";
  const refused = [order.id, ...order.words, order.label, order.description]
    .map(refusedTerm)
    .find((t) => t !== null);
  if (refused) return `refused: 作らない物の語（${refused}）を含む`;
  return null;
};

/** R2 に置いた部品のメタデータ。version を省くと最も新しい版。無ければ null（同梱の部品は引かない） */
export function lookupPart(
  env: Pick<PartsEnv, "BUCKET">,
  id: string,
  version?: number,
): Promise<MadePart | null> {
  if (!isObjectId(id)) return Promise.resolve(null);
  return readPartMeta(env.BUCKET, id, version);
}

type One =
  | { ok: true; part: MadePart; log: MadeLog }
  | { ok: false; reason: string };

// 同じ isolate で同じ ID を同時に作らない（後から来た注文は先の結果を待つ）。
// 別の isolate（別の Durable Object）で同時に作ったときは、R2 に置くときに版を分ける（store.ts の savePart）
const inflight = new Map<string, Promise<One>>();

const makeOne = async (
  env: PartsEnv,
  order: PartOrder,
  opts: EnsureOptions,
): Promise<One> => {
  const existing = await readPartMeta(env.BUCKET, order.id);
  if (existing)
    return {
      ok: true,
      part: existing,
      log: { id: order.id, made: false, ms: 0, usd: 0, attempts: 0, tris: 0 },
    };
  const deps = opts.deps ?? {};
  const now = deps.now ?? Date.now;
  const t0 = now();
  const outcome = await makePart(env, order, 1, deps, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  if (!outcome.ok) {
    console.error(
      `部品 ${order.id} を作れなかった（${outcome.kind}）`,
      outcome.reason,
    );
    return { ok: false, reason: `${outcome.kind}: ${outcome.reason}` };
  }
  const placed = await savePart(
    env.BUCKET,
    outcome.meta,
    outcome.usdz,
    outcome.record,
  );
  const log: MadeLog = {
    id: order.id,
    made: true,
    ms: now() - t0,
    usd: outcome.record.attempts.reduce((n, a) => n + a.usd, 0),
    attempts: outcome.record.attempts.length,
    tris: outcome.record.tris,
  };
  console.log(
    `部品 ${order.id}@${placed.version} を作った（${log.ms} ms、$${log.usd.toFixed(4)}、${log.attempts} 回、${log.tris} 三角形）`,
  );
  return { ok: true, part: placed, log };
};

const aborted = (signal: AbortSignal | undefined) =>
  new Promise<"aborted">((resolve) => {
    if (!signal) return;
    if (signal.aborted) resolve("aborted");
    else signal.addEventListener("abort", () => resolve("aborted"));
  });

/**
 * 注文の部品をそろえる。R2 に既にある ID は作らずにメタデータを返し、無い物だけ（maxNew 個まで）並べて作る。
 * 失敗（形が違う注文・上限を超えた・Claude が断った・検査に 2 回落ちた・Claude の失敗・止めた）は failed に理由を付けて返す。
 * logs は部品ごとの時間と費用（測定とログ用）
 */
export async function ensureParts(
  env: PartsEnv,
  orders: PartOrder[],
  opts: EnsureOptions,
): Promise<EnsureResult & { logs: MadeLog[] }> {
  const unique = [...new Map(orders.map((o) => [o.id, o])).values()];
  const done = new Map<string, MadePart>();
  const failed: EnsureResult["failed"] = [];
  const logs: MadeLog[] = [];
  const valid: PartOrder[] = [];
  for (const order of unique) {
    const problem = orderProblem(order);
    if (problem) failed.push({ id: order.id, reason: problem });
    else valid.push(order);
  }
  const stop = aborted(opts.signal);
  // R2 に既にあるか（並べて引く）。読めなかった ID は undefined（作らずに失敗にする）
  const found = await Promise.race([
    Promise.all(
      valid.map((o) =>
        lookupPart(env, o.id).catch((e) => {
          console.error(`部品 ${o.id} を R2 から読めなかった`, e);
          return undefined;
        }),
      ),
    ),
    stop,
  ]);
  if (found === "aborted") {
    for (const o of valid) failed.push({ id: o.id, reason: "止めた" });
    return { parts: [], failed, logs };
  }
  const toMake: PartOrder[] = [];
  valid.forEach((order, i) => {
    const part = found[i];
    if (part) done.set(order.id, part);
    else if (part === undefined)
      failed.push({ id: order.id, reason: "unavailable: R2 を読めなかった" });
    else if (toMake.length < opts.maxNew) toMake.push(order);
    else
      failed.push({
        id: order.id,
        reason: `1 回に作る数の上限（${opts.maxNew}）を超えた`,
      });
  });
  const results = await Promise.all(
    toMake.map(async (order) => {
      let job = inflight.get(order.id);
      if (!job) {
        job = makeOne(env, order, opts)
          .catch(
            (e): One => ({
              ok: false,
              reason: `unavailable: ${e instanceof Error ? e.message : String(e)}`,
            }),
          )
          .finally(() => inflight.delete(order.id));
        inflight.set(order.id, job);
      }
      return { order, result: await Promise.race([job, stop]) };
    }),
  );
  for (const { order, result } of results) {
    if (result === "aborted") failed.push({ id: order.id, reason: "止めた" });
    else if (result.ok) {
      done.set(order.id, result.part);
      logs.push(result.log);
    } else failed.push({ id: order.id, reason: result.reason });
  }
  return {
    parts: unique.flatMap((o) => done.get(o.id) ?? []),
    failed,
    logs,
  };
}
