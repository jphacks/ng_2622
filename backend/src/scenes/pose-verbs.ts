import { type CefrLevel, withinLevel } from "./grades";
import type { Part } from "./types";

// 人・動物の部品のポーズ（parts.json の pose）ごとの、言える動詞と CEFR-J の段階。
// 級ごとに中心の動作に使える動詞を分け（grades.ts）、裏取り（verify.ts）で accept の動詞と照らす。
// 下書き。段階は CEFR-J Wordlist v1.5（openlanguageprofiles/olp-en-cefrj の動詞の行）の値をそのまま写した。
// 表に無い動詞（peck・poke）は B2 扱いにしている。中身は PR で人が確かめる

/** 動詞の段階。同じ動詞はどのポーズでも同じ段階にするため、ここ 1 か所に書く */
export const VERB_LEVELS = {
  answer: "A1",
  ask: "A1",
  blow: "A1",
  bring: "A1",
  build: "A1",
  buy: "A1",
  call: "A2",
  carry: "A1",
  catch: "A1",
  celebrate: "A1",
  chase: "B2",
  check: "A2",
  cheer: "A2",
  clap: "B2",
  clean: "A1",
  come: "A1",
  cook: "A1",
  cover: "A2",
  cross: "A2",
  cry: "A2",
  cut: "A1",
  do: "A1",
  draw: "A1",
  drink: "A1",
  eat: "A1",
  examine: "B1",
  explain: "A2",
  fall: "A2",
  feed: "B1",
  get: "A1",
  give: "A1",
  go: "A1",
  grab: "B1",
  have: "A1",
  help: "A1",
  hold: "A2",
  hurry: "A2",
  hurt: "A1",
  kneel: "B2",
  leave: "A1",
  lie: "A2",
  lift: "B1",
  listen: "A1",
  look: "A1",
  make: "A1",
  move: "A2",
  offer: "A2",
  order: "A2",
  pay: "A1",
  peck: "B2",
  pick: "A1",
  place: "B1",
  play: "A1",
  point: "A2",
  poke: "B2",
  prepare: "A2",
  press: "B1",
  pull: "A2",
  push: "A1",
  put: "A1",
  raise: "A2",
  reach: "A2",
  read: "A1",
  rest: "B1",
  run: "A1",
  rush: "B1",
  say: "A1",
  search: "B1",
  see: "A1",
  sell: "A1",
  serve: "A2",
  set: "A1",
  shake: "B1",
  share: "A1",
  shop: "B1",
  show: "A1",
  sit: "A1",
  sleep: "A1",
  slip: "B1",
  smile: "B1",
  speak: "A1",
  stand: "A2",
  stretch: "B1",
  study: "A1",
  sweep: "B2",
  take: "A1",
  talk: "A1",
  teach: "A1",
  tell: "A1",
  text: "A2",
  throw: "A2",
  toss: "B1",
  touch: "B1",
  trip: "B2",
  try: "A2",
  turn: "A1",
  use: "A1",
  wait: "A1",
  wake: "B1",
  walk: "A1",
  want: "A1",
  watch: "A1",
  wear: "A1",
  wipe: "B2",
  write: "A1",
} as const satisfies Record<string, CefrLevel>;

export type Verb = keyof typeof VERB_LEVELS;

/** phrase: 1 回目の指示に出す、このポーズで見える動作。verbs: このポーズを言い表せる動詞（先頭が主な動詞） */
export type PoseVerbs = { phrase: string; verbs: readonly Verb[] };

export const POSE_VERBS: Record<string, PoseVerbs> = {
  ask: {
    phrase: "ask for something, pointing at it",
    verbs: ["ask", "point", "order", "want"],
  },
  basket: {
    phrase: "wait with a shopping basket",
    verbs: ["wait", "hold", "carry", "stand", "shop", "buy"],
  },
  blackboard: {
    phrase: "write on the blackboard",
    verbs: ["write", "teach", "draw", "explain"],
  },
  blow: { phrase: "blow out candles (sitting)", verbs: ["blow", "sit"] },
  bucket: {
    phrase: "carry a bucket of water",
    verbs: ["carry", "bring", "hold", "take"],
  },
  carry: {
    phrase: "carry a box",
    verbs: ["carry", "hold", "bring", "move", "take"],
  },
  carry_veg: {
    phrase: "carry a box of vegetables",
    verbs: ["carry", "hold", "bring", "move", "take"],
  },
  catch: { phrase: "catch a ball", verbs: ["catch", "play", "wait"] },
  check_hand: {
    phrase: "check someone's hand",
    verbs: ["check", "look", "examine", "hold", "help", "touch"],
  },
  clap: {
    phrase: "clap (sitting)",
    verbs: ["clap", "cheer", "celebrate", "sit", "smile"],
  },
  cook: { phrase: "cook at the stove", verbs: ["cook", "make", "prepare"] },
  cut: { phrase: "cut a cake", verbs: ["cut"] },
  drink: { phrase: "drink from a cup", verbs: ["drink", "have"] },
  eat: { phrase: "eat an apple", verbs: ["eat", "have"] },
  fallen: {
    phrase: "have fallen down (sitting on the ground)",
    verbs: ["fall", "sit", "cry", "hurt", "slip", "trip", "lie"],
  },
  feed: { phrase: "feed a bird", verbs: ["feed", "give"] },
  help_up: {
    phrase: "help someone get up",
    verbs: ["help", "pull", "reach", "hold", "give"],
  },
  hold: {
    phrase: "hold something with both hands",
    verbs: ["hold", "carry", "have", "take"],
  },
  kneel_build: {
    phrase: "build a sand castle",
    verbs: ["build", "make", "play", "kneel"],
  },
  lift_desk: {
    phrase: "carry a desk with both hands",
    verbs: ["carry", "move", "lift", "hold"],
  },
  look: {
    phrase: "look far away (a hand over the eyes)",
    verbs: ["look", "watch", "search", "see"],
  },
  offer: {
    phrase: "offer a hand to someone",
    verbs: ["offer", "help", "hold", "reach", "give"],
  },
  pay: { phrase: "pay at the counter", verbs: ["pay", "buy", "give"] },
  peck: { phrase: "(bird) eat on the ground", verbs: ["eat", "peck", "pick"] },
  phone: {
    phrase: "look at a smartphone",
    verbs: [
      "look",
      "use",
      "check",
      "hold",
      "talk",
      "call",
      "text",
      "play",
      "read",
    ],
  },
  point: {
    phrase: "point at something",
    verbs: ["point", "show", "tell", "look"],
  },
  poke: {
    phrase: "reach something high with a stick",
    verbs: ["reach", "poke", "try", "use", "hold", "get"],
  },
  press: {
    phrase: "press a button on a machine",
    verbs: ["press", "push", "buy", "use", "touch"],
  },
  put: {
    phrase: "put something on a table",
    verbs: ["put", "place", "set", "leave"],
  },
  question: {
    phrase: "talk to someone, ask someone",
    verbs: ["ask", "talk", "speak", "say", "tell", "call"],
  },
  raise_hand: {
    phrase: "raise a hand (sitting)",
    verbs: ["raise", "ask", "answer", "sit"],
  },
  reach: {
    phrase: "reach for something",
    verbs: ["reach", "try", "stretch", "take", "get"],
  },
  read: { phrase: "read a book (standing)", verbs: ["read", "look"] },
  read_sit: {
    phrase: "read a book (sitting)",
    verbs: ["read", "sit", "look"],
  },
  rest: {
    phrase: "(dog) sit and watch",
    verbs: ["sit", "watch", "wait", "look", "rest"],
  },
  run: { phrase: "run", verbs: ["run", "hurry", "rush", "chase"] },
  run_bag: {
    phrase: "run with a bag",
    verbs: ["run", "hurry", "rush", "carry", "hold"],
  },
  run_phone: {
    phrase: "run with a smartphone",
    verbs: ["run", "hurry", "rush", "hold", "look", "talk"],
  },
  run_umbrella: {
    phrase: "run with a closed umbrella",
    verbs: ["run", "hurry", "rush", "carry", "hold"],
  },
  serve: {
    phrase: "bring drinks on a tray",
    verbs: ["bring", "serve", "carry", "hold"],
  },
  set_plates: {
    phrase: "put plates on a table",
    verbs: ["put", "set", "place", "carry", "help", "prepare"],
  },
  show_hand: { phrase: "show a hand to someone", verbs: ["show", "hold"] },
  show_jacket: {
    phrase: "show a jacket to a customer",
    verbs: ["show", "hold", "help", "sell"],
  },
  sit: {
    phrase: "sit (on a chair, a bench or a sofa)",
    verbs: ["sit", "rest", "wait", "watch", "talk", "listen", "look"],
  },
  sit_look_l: {
    phrase: "sit and look at the person next to them",
    verbs: ["sit", "look", "listen", "watch", "talk", "turn"],
  },
  sit_look_r: {
    phrase: "sit and look at the person next to them",
    verbs: ["sit", "look", "listen", "watch", "talk", "turn"],
  },
  sleep: { phrase: "sleep at a desk", verbs: ["sleep", "rest"] },
  stand: {
    phrase: "stand",
    verbs: ["stand", "wait", "watch", "look", "talk", "listen"],
  },
  sweep: { phrase: "sweep with a broom", verbs: ["sweep", "clean"] },
  take_book: {
    phrase: "take a book from a high shelf",
    verbs: ["take", "reach", "get", "pick", "grab"],
  },
  take_order: {
    phrase: "take an order at a table",
    verbs: ["take", "write", "ask", "listen"],
  },
  throw: { phrase: "throw a ball", verbs: ["throw", "play", "toss"] },
  try_jacket: { phrase: "try on a jacket", verbs: ["try", "wear", "put"] },
  umbrella: {
    phrase: "hold an umbrella over someone (share it)",
    verbs: ["hold", "share", "give", "offer", "cover"],
  },
  wake: {
    phrase: "wake someone (a hand on their shoulder)",
    verbs: ["wake", "touch", "shake", "call"],
  },
  walk: { phrase: "walk", verbs: ["walk", "go", "cross", "come", "leave"] },
  wipe: { phrase: "wipe a table", verbs: ["wipe", "clean"] },
  write: {
    phrase: "write at a desk (sitting)",
    verbs: ["write", "study", "draw", "do", "sit"],
  },
};

const isVerb = (word: string): word is Verb => word in VERB_LEVELS;

/** 動詞の段階。表に無い動詞は B2（どの級の中心にも使えない）にする */
export const verbLevel = (verb: string): CefrLevel =>
  isVerb(verb) ? VERB_LEVELS[verb] : "B2";

type Posed = Pick<Part, "pose" | "words"> &
  Partial<Pick<Part, "category" | "anchors">>;

// 立っているとは言えないポーズ（走る・歩く・地面に座り込む・ひざをつく）。名前の先頭で見分ける
const NOT_STANDING = ["run", "walk", "fallen", "kneel"];

/**
 * 部品の姿勢。座るポーズは腰の基準点（anchors.hip）を持つ人、立つポーズはそれ以外の人のうち
 * 走る・歩く・座り込む・ひざをつくポーズでないもの。動物には付けない。
 * 立っている人は何をしていても「立っている」と言えるので、姿勢の動詞（stand・sit）は表に 1 行ずつ書かずここで足す
 */
export const postureOf = (
  part: Partial<Pick<Part, "category" | "anchors" | "pose">>,
): "sit" | "stand" | null => {
  if (part.category !== "person") return null;
  if (part.anchors?.hip) return "sit";
  const pose = part.pose ?? "";
  return NOT_STANDING.some((n) => pose === n || pose.startsWith(`${n}_`))
    ? null
    : "stand";
};

/**
 * 部品のポーズで言える動詞と段階。表の動詞に、姿勢の動詞（stand・sit）を足す。
 * ポーズが表に無いとき（部品を足して表を直し忘れたとき）は、部品の words の動詞を使う。
 * その動詞も表に無ければ B2 になり、裏取りで中心の動作としては落ちる（test/pose-verbs.test.ts が表の漏れを見つける）
 */
export const poseVerbsOf = (
  part: Posed,
): { verb: string; level: CefrLevel }[] => {
  const known = part.pose ? POSE_VERBS[part.pose] : undefined;
  const verbs: string[] = known
    ? [...known.verbs]
    : part.words.filter((w) => w.pos === "verb").map((w) => w.word);
  const posture = postureOf(part);
  if (posture && !verbs.includes(posture)) verbs.push(posture);
  return verbs.map((verb) => ({ verb, level: verbLevel(verb) }));
};

/** ポーズのいちばんやさしい動詞の段階（そのポーズを中心に使える、いちばん下の級を決める） */
export const poseLevel = (part: Posed): CefrLevel =>
  poseVerbsOf(part).reduce<CefrLevel>(
    (low, v) => (withinLevel(v.level, low) ? v.level : low),
    "B2",
  );

// 不規則な形。規則どおりの形（-s・-ing・-ed）は verbForms が作る
const IRREGULAR: Partial<Record<Verb, readonly string[]>> = {
  blow: ["blew", "blown"],
  bring: ["brought"],
  build: ["built"],
  buy: ["bought"],
  catch: ["caught"],
  come: ["came"],
  do: ["does", "did", "done"],
  draw: ["drew", "drawn"],
  drink: ["drank", "drunk"],
  eat: ["ate", "eaten"],
  fall: ["fell", "fallen"],
  feed: ["fed"],
  get: ["got", "gotten"],
  give: ["gave", "given"],
  go: ["went", "gone"],
  have: ["has", "had"],
  hold: ["held"],
  kneel: ["knelt"],
  leave: ["left"],
  lie: ["lying", "lay", "lain"],
  make: ["made"],
  pay: ["paid"],
  run: ["ran"],
  say: ["said"],
  see: ["saw", "seen"],
  sell: ["sold"],
  shake: ["shook", "shaken"],
  sit: ["sat"],
  sleep: ["slept"],
  speak: ["spoke", "spoken"],
  stand: ["stood"],
  sweep: ["swept"],
  take: ["took", "taken"],
  teach: ["taught"],
  tell: ["told"],
  throw: ["threw", "thrown"],
  wake: ["woke", "woken"],
  wear: ["wore", "worn"],
  write: ["wrote", "written"],
};

/**
 * 動詞の形の一覧（原形・-s・-ing・-ed・不規則な形）。文の中の語と照らすためのもの。
 * 実在しない形（runed など）も混ざるが、文に出てこないので害は無い
 */
export const verbForms = (verb: string): Set<string> => {
  const forms = new Set([verb, `${verb}s`, `${verb}es`, `${verb}ing`]);
  forms.add(verb.endsWith("e") ? `${verb}d` : `${verb}ed`);
  if (verb.endsWith("e")) forms.add(`${verb.slice(0, -1)}ing`);
  if (verb.endsWith("y")) {
    forms.add(`${verb.slice(0, -1)}ies`);
    forms.add(`${verb.slice(0, -1)}ied`);
  }
  // 子音を重ねる形（running・sitting・clapped）
  const last = verb.slice(-1);
  if (/[^aeiou][aeiou][^aeiouwxy]$/.test(verb)) {
    forms.add(`${verb}${last}ing`);
    forms.add(`${verb}${last}ed`);
  }
  for (const f of isVerb(verb) ? (IRREGULAR[verb] ?? []) : []) forms.add(f);
  return forms;
};

/** 文（英語）を小文字の語に分ける */
export const wordsOf = (text: string): string[] =>
  text.toLowerCase().match(/[a-z]+/g) ?? [];

/** 文の中に出てくる、その部品のポーズの動詞 */
export const poseVerbsIn = (
  text: string,
  part: Posed,
): { verb: string; level: CefrLevel }[] => {
  const words = new Set(wordsOf(text));
  return poseVerbsOf(part).filter((v) =>
    [...verbForms(v.verb)].some((f) => words.has(f)),
  );
};

/**
 * 1 回目の指示に渡す、今の部品で描ける人と動作の語彙。部品の一覧そのものより十分小さい。
 * 1 行は「動作 | 動詞と段階 | できる人」。同じ言い方のポーズ（左右の違いなど）は 1 行にまとめる
 */
export const actionVocabulary = (parts: Part[]): string => {
  const rows = new Map<string, { verbs: string; who: Set<string> }>();
  for (const p of parts) {
    if (p.category !== "person" && p.category !== "animal") continue;
    const verbs = poseVerbsOf(p)
      .map((v) => `${v.verb} ${v.level}`)
      .join(", ");
    const phrase = (p.pose && POSE_VERBS[p.pose]?.phrase) || p.pose || p.id;
    const row = rows.get(phrase) ?? { verbs, who: new Set<string>() };
    // 誰かは words の先頭（man・woman・boy・girl・old man・dog など）
    row.who.add(p.words[0]?.word ?? p.id);
    rows.set(phrase, row);
  }
  return [...rows]
    .map(([phrase, r]) => `- ${phrase} | ${r.verbs} | ${[...r.who].join(", ")}`)
    .join("\n");
};

/** 1 回目の指示に渡す、今の部品にある物と場所。「英語の語（日本語の名前）」で、状態（こぼれた・倒れた）は名前で分かる */
export const thingVocabulary = (parts: Part[]): string => {
  const things = new Set<string>();
  for (const p of parts) {
    if (p.category === "person" || p.category === "animal") continue;
    const noun = p.words.find((w) => w.pos === "noun")?.word;
    if (noun) things.add(`${noun} (${p.label})`);
  }
  return [...things].join(", ");
};

/**
 * 動作の語彙に出てくる動詞のうち、その段階では中心に使えないもの（段階が上のもの）。
 * 1 回目の指示で、級ごとに名指しする
 */
export const verbsAbove = (level: CefrLevel, parts: Part[]): string[] => {
  const verbs = new Set<string>();
  for (const p of parts) {
    if (p.category !== "person" && p.category !== "animal") continue;
    for (const v of poseVerbsOf(p)) {
      if (!withinLevel(v.level, level)) verbs.add(v.verb);
    }
  }
  return [...verbs].sort();
};
