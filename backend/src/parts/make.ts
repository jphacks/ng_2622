import type Anthropic from "@anthropic-ai/sdk";
import type { Part } from "../scenes/types";
import { buildMesh, topHeight, toUsdz } from "./build";
import { checkBuilt, type Problem, parseRecipe } from "./check";
import { type Recipe, RecipeAnswerSchema, toTraceOps } from "./recipe";
import {
  callRecipe,
  costOf,
  type Order,
  orderMessage,
  type PartsClaudeEnv,
  PartWriteError,
  retryMessage,
  type WriteDeps,
} from "./write";

// 部品 1 つを作る: Claude に部品表を書かせ → 確かめ → 組み → 検査。落ちたら理由を付けて 1 回だけ書き直させる。
// R2 には触らない（置くのは workshop.ts）

/** 作った部品の記録（R2 の recipes/<id>/<version>.json） */
export type RecipeRecord = {
  id: string;
  version: number;
  order: Order;
  ops: Recipe["ops"];
  model: string;
  /** 呼んだ回ごとの時間と費用と、落ちた理由 */
  attempts: {
    ms: number;
    usd: number;
    usage: Anthropic.Usage;
    problems: Problem[];
  }[];
  tris: number;
  createdAt: string;
};

export type MakeOutcome =
  | {
      ok: true;
      meta: Part;
      usdz: Uint8Array;
      record: RecipeRecord;
    }
  | {
      ok: false;
      kind: "refused" | "invalid" | "unavailable";
      reason: string;
      /** 呼んだ回の費用の合計（USD） */
      usd: number;
      /** signal で止めたので作れなかった */
      aborted?: boolean;
    };

/** 部品のメタデータ（index.json の 1 件と同じ形） */
export const metaOf = (
  order: Order,
  version: number,
  size: [number, number, number],
  top: number | undefined,
): Part => ({
  id: order.id,
  version,
  file: `parts/${order.id}/${version}.usdz`,
  category: order.category,
  words: order.words.map((word) => ({ word, pos: "noun" })),
  size: size.map((v) => Math.round(v * 1000) / 1000) as [
    number,
    number,
    number,
  ],
  label: order.label,
  ...(top !== undefined ? { anchors: { top } } : {}),
});

export async function makePart(
  env: PartsClaudeEnv,
  order: Order,
  version: number,
  deps: WriteDeps & { now?: () => number } = {},
  options: {
    timeoutMs?: number;
    maxAttempts?: number;
    signal?: AbortSignal;
  } = {},
): Promise<MakeOutcome> {
  const maxAttempts = options.maxAttempts ?? 2;
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: orderMessage(order) },
  ];
  const attempts: RecipeRecord["attempts"] = [];
  const usd = () => attempts.reduce((n, a) => n + a.usd, 0);
  let last: { kind: "invalid" | "unavailable"; reason: string } = {
    kind: "invalid",
    reason: "",
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) break;
    let call: Awaited<ReturnType<typeof callRecipe>>;
    try {
      call = await callRecipe(env, messages, deps, options);
    } catch (e) {
      const err =
        e instanceof PartWriteError
          ? e
          : new PartWriteError("unavailable", String(e));
      // 応答が返ってから落ちた回（断った・途中で止まった・JSON でない）も費用に数える
      if (err.spent)
        attempts.push({
          ms: err.spent.ms,
          usd: costOf(err.spent.usage),
          usage: err.spent.usage,
          problems: [{ code: "schema", message: err.message }],
        });
      if (err.kind === "refused")
        return { ok: false, kind: "refused", reason: err.message, usd: usd() };
      last = { kind: err.kind, reason: err.message };
      // 形が変・途中で止まったときだけもう 1 回。API の失敗・遅すぎはやり直さない（時間の上限がある）
      if (err.kind === "unavailable") break;
      continue;
    }
    const answer = RecipeAnswerSchema.safeParse(call.json);
    const record = {
      ms: call.ms,
      usd: costOf(call.usage),
      usage: call.usage,
      problems: [] as Problem[],
    };
    attempts.push(record);
    if (!answer.success) {
      last = { kind: "invalid", reason: "Claude の答えの形が違う" };
      continue;
    }
    if (answer.data.decision === "refuse") {
      return {
        ok: false,
        kind: "refused",
        reason: `作らない注文: ${answer.data.reason}`,
        usd: usd(),
      };
    }
    const parsed = parseRecipe(answer.data.ops);
    let problems = parsed.problems;
    let built: ReturnType<typeof buildMesh> | undefined;
    if (parsed.recipe) {
      try {
        built = buildMesh(toTraceOps(parsed.recipe));
        problems = checkBuilt(built, order);
      } catch (e) {
        problems = [
          {
            code: "schema",
            message: `the recipe could not be built: ${e instanceof Error ? e.message : String(e)}`,
          },
        ];
      }
    }
    record.problems = problems;
    if (parsed.recipe && built && problems.length === 0) {
      const top = order.top ? topHeight(built) : undefined;
      return {
        ok: true,
        meta: metaOf(order, version, built.size, top),
        usdz: toUsdz(order.id, built),
        record: {
          id: order.id,
          version,
          order,
          ops: parsed.recipe.ops,
          model: call.model,
          attempts,
          tris: built.tris,
          createdAt: new Date((deps.now ?? Date.now)()).toISOString(),
        },
      };
    }
    last = {
      kind: "invalid",
      reason: `検査に落ちた: ${problems.map((p) => p.code).join(", ")}`,
    };
    messages.push(
      { role: "assistant", content: call.text },
      { role: "user", content: retryMessage(problems) },
    );
  }
  if (options.signal?.aborted)
    return {
      ok: false,
      kind: "unavailable",
      reason: "止めた",
      usd: usd(),
      aborted: true,
    };
  return { ok: false, kind: last.kind, reason: last.reason, usd: usd() };
}
