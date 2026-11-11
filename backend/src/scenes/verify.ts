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
    | "action_mismatch"
    | "place_mismatch"
    | "held_thing"
    | "rain_indoors"
    | "duplicate_key"
    | "unknown_part"
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
): Problem[] => {
  const parts = new Map(partList.map((p) => [p.id, p]));
  let layout: ReturnType<typeof composeLayoutV2>;
  try {
    layout = composeLayoutV2(plan, partList, { id: "check", grade: gradeId });
  } catch {
    return [];
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
