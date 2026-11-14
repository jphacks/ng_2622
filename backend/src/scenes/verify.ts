import { footprint } from "./compose";
import { composeLayoutV2 } from "./compose-v2";
import { GRADES, withinLevel } from "./grades";
import {
  partsByWho,
  poseVerbsIn,
  poseVerbsOf,
  subjectIn,
  VERB_LEVELS,
  verbForms,
  verbsIn,
  whoOf,
  wordsOf,
} from "./pose-verbs";
import {
  CHECKLIST_KINDS,
  type ChecklistItem,
  type GradeId,
  type Part,
  type PlanItem,
  type SceneLayoutV2,
  type SceneSentences,
  type Vec3,
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
    | "sentence_count"
    | "sentence_number"
    | "sentence_shared"
    | "duplicate_id"
    | "no_refs"
    | "ref_name"
    | "few_refs"
    | "accept_not_in_description"
    | "accept_no_verb"
    | "accept_no_subject"
    | "accept_pronoun"
    | "duplicate_accept"
    | "who_cannot"
    | "on_the_wall"
    | "who_mismatch"
    | "clause_action"
    | "held_missing"
    | "wall_thing"
    | "out_of_view"
    | "action_mismatch"
    | "place_mismatch"
    | "held_thing"
    | "rain_indoors"
    | "duplicate_key"
    | "unknown_part"
    /** ID の規約で引く道: 作る物の注文が規約の形でない・作れない物 */
    | "bad_part_order"
    /** ID の規約で引く道: 部品の無い物が 1 場面の上限を超えた */
    | "too_many_new_parts"
    | "ref_not_in_items"
    | "people_count"
    | "center_without_actor"
    | "actor_twice"
    | "reason_without_actor"
    | "verb_mismatch"
    | "verb_level"
    /** 応答が JSON でない・形が違う・途中で止まった（作り置きの道で、作り直しの理由にする） */
    | "invalid_response";
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

// accept の形を見るための語。動詞があるか・主語から始まるかを、語の一覧で粗く見る
const BE_VERBS = [
  "is",
  "are",
  "was",
  "were",
  "am",
  "be",
  "been",
  "has",
  "have",
];
const ALL_VERB_FORMS = new Set([
  ...BE_VERBS,
  ...Object.keys(VERB_LEVELS).flatMap((v) => [...verbForms(v)]),
]);
/** 文の切れ端の始まり方（前置詞・接続詞）。主語から始まっていない */
const FRAGMENT_STARTS = new Set([
  "to",
  "with",
  "on",
  "in",
  "at",
  "under",
  "next",
  "behind",
  "near",
  "by",
  "from",
  "into",
  "across",
  "along",
  "for",
  "of",
  "because",
  "so",
  "and",
  "but",
  "while",
  "when",
]);
const PRONOUNS = new Set(["he", "she", "it", "they", "we", "i", "you"]);
/** 天気の it（it is raining）は、detail の主語にしてよい */
const WEATHER_IT =
  /^it (is|was) (raining|snowing|sunny|rainy|cloudy|windy|snowy|hot|cold|dark)\b/;

/** accept の言い方（" / " で分けて比べる形にしたもの）のうち、a が b と同じか、b にそのまま含まれるものがあるか */
const saidWithin = (a: string, b: string) =>
  acceptWordings(a).some((wa) =>
    acceptWordings(b).some((wb) => ` ${wb} `.includes(` ${wa} `)),
  );

/**
 * 英文の部分（1 回目の出力）だけで確かめられること。部品を選ぶ前に落とせる。
 * parts を渡すと、center の主語の人や動物にその動作ができるか（その見た目にそのポーズの部品があるか）も見る
 */
export const verifySentences = (
  gradeId: GradeId,
  sentences: SceneSentences,
  parts?: Part[],
): Problem[] => {
  const grade = GRADES[gradeId];
  const problems: Problem[] = [];
  const add = (code: Problem["code"], message: string) =>
    problems.push({ code, stage: "sentences", message });
  const byWho = parts ? partsByWho(parts) : undefined;

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

    // accept の形（1 つ目の言い方）: 主語と動詞のある 1 つの事実か
    const words = wordsOf(c.accept.split("/")[0]);
    const start = words[0] ?? "";
    if (!words.some((w) => ALL_VERB_FORMS.has(w) || /(ing|ed)$/.test(w))) {
      add(
        "accept_no_verb",
        `項目 ${c.id} の accept「${c.accept}」に動詞が無い。主語と動詞のある 1 つの事実にする`,
      );
    } else if (FRAGMENT_STARTS.has(start) || start.endsWith("ing")) {
      add(
        "accept_no_subject",
        `項目 ${c.id} の accept「${c.accept}」が主語から始まっていない。主語と動詞のある 1 つの事実にする`,
      );
    } else if (
      PRONOUNS.has(start) &&
      !(c.kind === "detail" && WEATHER_IT.test(normalizeText(c.accept)))
    ) {
      add(
        "accept_pronoun",
        `${c.kind} の項目 ${c.id} の accept「${c.accept}」の主語が代名詞（${start}）。a girl のように名詞で書く（description のその文も）`,
      );
    }

    // 同じ事実を 2 つの項目にしていないか。center どうし・detail と center・detail どうしを比べる。
    // reason・link が center の文を含むのは決まりどおりなので比べない。
    // detail が center に場所を足した文（a woman has fallen down on the sidewalk）は、長いほうなので落とさない
    if (c.kind === "center" || c.kind === "detail") {
      const same = sentences.checklist.find(
        (o) =>
          o !== c &&
          (o.kind === "center" || o.kind === "detail") &&
          (c.kind === "detail"
            ? saidWithin(c.accept, o.accept)
            : o.kind === "center" &&
              sentences.checklist.indexOf(o) < sentences.checklist.indexOf(c) &&
              saidWithin(c.accept, o.accept) &&
              saidWithin(o.accept, c.accept)),
      );
      if (same) {
        add(
          "duplicate_accept",
          `${c.kind} の項目 ${c.id} の accept「${c.accept}」が、項目 ${same.id} の accept と同じか、その一部。項目ごとに別の事実にする`,
        );
      }
    }

    // center の主語の人に、その動作ができるか（動作の一覧の「できる人」）
    if (c.kind === "center" && byWho) {
      const who = subjectIn(c.accept, [...byWho.keys()]);
      const said = verbsIn(c.accept);
      if (who && said.length > 0) {
        const can = (byWho.get(who) ?? []).some((p) =>
          poseVerbsOf(p).some((v) => said.includes(v.verb)),
        );
        if (!can) {
          const others = [...byWho]
            .filter(([, list]) =>
              list.some((p) =>
                poseVerbsOf(p).some((v) => said.includes(v.verb)),
              ),
            )
            .map(([w]) => w);
          add(
            "who_cannot",
            `center の項目 ${c.id}: ${who} にできる動作に ${said.join("・")} が無い（できるのは ${others.length ? others.join(", ") : "誰もいない"}）。できる人に替えるか、${who} にできる動作にする`,
          );
        }
      }
    }
  }
  return problems;
};

/**
 * 英文の人の呼び方と、それに合う部品の見た目（部品の words の先頭）。
 * 同じ枠の言い換え（tall boy と boy、man と old man、mother と woman）は通し、子どもと大人・男と女の取り違えを落とす。
 * 仕事の呼び方（waiter・clerk・doctor）は男女が決まらないので、大人ならどれでもよい
 */
const ADULT_ROLES = ["waiter", "clerk", "doctor"];
export const PERSON_NOUNS: Record<string, readonly string[]> = {
  boy: ["boy"],
  "tall boy": ["boy"],
  "little boy": ["boy"],
  student: ["boy", "girl"],
  child: ["boy", "girl"],
  kid: ["boy", "girl"],
  girl: ["girl"],
  "little girl": ["girl"],
  man: ["man", "old man", ...ADULT_ROLES],
  father: ["man", "old man"],
  "old man": ["old man"],
  grandfather: ["old man"],
  woman: ["woman", "old woman", ...ADULT_ROLES],
  mother: ["woman"],
  lady: ["woman", "old woman"],
  "old woman": ["old woman"],
  grandmother: ["old woman"],
  waiter: ["waiter", "man", "woman"],
  waitress: ["waiter", "woman"],
  clerk: ["clerk", "man", "woman"],
  doctor: ["doctor", "man", "woman"],
  teacher: ["man", "woman", "old man", "old woman"],
  dog: ["dog"],
  bird: ["bird"],
};

/** 呼び方が合う部品か（部品の見た目が、その呼び方の枠に入るか） */
export const nounFits = (noun: string, part: Pick<Part, "id" | "words">) =>
  (PERSON_NOUNS[noun] ?? []).includes(whoOf(part));

// 節に分ける所（理由・目的・別の主語の文）。because・so の後ろも、その主語の人の動作として照らす
const CLAUSE_SPLIT = /,|;|\b(?:because|so that|so|while|when|but|and then)\b/i;
const DETERMINERS = new Set([
  "a",
  "an",
  "the",
  "another",
  "one",
  "two",
  "three",
  "other",
  "this",
  "that",
  "his",
  "her",
  "their",
  "some",
]);
const BE = new Set(["is", "are", "was", "were", "am", "s"]);
const STILL = new Set(["also", "still", "now", "just", "not", "always"]);

/**
 * 節（主語で始まる文の一部）の主語の呼び方と、その人の動作の動詞。
 * 主語は節の先頭（a・the などの後）の人の呼び方。動作は be の後の -ing、has の後の過去分詞、
 * それに and でつないだ -ing（"is sitting on a sofa and reading" の reading）。to の後（目的）は数えない
 */
export const clauseAction = (
  clause: string,
): { noun: string; verbs: string[] } | undefined => {
  const words = wordsOf(clause);
  let i = 0;
  while (i < words.length && DETERMINERS.has(words[i])) i++;
  const nouns = Object.keys(PERSON_NOUNS).sort(
    (a, b) => b.split(" ").length - a.split(" ").length,
  );
  const noun = nouns.find((n) =>
    n
      .split(" ")
      .every((t, k) => words[i + k] === t || words[i + k] === `${t}s`),
  );
  if (!noun) return undefined;
  const formOf = new Map<string, string>();
  for (const v of Object.keys(VERB_LEVELS)) {
    for (const f of verbForms(v)) if (!formOf.has(f)) formOf.set(f, v);
  }
  const verbs: string[] = [];
  let acting = false;
  for (let k = i + noun.split(" ").length; k < words.length; k++) {
    const w = words[k];
    if (BE.has(w) || w === "has" || w === "have") {
      let n = k + 1;
      while (STILL.has(words[n])) n++;
      const next = words[n] ?? "";
      const verb = formOf.get(next);
      const progressive = BE.has(w) && next.endsWith("ing");
      const perfect = !BE.has(w) && verb !== undefined && next !== verb;
      if (verb && (progressive || perfect) && words[n - 1] !== "to") {
        verbs.push(verb);
        acting = true;
      }
      k = n;
    } else if (acting && (w === "and" || w === "or")) {
      const next = words[k + 1] ?? "";
      const verb = formOf.get(next);
      if (verb && next.endsWith("ing")) {
        verbs.push(verb);
        k++;
      }
    }
  }
  return { noun, verbs: [...new Set(verbs)] };
};

/** description を文と節に分ける */
export const clausesOf = (description: string): string[] =>
  description
    .split(/(?<=[.!?])\s+/)
    .flatMap((t) => t.split(CLAUSE_SPLIT))
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

const isLiving = (part: Part) =>
  part.category === "person" || part.category === "animal";

/**
 * 部品（2 回目の出力）と照らして確かめること。
 * 人と動物の数が級の範囲か、reason・link が行動する人を指すかを見る。
 * 中心の項目は、同じ人が 2 つの項目の主役になっていないか、
 * refs が指す人や動物のポーズの動詞が accept に出てくるか（食い違わないか）、その動詞が級の段階に入るかを見る。動詞は pose-verbs.ts の表の形（-s・-ing・-ed・不規則な形）で探す。
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

  // 人の数（動物も 1 人と数える）。英文に出てこない人を足しても、ここで落ちる
  const people = items.filter((i) => {
    const part = parts.get(i.part);
    return !!part && isLiving(part);
  });
  if (people.length < grade.people.min || people.length > grade.people.max) {
    const want =
      grade.people.min === grade.people.max
        ? `${grade.people.min}`
        : `${grade.people.min}〜${grade.people.max}`;
    add(
      "people_count",
      "sentences",
      `人と動物が ${people.length}（${people.map((i) => i.key).join(", ")}）。${gradeId} は ${want}`,
    );
  }

  // 屋内（床の部品）に雨を置いていないか
  const rainy = items.some((i) => i.part === "rain");
  const floor = items.find((i) => i.part.startsWith("floor_"));
  if (rainy && floor) {
    add(
      "rain_indoors",
      /\brain/i.test(sentences.description) ? "sentences" : "items",
      `屋内の床（${floor.part}）の場面に雨（rain）がある。雨は屋外の場面だけにし、屋内では雨を理由にしない`,
    );
  }

  // 人が持っている物（部品の holds）を、別の部品としてもう一度置いていないか。
  // 落とすのは、その物がどの項目の refs にも無いとき（2 回目が足した）と、
  // その物を指す項目が全部、持っている人も指しているとき（1 回目が持ち物を呼び名にした）。
  // 持っている人と関係の無い項目が指す物（テーブルの上の別のカップなど）は落とさない
  for (const holder of items) {
    const holderPart = parts.get(holder.part);
    if (!holderPart?.holds || !isLiving(holderPart)) continue;
    const held = new Set(
      wordsOf(holderPart.holds).flatMap((w) => [w, w.replace(/s$/, "")]),
    );
    for (const thing of items) {
      const thingPart = parts.get(thing.part);
      if (!thingPart || isLiving(thingPart)) continue;
      if (thingPart.category !== "thing" && thingPart.category !== "food")
        continue;
      if (holderPart.uses?.includes(thingPart.id)) continue;
      const same = thingPart.words.some(
        (w) => w.pos === "noun" && held.has(w.word),
      );
      if (!same) continue;
      const pointing = sentences.checklist.filter((c) =>
        c.refs.includes(thing.key),
      );
      if (pointing.length === 0) {
        add(
          "held_thing",
          "items",
          `${holder.key} の部品 ${holder.part} は ${holderPart.holds} を持っている。別の部品 ${thing.key}（${thing.part}）を置かない`,
        );
      } else if (pointing.every((c) => c.refs.includes(holder.key))) {
        add(
          "held_thing",
          "sentences",
          `${holder.key} が持っている ${holderPart.holds} を、refs の呼び名 ${thing.key}（項目 ${pointing.map((c) => c.id).join(", ")}）にしている。持っている物は呼び名にせず、持っている人だけを書く`,
        );
      }
    }
  }

  // 呼び方と人の部品の見た目。項目の主語の呼び方と、項目が指す人や動物の部品を照らす。
  // どれか 1 人でも呼び方が合えばよい（理由やつながりは 2 人を指すので）
  for (const c of sentences.checklist) {
    const found = clauseAction(c.accept.split("/")[0]);
    if (!found) continue;
    const living = c.refs
      .map((r) => ({ key: r, part: parts.get(byKey.get(r)?.part ?? "") }))
      .filter(
        (a): a is { key: string; part: Part } => !!a.part && isLiving(a.part),
      );
    if (living.length === 0 || living.some((a) => nounFits(found.noun, a.part)))
      continue;
    add(
      "who_mismatch",
      "items",
      `項目 ${c.id} は ${found.noun} のことだが、refs の ${living
        .map((a) => `${a.key} の部品 ${a.part.id}（${whoOf(a.part)}）`)
        .join(
          "、",
        )} は ${found.noun} の見た目ではない。${found.noun} に合う人の部品を選ぶ（${(PERSON_NOUNS[found.noun] ?? []).join("・")} の部品）`,
    );
  }

  // 見本の答えの各節の動作が、その主語の人のポーズで言えるか（"sitting on a sofa and reading" の reading、
  // because の後ろの原因の人の動作も）。主語は呼び方の合う人。合う人が何人かいれば、誰か 1 人が言えればよい
  // 項目の言い方で確かめ済みの節（center・detail の言い方、reason の because より前、link の全部）は見ない（同じ理由を重ねて出さない）
  const covered = sentences.checklist.map((c) => {
    const wording = c.accept.split("/")[0];
    return ` ${normalizeText(c.kind === "reason" ? wording.split(/\bbecause\b/i)[0] : wording)} `;
  });
  for (const clause of clausesOf(sentences.description)) {
    const found = clauseAction(clause);
    if (!found || found.verbs.length === 0) continue;
    if (covered.some((c) => c.includes(` ${normalizeText(clause)} `))) continue;
    const who = people
      .map((i) => ({ key: i.key, part: parts.get(i.part) as Part }))
      .filter((a) => nounFits(found.noun, a.part));
    if (who.length === 0) continue;
    const can = (part: Part) => {
      const said = poseVerbsOf(part).map((v) => v.verb);
      return found.verbs.every((v) => said.includes(v));
    };
    if (who.some((a) => can(a.part))) continue;
    // その呼び方の部品のどれかで言えるなら部品の選び直し、言える部品が無ければ英文を書き直す
    const other = partList.some(
      (p) => isLiving(p) && nounFits(found.noun, p) && can(p),
    );
    add(
      "clause_action",
      other ? "items" : "sentences",
      `見本の答えの「${clause}」の動作（${found.verbs.join("・")}）が、${who
        .map(
          (a) =>
            `${a.key} の部品 ${a.part.id}（${poseVerbsOf(a.part)
              .map((v) => v.verb)
              .join(", ")}）`,
        )
        .join("、")} のポーズで言えない。${
        other
          ? `${found.noun} の部品を、その動作を全部言えるものにする`
          : "1 人につき動作は 1 つ。その人の部品で言える動作だけを書く"
      }`,
    );
  }

  const whoOfItem = (i: PlanItem) => whoOf(parts.get(i.part) as Part);
  const livingRefs = (c: ChecklistItem) =>
    c.refs
      .map((r) => ({ key: r, part: parts.get(byKey.get(r)?.part ?? "") }))
      .filter((a): a is { key: string; part: Part } => !!a.part)
      .filter((a) => isLiving(a.part));
  /** center の主役（refs の先頭の人や動物）と、その項目の id */
  const actorOf = new Map<string, string>();

  for (const c of sentences.checklist) {
    const missing = [...new Set(c.refs)].filter((r) => !byKey.has(r));
    for (const r of missing) {
      add(
        "ref_not_in_items",
        "items",
        `refs の ${r}（項目 ${c.id}）が items の key に無い`,
      );
    }
    if (missing.length > 0) continue;
    const actors = livingRefs(c);
    // 壁に掛ける関係は無い。壁そのもの（黒板・窓つきの壁）以外を「壁にある」と言っていないか
    const wording = c.accept.split("/")[0];
    if (/\bon the (\w+ )?wall\b/i.test(wording)) {
      const loose = c.refs.filter(
        (r) => parts.get(byKey.get(r)?.part ?? "")?.category !== "building",
      );
      if (loose.length > 0) {
        add(
          "on_the_wall",
          "sentences",
          `項目 ${c.id} の accept「${c.accept}」は ${loose.join(", ")} が壁にあると言うが、物を壁に掛けることはできない（壁に付いているのは、背景の壁の黒板・窓・棚だけ）。別の細部にする`,
        );
      }
    }

    /** 文の主語の人（呼び方が合う refs の人）。分からなければ refs の先頭の人や動物 */
    const subjectOf = (text: string) => {
      const who = subjectIn(text, [...new Set(people.map(whoOfItem))]);
      return actors.find((a) => whoOf(a.part) === who);
    };
    if (c.kind === "reason" || c.kind === "link") {
      // 原因と行動のうち、行動する人がいるか。原因が見える物かどうか（因果の中身）は確かめられない
      if (actors.length === 0) {
        add(
          "reason_without_actor",
          "sentences",
          `${c.kind} の項目 ${c.id} の refs（${c.refs.join(", ")}）に、行動する人や動物がいない`,
        );
        continue;
      }
      // 行動の動詞が、その人のポーズで言えるか。reason は because より前、link は文の全部を見る
      const action =
        c.kind === "reason" ? wording.split(/\bbecause\b/i)[0] : wording;
      const actor = subjectOf(action) ?? actors[0];
      if (
        verbsIn(action).length > 0 &&
        poseVerbsIn(action, actor.part).length === 0
      ) {
        add(
          "action_mismatch",
          "sentences",
          `${c.kind} の項目 ${c.id} の行動「${action.trim()}」の動詞（${verbsIn(action).join("・")}）が、${actor.key} の部品 ${actor.part.id} のポーズ（${poseVerbsOf(
            actor.part,
          )
            .map((v) => v.verb)
            .join(
              ", ",
            )}）に無い。理由の行動は、その人の center の動作と同じにする`,
        );
      }
      continue;
    }
    if (c.kind === "detail") {
      // 人が主語の detail（the woman is drinking from a cup）は、その人のポーズで言える動作か
      const actor = subjectOf(wording);
      if (
        actor &&
        verbsIn(wording).length > 0 &&
        poseVerbsIn(wording, actor.part).length === 0
      ) {
        add(
          "action_mismatch",
          "sentences",
          `detail の項目 ${c.id} の accept「${c.accept}」の動詞（${verbsIn(wording).join("・")}）が、${actor.key} の部品 ${actor.part.id} のポーズ（${poseVerbsOf(
            actor.part,
          )
            .map((v) => v.verb)
            .join(
              ", ",
            )}）に無い。1 人につき動作は 1 つなので、2 つ目の動作を detail にしない`,
        );
      }
      continue;
    }

    if (actors.length === 0) {
      add(
        "center_without_actor",
        "sentences",
        `center の項目 ${c.id} の refs（${c.refs.join(", ")}）に人や動物がいない。center は誰が何をしているかにする`,
      );
      continue;
    }
    // 1 人につき動作は 1 つ。同じ人が 2 つの center の主役になっていないか
    const actor = actors[0].key;
    const before = actorOf.get(actor);
    if (before) {
      add(
        "actor_twice",
        "sentences",
        `${actor} が center の項目 ${before} と ${c.id} の両方の主役になっている。1 人につき動作は 1 つにし、2 つ目は detail にするか別の人にする`,
      );
    } else {
      actorOf.set(actor, c.id);
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

/**
 * 座標に直してから確かめること。「on the sidewalk」のように地面の部品の上にいると言う項目で、
 * その人や物が、実際にはその上に重ねた別の地面（歩道の上の道路）に載っていないか。
 * 見るのは、refs に地面の部品があり、accept に on・across・along があって、next to・near などが無い項目だけ。
 * 裏取り（verifyItems）を通った plan を渡す。座標に直せなければ何も返さない
 */
export const verifyPlaces = (
  gradeId: GradeId,
  plan: SceneSentences & { items: PlanItem[] },
  partList: Part[],
): Problem[] => verifyPlacesWithLayout(gradeId, plan, partList).problems;

/**
 * verifyPlaces と同じ。確かめるのに座標に直した配置（id は "check"）も返す（座標に直せなければ undefined）。
 * 座標の計算（compose.ts）は CPU を多く使うので、通った場面はこの配置の id を替えて使い、もう一度計算しない
 */
export const verifyPlacesWithLayout = (
  gradeId: GradeId,
  plan: SceneSentences & { items: PlanItem[] },
  partList: Part[],
): { problems: Problem[]; layout?: SceneLayoutV2 } => {
  const parts = new Map(partList.map((p) => [p.id, p]));
  let layout: ReturnType<typeof composeLayoutV2>;
  try {
    layout = composeLayoutV2(plan, partList, { id: "check", grade: gradeId });
  } catch {
    return { problems: [] };
  }
  const placed = new Map(layout.items.map((i) => [i.key, i]));
  const grounds = layout.items.filter(
    (i) => parts.get(i.part)?.category === "ground",
  );
  /** その点の真下にある地面のうち、いちばん小さいもの（広い地面の上に重ねた道路など） */
  const groundUnder = (x: number, z: number) =>
    grounds
      .filter((g) => {
        const size = (parts.get(g.part) as Part).size;
        const { hx, hz } = footprint(size, g.yaw ?? 0);
        return (
          Math.abs(x - g.position[0]) <= hx && Math.abs(z - g.position[2]) <= hz
        );
      })
      .sort((a, b) => {
        const area = (i: typeof a) => {
          const size = (parts.get(i.part) as Part).size;
          return size[0] * size[2];
        };
        return area(a) - area(b);
      })[0];

  const problems: Problem[] = [];
  for (const c of plan.checklist) {
    const wording = c.accept.split("/")[0];
    if (!/\b(on|across|along)\b/i.test(wording)) continue;
    if (/\b(next to|near|beside|in front of|behind|outside)\b/i.test(wording))
      continue;
    const isGround = (r: string) =>
      parts.get(placed.get(r)?.part ?? "")?.category === "ground";
    const said = c.refs.filter(isGround);
    const subject = placed.get(c.refs.find((r) => !isGround(r)) ?? "");
    if (said.length === 0 || !subject) continue;
    const under = groundUnder(subject.position[0], subject.position[2]);
    if (under && !said.includes(under.key)) {
      problems.push({
        code: "place_mismatch",
        stage: "items",
        message: `項目 ${c.id} の accept「${c.accept}」は ${subject.key} が ${said.join(", ")} の上にいると言うが、置いた位置は ${under.key}（${under.part}）の上。${subject.key} を ${said.join(", ")} の上に置く`,
      });
    }
  }
  problems.push(...verifyView(plan, layout.items, partList));
  problems.push(...verifyHeld(plan, layout.items, partList));
  return { problems, layout };
};

// ---------- 絵で見えるか（座標に直した場面を、絵と同じカメラから見る） ----------

/**
 * 絵（scripts/scene/render_layout.py）と同じカメラ。注視点 (0, 0.6, 0)、見下ろす角度 28 度、距離 17.5 m、
 * 3D の欄は 1280 x 672 px で、縦 960 px が 30 度の見え方。画面は、カメラから 1 m の所の大きさ（tan）で表す
 */
const CAMERA = (() => {
  const tilt = (28 * Math.PI) / 180;
  const target: Vec3 = [0, 0.6, 0];
  const distance = 17.5;
  const px = (2 * Math.tan((15 * Math.PI) / 180)) / 960;
  return {
    eye: [
      target[0],
      target[1] + distance * Math.sin(tilt),
      target[2] + distance * Math.cos(tilt),
    ] as Vec3,
    forward: [0, -Math.sin(tilt), -Math.cos(tilt)] as Vec3,
    up: [0, Math.cos(tilt), -Math.sin(tilt)] as Vec3,
    halfWidth: (px * 1280) / 2,
    halfHeight: (px * 672) / 2,
  };
})();

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 場面の点を画面に写す（右・上が正。depth はカメラからの奥行き） */
export const project = (p: Vec3) => {
  const v: Vec3 = [
    p[0] - CAMERA.eye[0],
    p[1] - CAMERA.eye[1],
    p[2] - CAMERA.eye[2],
  ];
  const depth = dot(v, CAMERA.forward);
  return { x: v[0] / depth, y: dot(v, CAMERA.up) / depth, depth };
};

/** 壁に付けるものとして作った部品（床に立てると、部屋の真ん中に窓や時計が立つ） */
const WALL_THINGS = new Set(["window", "door", "clock"]);
/** 壁ぎわとみる、背景の壁の手前の面からの距離（m）。奥の区画の列に置いたものは通す */
const NEAR_WALL = 1.2;

/**
 * 座標に直した場面を、絵と同じカメラから見て確かめる。
 * - wall_thing: 窓・扉・時計が、背景の壁から離れて床に立っている（屋外の窓・時計は、付ける壁が無い）
 * - out_of_view: 項目が指す物や人の真ん中が、絵の外にある（木の上の風船など）
 * 人が人や家具に隠れているかは、四角で見積もると、人が判断した「通す」「落とす」と分けられなかったので確かめない（指示で止める）
 */
export const verifyView = (
  plan: SceneSentences,
  placedItems: {
    key: string;
    part: string;
    position: Vec3;
    yaw?: number;
    scale?: number;
  }[],
  partList: Part[],
): Problem[] => {
  const parts = new Map(partList.map((p) => [p.id, p]));
  const problems: Problem[] = [];
  const named = new Set(plan.checklist.flatMap((c) => c.refs));
  const items = placedItems
    .map((i) => ({ ...i, info: parts.get(i.part.split("@")[0]) }))
    .filter((i): i is typeof i & { info: Part } => !!i.info);
  const backdrop = items.find(
    (i) =>
      i.info.category === "building" &&
      Math.max(i.info.size[0], i.info.size[2]) >= 8 - 1e-6,
  );

  for (const i of items) {
    if (!WALL_THINGS.has(i.info.id)) continue;
    if (backdrop) {
      const wallFront = backdrop.position[2] + backdrop.info.size[2] / 2;
      const { hz } = footprint(i.info.size, i.yaw ?? 0);
      if (i.position[2] - hz - wallFront < NEAR_WALL) continue;
    } else if (i.info.id === "door") continue;
    problems.push({
      code: "wall_thing",
      stage: named.has(i.key) ? "sentences" : "items",
      message: `${i.key}（${i.info.id}）が、${backdrop ? "背景の壁から離れて部屋の中の" : "付ける壁の無い所の"}床に立っている。窓・扉・時計は壁ぎわ（奥の区画で、背景の壁の前）にだけ置く。屋内の窓は背景の壁の窓で足りる${named.has(i.key) ? "（英文で言うなら、壁ぎわに置く）" : ""}`,
    });
  }

  for (const i of items) {
    if (!named.has(i.key) || i.info.category === "ground") continue;
    if (i.info.category === "building" && i.info.size[0] >= 8 - 1e-6) continue;
    const h = i.info.size[1] * (i.scale ?? 1);
    const c = project([i.position[0], i.position[1] + h / 2, i.position[2]]);
    if (Math.abs(c.x) > CAMERA.halfWidth || Math.abs(c.y) > CAMERA.halfHeight) {
      problems.push({
        code: "out_of_view",
        stage: "items",
        message: `${i.key}（${i.info.id}）が絵の外にある（${c.y > CAMERA.halfHeight ? "上" : c.y < -CAMERA.halfHeight ? "下" : "横"}にはみ出す）。見える高さ・位置に置く`,
      });
    }
  }

  return problems;
};

// 持ち物を言う言い方。with a basket・holding an umbrella・carrying a box・has a bag
const HELD =
  /\b(?:with|holding|carrying|has|have)\s+(?:(?:a|an|the|his|her|their|two|some)\s+)?([a-z]+)/g;
/** 持ち物の物が、その人の近くにあるとみる距離（m。投げたボールは 1.35 m 先にある） */
const NEAR_HOLDER = 1.5;

/**
 * 見本の答えの各節で、人が持っていると言う物（with a basket など）が、絵に描かれているか。
 * その人の部品の持ち物（holds）にあるか、その物の部品がその人の近く（1.5 m 以内）にあればよい。
 * 見るのは部品の物の名前（words）か持ち物にある語だけ（with her friend・with both hands は見ない）。
 * 主語の呼び方が合う人が何人かいれば、誰か 1 人が持っていればよい
 */
export const verifyHeld = (
  plan: SceneSentences,
  placedItems: { key: string; part: string; position: Vec3 }[],
  partList: Part[],
): Problem[] => {
  const parts = new Map(partList.map((p) => [p.id, p]));
  const plural = (w: string) => [w, w.replace(/e?s$/, "")];
  const thingWords = new Set(
    partList
      .filter((p) => !isLiving(p))
      .flatMap((p) =>
        p.words.filter((w) => w.pos === "noun").map((w) => w.word),
      ),
  );
  for (const p of partList)
    for (const w of wordsOf(p.holds ?? "")) thingWords.add(w);
  // 同じ部品の言い換え（smartphone と phone）を同じ物とみる
  const sameThing = (word: string) =>
    new Set([
      word,
      ...partList
        .filter((p) => !isLiving(p) && p.words.some((w) => w.word === word))
        .flatMap((p) => p.words.map((w) => w.word)),
    ]);
  const items = placedItems
    .map((i) => ({ ...i, info: parts.get(i.part.split("@")[0]) }))
    .filter((i): i is typeof i & { info: Part } => !!i.info);
  const problems: Problem[] = [];
  const seen = new Set<string>();
  for (const clause of clausesOf(plan.description)) {
    const found = clauseAction(clause);
    if (!found) continue;
    const people = items.filter(
      (i) => isLiving(i.info) && nounFits(found.noun, i.info),
    );
    if (people.length === 0) continue;
    for (const m of clause.toLowerCase().matchAll(HELD)) {
      const word = plural(m[1]).find((w) => thingWords.has(w));
      if (!word) continue;
      const same = sameThing(word);
      const holds = (i: (typeof items)[number]) =>
        wordsOf(i.info.holds ?? "").some((w) =>
          plural(w).some((v) => same.has(v)),
        ) ||
        items.some(
          (t) =>
            !isLiving(t.info) &&
            t.info.words.some((w) => w.word === word) &&
            Math.hypot(
              t.position[0] - i.position[0],
              t.position[2] - i.position[2],
            ) <= NEAR_HOLDER,
        );
      if (people.some(holds)) continue;
      const key = `${found.noun}:${word}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // その呼び方の部品に、それを持つものがあれば部品の選び直し、無ければ英文を書き直す
      const other = partList.some(
        (p) =>
          isLiving(p) &&
          nounFits(found.noun, p) &&
          wordsOf(p.holds ?? "").some((w) =>
            plural(w).some((v) => same.has(v)),
          ),
      );
      problems.push({
        code: "held_missing",
        stage: other ? "items" : "sentences",
        message: `見本の答えの「${clause}」で ${found.noun} が ${word} を持っていると言うが、${people
          .map((i) => `${i.key} の部品 ${i.info.id}`)
          .join("、")} は ${word} を持っておらず、近くにも無い。${
          other
            ? `${word} を持つ ${found.noun} の部品にする`
            : `${found.noun} の部品で持てる物だけを書く（${word} を持つ ${found.noun} の部品は無い）`
        }`,
      });
    }
  }
  return problems;
};

/** 英文と部品の両方を確かめる。部品まで通れば、座標に直して場所も確かめる。空なら通った */
export const verifyScene = (
  gradeId: GradeId,
  plan: SceneSentences & { items: PlanItem[] },
  parts: Part[],
): Problem[] => {
  const problems = [
    ...verifySentences(gradeId, plan, parts),
    ...verifyItems(gradeId, plan, plan.items, parts),
  ];
  return problems.length > 0 ? problems : verifyPlaces(gradeId, plan, parts);
};
