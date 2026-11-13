import { z } from "zod";
import { isObjectId, MAX_ID_LENGTH, parsePartId, partRef } from "../parts/ids";
import { orderProblem, type PartOrder, refusedTerm } from "../parts/workshop";
import { POSE_VERBS, poseVerbsOf, postureOf, whoOf } from "./pose-verbs";
import type { LayoutItemV2, Part, PlanItem, SceneLayoutV2 } from "./types";
import { nounFits, PERSON_NOUNS, type Problem } from "./verify";

// 部品を ID の規約で引く 2 回目（docs/design/part-generation.md）。部品の一覧を prompt に出さず、
// Claude は規約どおりの ID を書く。コードが引く:
// - 同梱に有ればそのまま
// - 人・動物（person_<動作>_<誰>_<変種>・animal_<動作>_<種類>_<変種>）は、「誰」と「動作」が最も近い同梱の部品に寄せる
// - 物（名詞・名詞_区別）は、同梱の部品の名前（id と words）に合えばそれ、前に作った部品（R2）に有ればそれ、
//   無ければ Claude が書いた注文（newParts）で作る（1 場面 MAX_NEW_PARTS 個まで）
// 作るのは物だけ（thing・furniture・food・plant・vehicle）。人・動物・地面・壁は作らない

export const MAKEABLE_CATEGORIES = [
  "thing",
  "furniture",
  "food",
  "plant",
  "vehicle",
] as const;

/** 1 場面で、同梱に無い部品（作る・前に作った）を使う数の上限。費用のヒューズ */
export const MAX_NEW_PARTS = 4;

/** 2 回目の注文の形（Claude に書かせる）。size は w・h・d の object で書かせ、コードで組にする */
export const orderJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    category: { type: "string", enum: [...MAKEABLE_CATEGORIES] },
    label: { type: "string", description: "short Japanese name" },
    words: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
      description: "English nouns for the thing",
    },
    size: {
      type: "object",
      properties: {
        width: { type: "number" },
        height: { type: "number" },
        depth: { type: "number" },
      },
      required: ["width", "height", "depth"],
      additionalProperties: false,
      description: "meters",
    },
    description: {
      type: "string",
      description: "one English sentence: the shape and the colors",
    },
    top: {
      type: "boolean",
      description: "true if other things can be put on top of it",
    },
  },
  required: ["id", "category", "label", "words", "size", "description", "top"],
  additionalProperties: false,
} as const;

const Size = z.number().min(0.02).max(8);

export const OrderSchema = z
  .object({
    id: z.string().trim().min(1),
    category: z.enum(MAKEABLE_CATEGORIES),
    label: z.string().trim().min(1).max(40),
    words: z
      .array(z.string().trim().toLowerCase().min(1).max(40))
      .min(1)
      .max(6),
    size: z.object({ width: Size, height: Size, depth: Size }),
    description: z.string().trim().min(1).max(300),
    top: z.boolean(),
  })
  .transform(
    (o): PartOrder => ({
      id: o.id,
      category: o.category,
      label: o.label,
      words: o.words,
      size: [o.size.width, o.size.height, o.size.depth],
      description: o.description,
      ...(o.top ? { top: true } : {}),
    }),
  );

// ---------- 人と動物の語彙 ----------

/**
 * 規約の「誰」は 1 語（backend/src/parts/ids.ts の PERSON_ID）。部品の words の先頭の空白を詰めたもの（old man → oldman）。
 * 同梱の ID に出てくる別名（adult・mother・teen・old）も読む
 */
const WHO_ALIASES: Record<string, string> = {
  adult: "man",
  mother: "woman",
  teen: "boy",
  old: "oldman",
};

const isLiving = (p: Part) =>
  p.category === "person" || p.category === "animal";

/** 部品の「誰」の語（old man → oldman） */
export const whoToken = (p: Pick<Part, "id" | "words">) =>
  whoOf(p).replace(/ /g, "");

/** 「誰」の語を、呼び方（verify.ts の PERSON_NOUNS のキー）に戻す（oldman → old man） */
const whoNoun = (who: string) => who.replace(/^old(man|woman)$/, "old $1");

/** 規約どおりの人・動物の ID（同梱の ID とは「誰」の語が違うことがある） */
export const livingId = (p: Part) =>
  `${p.category === "animal" ? "animal" : "person"}_${p.pose ?? "stand"}_${whoToken(p)}_a`;

/**
 * 2 回目に渡す、人と動物の動作の表。1 行は「ID の形 | 見える動作 | 言える動詞 | できる誰 | 持ち物・使う物・座る」。
 * 同梱の部品から作るので、部品の一覧そのものより小さい
 */
export const livingTable = (parts: Part[]): string => {
  const rows = new Map<
    string,
    { line: string; who: Set<string>; extra: string[] }
  >();
  for (const p of parts) {
    if (!isLiving(p) || !p.pose) continue;
    const prefix = p.category === "animal" ? "animal" : "person";
    const key = `${prefix}_${p.pose}`;
    const row = rows.get(key) ?? {
      line: `${prefix}_${p.pose}_<who>_a | ${POSE_VERBS[p.pose]?.phrase ?? p.pose} | says: ${poseVerbsOf(
        p,
      )
        .map((v) => v.verb)
        .join(", ")}`,
      who: new Set<string>(),
      extra: [
        p.holds ? `holds: ${p.holds}` : "",
        p.uses ? `uses: ${p.uses.join(", ")}` : "",
        postureOf(p) === "sit" ? "sitting (needs sit_on)" : "",
      ].filter(Boolean),
    };
    row.who.add(whoToken(p));
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) =>
      [`- ${r.line}`, `who: ${[...r.who].join(", ")}`, ...r.extra].join(" | "),
    )
    .join("\n");
};

/** 2 回目に渡す、もう部品のある物の名詞（同梱の物の words）。ID はこの名詞をそのまま書けば引ける */
export const thingNouns = (parts: Part[]): string =>
  [
    ...new Set(
      parts
        .filter((p) =>
          (MAKEABLE_CATEGORIES as readonly string[]).includes(p.category),
        )
        .flatMap((p) =>
          p.words.filter((w) => w.pos === "noun").map((w) => w.word),
        ),
    ),
  ].join(", ");

// ---------- 引く ----------

const tokensOf = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/**
 * 人・動物の ID を、動作と誰（動物は種類）に分ける（規約の読み方は ids.ts の parsePartId）。人・動物でなければ null。
 * 「誰」が 2 語の同梱の ID（person_stand_old_woman_a）は、動作の最後の old を誰に戻す
 */
export const parseLivingId = (
  id: string,
): { category: "person" | "animal"; pose: string; who: string } | null => {
  const parsed = parsePartId(id);
  if (!parsed || parsed.kind === "object") return null;
  if (parsed.kind === "animal") {
    return {
      category: "animal",
      pose: parsed.action ?? "",
      who: parsed.species,
    };
  }
  let pose = parsed.action;
  let who = WHO_ALIASES[parsed.who] ?? parsed.who;
  if (pose.endsWith("_old") && (who === "man" || who === "woman")) {
    pose = pose.slice(0, -"_old".length);
    who = `old${who}`;
  }
  return { category: "person", pose, who };
};

/** 書かれた人・動物に、最も近い同梱の部品（誰が合うことを先に、次に動作） */
export const nearestLiving = (
  wanted: { category: "person" | "animal"; pose: string; who: string },
  parts: Part[],
): Part | undefined => {
  const wantedVerbs = new Set<string>(
    POSE_VERBS[wanted.pose]?.verbs ?? [wanted.pose],
  );
  let best: { part: Part; score: number } | undefined;
  for (const p of parts) {
    if (p.category !== wanted.category) continue;
    let score = 0;
    if (whoToken(p) === wanted.who) score += 8;
    else if (nounFits(whoNoun(wanted.who), p)) score += 4;
    if (p.pose === wanted.pose) score += 4;
    else if (poseVerbsOf(p).some((v) => wantedVerbs.has(v.verb))) score += 2;
    if (!best || score > best.score) best = { part: p, score };
  }
  return best && best.score > 0 ? best.part : undefined;
};

/**
 * 同梱の物で、書かれた ID の語を全部名前（id と words）に持つもの。
 * ball → ball_red、trash_can → trash_bin、phone → smartphone。区別の付いた ID（apple_green）は、
 * 同じ区別の語を持つ部品が無ければ合わない（別の物として作る）
 */
export const bundledThing = (id: string, parts: Part[]): Part | undefined => {
  const want = tokensOf(id);
  const matches = parts
    .filter((p) => !isLiving(p) && p.category !== "ground")
    .filter((p) => p.category !== "building")
    .map((p) => {
      const own = new Set([
        ...tokensOf(p.id),
        ...p.words.flatMap((w) => tokensOf(w.word)),
      ]);
      return {
        p,
        ok: want.every((t) => own.has(t)),
        extra: tokensOf(p.id).length,
      };
    })
    .filter((m) => m.ok)
    .sort((a, b) => a.extra - b.extra);
  return matches[0]?.p;
};

/** 注文から、作る前の仮のメタデータ（裏取りと座標の確かめに使う。作ったら本物に替える） */
export const provisionalPart = (order: PartOrder): Part => ({
  id: order.id,
  version: 0,
  file: "",
  category: order.category,
  words: order.words.map((word) => ({ word, pos: "noun" })),
  size: order.size,
  label: order.label,
  ...(order.top ? { anchors: { top: order.size[1] } } : {}),
});

export type Resolution = {
  /** part を、引いた部品の ID に置き換えた items */
  items: PlanItem[];
  /** 前に作った部品（R2）で、この場面で使うもの */
  found: Part[];
  /** これから作る部品の注文 */
  orders: PartOrder[];
  /** 書いた ID と、寄せた・引いた先が違ったもの（ログ用） */
  mapped: { from: string; to: string }[];
  problems: Problem[];
};

/**
 * 2 回目が書いた items と注文から、使う部品を引く。lookup は前に作った部品（R2）を引く関数。
 * 問題（作れない ID・注文の無い物・上限を超えた）は problems で返す（作り直しの理由になる）
 */
export const resolveParts = async (
  items: PlanItem[],
  newParts: PartOrder[],
  bundled: Part[],
  lookup: (id: string) => Promise<Part | null>,
  maxNew = MAX_NEW_PARTS,
  /** false なら部品を作らない（注文があっても、同梱に無い物は問題にする） */
  canMake = true,
): Promise<Resolution> => {
  const byId = new Map(bundled.map((p) => [p.id, p]));
  const orders = new Map(newParts.map((o) => [o.id, o]));
  const problems: Problem[] = [];
  const add = (code: Problem["code"], message: string) =>
    problems.push({ code, stage: "items", message });
  const mapped: Resolution["mapped"] = [];
  /** 書かれた ID → 使う ID（同梱の部品）か、同梱に無い ID（R2 か作る） */
  const chosen = new Map<string, string>();
  const outside = new Set<string>();

  for (const id of new Set(items.map((i) => i.part))) {
    if (byId.has(id)) {
      chosen.set(id, id);
      continue;
    }
    const living = parseLivingId(id);
    if (living) {
      const near = nearestLiving(living, bundled);
      if (near) {
        chosen.set(id, near.id);
        mapped.push({ from: id, to: near.id });
      } else {
        add(
          "unknown_part",
          `部品 ${id} に寄せられる人や動物が無い。表の動作と誰で person_<action>_<who>_a と書く`,
        );
      }
      continue;
    }
    const thing = bundledThing(id, bundled);
    if (thing) {
      chosen.set(id, thing.id);
      if (thing.id !== id) mapped.push({ from: id, to: thing.id });
      continue;
    }
    outside.add(id);
  }

  // 同梱に無い物: 前に作った部品を引き、無ければ注文で作る
  const found: Part[] = [];
  const toMake: PartOrder[] = [];
  // 作れない道では、前に作った部品（R2）も引かない（同梱の部品だけで組む）
  const looked = await Promise.all(
    [...outside].map(async (id) => ({
      id,
      part: canMake ? await lookup(id) : null,
    })),
  );
  for (const { id, part } of looked) {
    if (part) {
      found.push(part);
      chosen.set(id, part.id);
      continue;
    }
    if (!canMake) {
      add(
        "unknown_part",
        `部品 ${id} が無い。この場面では部品を作れないので、もう部品のある物（名詞の一覧）にするか、その物を使わない`,
      );
      continue;
    }
    const order = orders.get(id);
    if (!order) {
      add(
        "unknown_part",
        `部品 ${id} が無い。newParts に ${id} の注文（category・label・words・size・description・top）を書くか、もう部品のある物にする`,
      );
      continue;
    }
    const why = refusedOrder(order, byId);
    if (why) {
      // 作れない物は英文にも出てくるので、1 回目（英文）から書き直させる
      problems.push({ code: "bad_part_order", ...why });
      continue;
    }
    toMake.push(order);
    chosen.set(id, id);
  }

  const outsideCount = found.length + toMake.length;
  if (outsideCount > maxNew) {
    add(
      "too_many_new_parts",
      `部品の無い物が ${outsideCount} 個（${[...found.map((p) => p.id), ...toMake.map((o) => o.id)].join(", ")}）。1 つの場面で ${maxNew} 個まで。もう部品のある物に替えるか、減らす`,
    );
  }

  return {
    items: items.map((i) => ({ ...i, part: chosen.get(i.part) ?? i.part })),
    found,
    orders: toMake,
    mapped,
    problems,
  };
};

/**
 * 注文を断る理由と、どこから書き直させるか（ID の形・同梱の ID と重なる・地面・人や動物・建物・部品を作る口が断る注文）。
 * よければ undefined。作れない物は英文にも出てくるので 1 回目（sentences）から、注文の書き方の違いは 2 回目（items）から書き直させる。
 * 部品を作る口と同じ確かめ（作らない物の語は refusedTerm で id・words・label・description の全部を、形は orderProblem で）を先にして、作る前に「その物を使わない場面」に書き直させる（作る口で断られて場面ごと失敗しないため）
 */
const refusedOrder = (
  order: PartOrder,
  byId: Map<string, Part>,
): Pick<Problem, "stage" | "message"> | undefined => {
  if (!isObjectId(order.id)) {
    return {
      stage: "items",
      message: `注文 ${order.id} の id が規約の形でない（英小文字の名詞か 名詞_区別、_ で 3 語まで、${MAX_ID_LENGTH} 文字まで）`,
    };
  }
  if (byId.has(order.id)) {
    return {
      stage: "items",
      message: `注文 ${order.id} はもう部品がある。注文せずにその id を使う`,
    };
  }
  const kind = notAThing(order, [...byId.values()]);
  if (kind?.what === "ground") {
    // 地面（芝生・砂・床など）そのものは作らない。refs の grass などは、地面の部品の key にする
    return {
      stage: "items",
      message: `${order.id} は地面（${kind.word}）。地面は作らない。英文の ${kind.word} は、地面の部品（grass_patch・sand_beach・floor_wood など）の item の key にする`,
    };
  }
  if (kind?.what === "building") {
    return {
      stage: "sentences",
      message: `${order.id} は建物や壁（${kind.word}）なので作れない物。この物を使わない場面にする（英文からも外す。壁や窓の背景は、決まりにある wall_window・wall_cafe などの部品だけを使う）`,
    };
  }
  if (kind?.what === "living") {
    return {
      stage: "sentences",
      message: `${order.id} は生きている人や動物（${kind.word}）なので、物としては作れない物。注文はやめる。生きている人・動物そのものを置きたいときだけ、表の person_・animal_ の ID で書く。そうでなければ、この物を使わない場面にする（英文からも外す）。人や動物の形のおもちゃ・食べ物・道具（teddy bear・rubber duck・fried chicken・fish tank など）は物として注文してよい`,
    };
  }
  // 作らない物の語は、部品を作る口と同じ網（id・words・label・description の全部を見る）で先に見る
  const refused = refusedTerm(order);
  if (refused) {
    return {
      stage: "sentences",
      message: `${order.id} は作れない物（${refused}）。この物を使わない場面にする（英文からも外す）`,
    };
  }
  const problem = orderProblem(order);
  if (problem) {
    return {
      stage: "items",
      message: `注文 ${order.id} の形が違う（${problem}）。注文を直すか、もう部品のある物にする`,
    };
  }
  return undefined;
};

// 地面の主の名詞（地面の部品の ID の先頭の語に足す）。敷物（carpet・rug）は床の上に置ける物なので入れない
const GROUND_NOUNS = [
  "grass",
  "lawn",
  "sand",
  "beach",
  "floor",
  "ground",
  "dirt",
  "field",
  "road",
  "street",
  "sidewalk",
  "pavement",
  "crosswalk",
  "platform",
];

// 建物と部屋の主の名詞（建物の部品の ID に足す）。前に何が付いても建物（brick wall・living room）
const BUILDING_NOUNS = [
  "wall",
  "door",
  "window",
  "room",
  "building",
  "roof",
  "ceiling",
  "stairs",
  "stair",
];

// 家の主の名詞。人・動物と同じく、前に様子・材質の語だけが付けば家そのもの（house・big house・brick house）、
// ほかの語が付けば家の形の物（bird house・dog house・doll house）
const HOUSE_NOUNS = new Set(["house", "home"]);

// 家の前に付いても家そのものを言う、材質の語
const MATERIALS = new Set([
  "brick",
  "wooden",
  "wood",
  "stone",
  "concrete",
  "glass",
  "metal",
  "steel",
  "iron",
  "log",
  "straw",
]);

// 同梱の人・動物の「誰」「種類」の語（verify.ts の PERSON_NOUNS と部品の words）に足す、よく出る人と動物の語
const MORE_LIVING = [
  "person",
  "baby",
  "animal",
  "pet",
  "cat",
  "kitten",
  "kitty",
  "puppy",
  "horse",
  "pony",
  "cow",
  "pig",
  "sheep",
  "goat",
  "rabbit",
  "bunny",
  "duck",
  "duckling",
  "chicken",
  "chick",
  "hen",
  "fish",
  "mouse",
  "bear",
  "lion",
  "tiger",
  "elephant",
  "monkey",
  "giraffe",
  "penguin",
  "frog",
  "turtle",
  "hamster",
];

// 人・動物の前に付いても、その人・動物そのものを言う語（色・大きさ・年齢・様子）。
// これ以外の語が前に付いた句（teddy bear・rubber duck・rocking horse・computer mouse）は、別の物の名前とみる
const DESCRIBING = new Set([
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "brown",
  "black",
  "white",
  "gray",
  "grey",
  "big",
  "small",
  "little",
  "large",
  "tiny",
  "huge",
  "tall",
  "short",
  "fat",
  "thin",
  "long",
  "old",
  "young",
  "elderly",
  "adult",
  "cute",
  "fluffy",
  "furry",
  "spotted",
  "striped",
  "wild",
  "stray",
  "happy",
  "sad",
  "angry",
  "hungry",
  "sleepy",
  "sleeping",
  "lazy",
  "friendly",
]);

// 複数形を単数に寄せる（不規則な形）
const IRREGULAR_PLURALS: Record<string, string> = {
  people: "person",
  men: "man",
  women: "woman",
  children: "child",
  mice: "mouse",
  geese: "goose",
};

/** 語の形の候補（そのまま・単数に寄せた形）。複数形を単数に寄せる程度（cats → cat・boxes → box・puppies → puppy） */
const nounForms = (word: string): string[] => [
  word,
  IRREGULAR_PLURALS[word] ?? word,
  word.replace(/([^aeiou])ies$/, "$1y"),
  word.replace(/(s|x|z|ch|sh)es$/, "$1"),
  word.replace(/([^su])s$/, "$1"),
];

/** 語の一覧に当たる形（無ければ undefined） */
const formIn = (set: Set<string>, word: string) =>
  nounForms(word).find((f) => set.has(f));

/**
 * 句を、主の名詞（最後の語）と前に付いた語に分ける（a・an・the は外す）。
 * 「X of Y」は X が主なので、of より前だけを見る（bucket of sand の bucket・picture of a house の picture）
 */
const headOf = (phrase: string) => {
  const tokens = phrase
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter((t) => t !== "" && !["a", "an", "the"].includes(t));
  const of = tokens.indexOf("of");
  const core = of > 0 ? tokens.slice(0, of) : tokens;
  return { head: core.at(-1) ?? "", modifiers: core.slice(0, -1) };
};

/** 地面・建物・人と動物の主の名詞の一覧（同梱の部品の ID と「誰」に、上の一覧を足す。家は HOUSE_NOUNS） */
const nounSets = (parts: Part[]) => ({
  ground: new Set([
    ...parts
      .filter((p) => p.category === "ground")
      .map((p) => p.id.split("_")[0]),
    ...GROUND_NOUNS,
  ]),
  // 建物の部品は 1 語の ID（door・wall・window）だけ足す（bus_shelter の bus は主の名詞でない。words には bus・menu など物の語も入っている）
  building: new Set([
    ...parts
      .filter((p) => p.category === "building" && !p.id.includes("_"))
      .map((p) => p.id),
    ...BUILDING_NOUNS,
  ]),
  living: new Set([
    ...Object.keys(PERSON_NOUNS).map((n) => headOf(n).head),
    ...parts.filter(isLiving).map((p) => headOf(whoOf(p)).head),
    ...MORE_LIVING,
  ]),
});

/**
 * 注文が「物」でない（地面・建物・生きている人や動物）か。英語の主の名詞（words の各句の最後の語。「X of Y」は X。複数形は単数に寄せる）で決める。
 * words が無ければ id の先頭の語（名詞_区別 の名詞）で決める。id と words が食い違うとき（fish_tank の words が fish tank）は words を見る。
 * - 地面・建物: どれか 1 つの句の主の名詞が地面・建物の語なら当たる（brick wall・wooden door・grass）。
 *   主でない語（door mat の door・window box の window・street lamp の street・bucket of sand の sand）では当てない
 * - 家（house・home）と人・動物: どの句も、主の名詞がそれで、前に付いた語が様子だけ（家は材質も。big house・brick house・brown dog・old man）のときだけ当たる。
 *   別の語が前に付いた句（bird house・doll house・teddy bear・rubber duck）や、主の名詞が物の句（fish tank の tank）が 1 つでもあれば、
 *   家や人・動物の形の物とみる（rubber duck の words に短い呼び名の duck が並んでいても断らない）。
 *   食べ物（category が food）は動物の語（chicken・fish）で断らない
 */
export const notAThing = (
  order: Pick<PartOrder, "id" | "category" | "words">,
  parts: Part[],
): { what: "ground" | "building" | "living"; word: string } | undefined => {
  const words = order.words.filter((w) => w.trim() !== "");
  const phrases = (words.length > 0 ? words : [order.id.split("_")[0]]).map(
    headOf,
  );
  const sets = nounSets(parts);
  for (const [what, set] of [
    ["ground", sets.ground],
    ["building", sets.building],
  ] as const) {
    for (const { head } of phrases) {
      const word = formIn(set, head);
      if (word) return { what, word };
    }
  }
  /** どの句も、主の名詞が set の語で、前に付いた語が keeps に当たる語だけなら、その語（最初の句の） */
  const itself = (set: Set<string>, keeps: (m: string) => boolean) => {
    const found = phrases.map(({ head, modifiers }) =>
      modifiers.every(keeps) ? formIn(set, head) : undefined,
    );
    return found.every((w) => w !== undefined) ? found[0] : undefined;
  };
  const house = itself(
    HOUSE_NOUNS,
    (m) => DESCRIBING.has(m) || MATERIALS.has(m),
  );
  if (house) return { what: "building", word: house };
  if (order.category === "food") return undefined;
  const living = itself(
    sets.living,
    (m) => DESCRIBING.has(m) || formIn(sets.living, m) !== undefined,
  );
  if (living) return { what: "living", word: living };
  return undefined;
};

/** 配置で、同梱に無い部品（作った・前に作った）を id@版 にする */
export const withVersions = (
  layout: SceneLayoutV2,
  outside: Part[],
): SceneLayoutV2 => {
  const versions = new Map(outside.map((p) => [p.id, p.version]));
  return {
    ...layout,
    items: layout.items.map(
      (i): LayoutItemV2 =>
        versions.has(i.part)
          ? { ...i, part: partRef(i.part, versions.get(i.part) as number) }
          : i,
    ),
  };
};
