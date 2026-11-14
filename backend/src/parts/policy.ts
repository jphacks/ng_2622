// 作らない物の語（中高生が遊ぶ場面に合わない物）。注文の ID・words・label・description にこの語があれば、Claude を呼ばずに断る。
// 断るのは、武器・暴力・性的な物・憎しみの記号・薬物・たばこ・酒。料理の道具の刃物（包丁など）は作ってよい（リーダーの決め）。
// Claude にも同じ種類を断らせる（write.ts の PART_SYSTEM）。ここは、その前に分かりやすい語だけを止める網なので、
// 普通の物を断らないこと（新幹線の bullet train、ナチュラルな木の棚、竹刀、甘酒、ワインレッドのソファなど）を優先する。
// 言い換えて頼まれた物は Claude の断りに任せる

/** 英語の語（単語ごとに比べる。複数形は別に書く） */
const ENGLISH = new Set([
  // 武器・暴力
  "gun",
  "guns",
  "handgun",
  "rifle",
  "pistol",
  "revolver",
  "shotgun",
  "firearm",
  "bullet",
  "bullets",
  "ammo",
  "ammunition",
  "sword",
  "swords",
  "katana",
  "dagger",
  "bomb",
  "bombs",
  "grenade",
  "missile",
  "explosive",
  "explosives",
  "dynamite",
  "weapon",
  "weapons",
  "blood",
  "bloody",
  "corpse",
  // 性的な物
  "sexy",
  "sexual",
  "nude",
  "naked",
  "porn",
  "lingerie",
  "condom",
  // 憎しみの記号
  "swastika",
  "nazi",
  // 薬物
  "drug",
  "drugs",
  "cocaine",
  "heroin",
  "marijuana",
  "cannabis",
  // たばこ
  "cigarette",
  "cigarettes",
  "cigar",
  "cigars",
  "tobacco",
  "vape",
  "ashtray",
  // 酒
  "beer",
  "wine",
  "sake",
  "whisky",
  "whiskey",
  "vodka",
  "liquor",
  "alcohol",
  "champagne",
  "cocktail",
]);

/** 上の語を含んでも普通の物の言い方（2 語。ID は語の順が逆のこともあるので、逆の順も同じに扱う） */
const ENGLISH_COMPOUNDS = [
  ["bullet", "train"],
  ["bullet", "journal"],
  ["blood", "orange"],
  ["blood", "pressure"],
  ["root", "beer"],
  ["ginger", "beer"],
  ["fruit", "cocktail"],
  ["shrimp", "cocktail"],
  ["glue", "gun"],
  ["staple", "gun"],
  ["nail", "gun"],
  ["spray", "gun"],
  ["heat", "gun"],
  ["drug", "store"],
  ["bath", "bomb"],
  ["wine", "glass"],
  ["the", "sake"],
];

/** 色として使われる語。後ろに色の語が続けば（wine red・champagne gold・nude beige）当てない */
const COLOR_WORDS = new Set(["wine", "champagne", "nude", "blood"]);
const COLOR_FOLLOWERS = new Set([
  "red",
  "gold",
  "beige",
  "pink",
  "purple",
  "brown",
  "white",
  "yellow",
  "color",
  "colour",
  "colored",
  "coloured",
]);

/** 日本語の語（含んでいれば断る）。1 字の語（剣・刀・血・酒・裸）は普通の物に当たるので、長い形にしている */
const JAPANESE = [
  "銃",
  "ピストル",
  "ライフル",
  "弾丸",
  "日本刀",
  "刀剣",
  "短刀",
  "短剣",
  "長剣",
  "爆弾",
  "手榴弾",
  "地雷",
  "ミサイル",
  "武器",
  "血まみれ",
  "血だらけ",
  "流血",
  "死体",
  "ヌード",
  "全裸",
  "裸体",
  "ナチス",
  "ハーケンクロイツ",
  "麻薬",
  "大麻",
  "覚醒剤",
  "覚せい剤",
  "たばこ",
  "タバコ",
  "煙草",
  "葉巻",
  "灰皿",
  "お酒",
  "日本酒",
  "酒瓶",
  "酒びん",
  "ビール",
  "ワイン",
  "シャンパン",
  "ウイスキー",
  "ウィスキー",
  "焼酎",
  "アルコール",
  "カクテル",
];

/** 上の語を含んでも普通の物の言い方（先に取り除いてから比べる） */
const JAPANESE_EXCEPTIONS = [
  "ワインレッド",
  "ワインカラー",
  "ワイン色",
  "シャンパンゴールド",
  "ジンジャービール",
  "ノンアルコール",
  "アルコール消毒",
  "消毒用アルコール",
  "フルーツカクテル",
];

const compoundKeys = new Set(
  ENGLISH_COMPOUNDS.flatMap(([a, b]) => [`${a} ${b}`, `${b} ${a}`]),
);

/** 英語の語の並び（ID の _ や記号は区切り）から、作らない物の語を探す */
const englishTerm = (text: string): string | null => {
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 0);
  const allowed = new Set<number>();
  for (let i = 0; i + 1 < words.length; i++) {
    if (compoundKeys.has(`${words[i]} ${words[i + 1]}`)) {
      allowed.add(i);
      allowed.add(i + 1);
    }
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (allowed.has(i) || !ENGLISH.has(w)) continue;
    if (COLOR_WORDS.has(w) && COLOR_FOLLOWERS.has(words[i + 1] ?? "")) continue;
    return w;
  }
  return null;
};

const japaneseTerm = (text: string): string | null => {
  let rest = text;
  for (const e of JAPANESE_EXCEPTIONS) rest = rest.split(e).join("・");
  return JAPANESE.find((t) => rest.includes(t)) ?? null;
};

/** 注文の中の、作らない物の語を見る所 */
export type RefusalFields = {
  id?: string;
  words?: string[];
  label?: string;
  description?: string;
};

/**
 * 作らない物の語を含んでいれば、その語を返す。無ければ null。
 * 注文（id・words・label・description）を渡せば全部を、文字列を渡せばその文字列だけを見る
 */
export function refusedTerm(input: string | RefusalFields): string | null {
  const texts =
    typeof input === "string"
      ? [input]
      : [
          input.id ?? "",
          ...(input.words ?? []),
          input.label ?? "",
          input.description ?? "",
        ];
  for (const text of texts) {
    const term = englishTerm(text) ?? japaneseTerm(text);
    if (term) return term;
  }
  return null;
}
