import { GRADES, withinLevel } from "./grades";
import { poseVerbsIn, poseVerbsOf } from "./pose-verbs";
import {
  CHECKLIST_KINDS,
  type ChecklistItem,
  type GradeId,
  type Part,
  type PlanItem,
  type SceneSentences,
} from "./types";

// 生成した場面の裏取り（純粋な関数）。Claude が書いた英文・チェックリスト・部品を、コードで照らして確かめる。
// 確かめることの正本は docs/design/scene-protocol.md の「生成で確かめること（裏取り）」。
// 級の数は grades.ts、ポーズの動詞は pose-verbs.ts から取る

/**
 * 裏取りで落ちた理由。message は人が読める文で、作り直しの指示にもそのまま足す。
 * stage は直す段: sentences は 1 回目（英文）から、items は 2 回目（部品）だけ作り直せば直る
 */
export type Problem = {
  code:
    | "kind_count"
    | "duplicate_id"
    | "no_refs"
    | "ref_name"
    | "few_refs"
    | "accept_not_in_description"
    | "duplicate_key"
    | "unknown_part"
    | "ref_not_in_items"
    | "center_without_actor"
    | "verb_mismatch"
    | "verb_level";
  stage: "sentences" | "items";
  message: string;
};

/** refs の呼び名の形（英小文字で始まり、英小文字・数字・_ だけ） */
const REF_NAME = /^[a-z][a-z0-9_]*$/;

/** チェックリストの refs に出てくる呼び名（重ねない。出てきた順）。2 回目に key として渡す */
export const refNames = (checklist: ChecklistItem[]): string[] => [
  ...new Set(checklist.flatMap((c) => c.refs)),
];

/** 比べるための形にする（小文字にし、句読点と記号を空白にして詰める） */
export const normalizeText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** accept の言い方の一覧（" / " で区切った別の言い方を分ける） */
export const acceptWordings = (accept: string): string[] =>
  accept
    .split("/")
    .map(normalizeText)
    .filter((w) => w.length > 0);

/** accept が description に含まれるか。別の言い方があるときは、どれか 1 つが含まれればよい */
export const acceptInDescription = (accept: string, description: string) => {
  const text = ` ${normalizeText(description)} `;
  return acceptWordings(accept).some((w) => text.includes(` ${w} `));
};

/** 英文の部分（1 回目の出力）だけで確かめられること。部品を選ぶ前に落とせる */
export const verifySentences = (
  gradeId: GradeId,
  sentences: SceneSentences,
): Problem[] => {
  const grade = GRADES[gradeId];
  const problems: Problem[] = [];
  const add = (code: Problem["code"], message: string) =>
    problems.push({ code, stage: "sentences", message });

  for (const kind of CHECKLIST_KINDS) {
    const want = grade.checklist[kind];
    const got = sentences.checklist.filter((c) => c.kind === kind).length;
    if (got !== want) {
      add(
        "kind_count",
        `checklist の ${kind} が ${got} 個ある。${gradeId} は ${want} 個`,
      );
    }
  }

  const seen = new Set<string>();
  for (const c of sentences.checklist) {
    if (seen.has(c.id))
      add("duplicate_id", `checklist の id ${c.id} が重なっている`);
    seen.add(c.id);

    if (c.refs.length === 0) {
      add("no_refs", `項目 ${c.id} の refs が空`);
    }
    for (const r of c.refs) {
      if (!REF_NAME.test(r)) {
        add(
          "ref_name",
          `項目 ${c.id} の refs の「${r}」は呼び名の形でない（英小文字・数字・_ の短い語にする）`,
        );
      }
    }
    if (
      (c.kind === "reason" || c.kind === "link") &&
      new Set(c.refs).size < 2
    ) {
      add(
        "few_refs",
        `${c.kind} の項目 ${c.id} の refs が ${new Set(c.refs).size} 個。原因と行動の 2 つ以上が要る`,
      );
    }
    if (!acceptInDescription(c.accept, sentences.description)) {
      add(
        "accept_not_in_description",
        `項目 ${c.id} の accept「${c.accept}」が description に無い`,
      );
    }
  }
  return problems;
};

const isLiving = (part: Part) =>
  part.category === "person" || part.category === "animal";

/**
 * 部品（2 回目の出力）と照らして確かめること。
 * 中心の項目は、refs が指す人や動物のポーズの動詞が accept に出てくるか（食い違わないか）と、
 * その動詞が級の段階に入るかを見る。動詞は pose-verbs.ts の表の形（-s・-ing・-ed・不規則な形）で探す。
 * 見るのは動詞だけで、目的語や位置の関係（on the bench など）は確かめない
 */
export const verifyItems = (
  gradeId: GradeId,
  sentences: SceneSentences,
  items: PlanItem[],
  partList: Part[],
): Problem[] => {
  const grade = GRADES[gradeId];
  const parts = new Map(partList.map((p) => [p.id, p]));
  const problems: Problem[] = [];
  const add = (
    code: Problem["code"],
    stage: Problem["stage"],
    message: string,
  ) => problems.push({ code, stage, message });

  const byKey = new Map<string, PlanItem>();
  for (const item of items) {
    if (byKey.has(item.key)) {
      add("duplicate_key", "items", `items の key ${item.key} が重なっている`);
    } else {
      byKey.set(item.key, item);
    }
    if (!parts.has(item.part)) {
      add(
        "unknown_part",
        "items",
        `items の ${item.key} の部品 ${item.part} が一覧に無い`,
      );
    }
  }

  for (const c of sentences.checklist) {
    const missing = [...new Set(c.refs)].filter((r) => !byKey.has(r));
    for (const r of missing) {
      add(
        "ref_not_in_items",
        "items",
        `refs の ${r}（項目 ${c.id}）が items の key に無い`,
      );
    }
    if (c.kind !== "center" || missing.length > 0) continue;

    const actors = c.refs
      .map((r) => ({ key: r, part: parts.get(byKey.get(r)?.part ?? "") }))
      .filter((a): a is { key: string; part: Part } => !!a.part)
      .filter((a) => isLiving(a.part));
    if (actors.length === 0) {
      add(
        "center_without_actor",
        "sentences",
        `center の項目 ${c.id} の refs（${c.refs.join(", ")}）に人や動物がいない。center は誰が何をしているかにする`,
      );
      continue;
    }
    const said = actors.flatMap((a) => poseVerbsIn(c.accept, a.part));
    if (said.length === 0) {
      const shown = actors
        .map(
          (a) =>
            `${a.key} の部品 ${a.part.id}（${poseVerbsOf(a.part)
              .map((v) => v.verb)
              .join(", ")}）`,
        )
        .join("、");
      add(
        "verb_mismatch",
        "items",
        `center の項目 ${c.id} の accept「${c.accept}」の動詞が、部品のポーズと合わない。${shown}`,
      );
      continue;
    }
    if (!said.some((v) => withinLevel(v.level, grade.cefr))) {
      add(
        "verb_level",
        "sentences",
        `center の項目 ${c.id} の動詞（${said.map((v) => `${v.verb} は ${v.level}`).join("、")}）が級の範囲に無い。${gradeId} の中心の動作は CEFR-J ${grade.cefr} まで`,
      );
    }
  }
  return problems;
};

/** 英文と部品の両方を確かめる。空なら通った */
export const verifyScene = (
  gradeId: GradeId,
  plan: SceneSentences & { items: PlanItem[] },
  parts: Part[],
): Problem[] => [
  ...verifySentences(gradeId, plan),
  ...verifyItems(gradeId, plan, plan.items, parts),
];
