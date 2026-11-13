// 作らない物の語（中高生が遊ぶ場面に合わない物）。注文の ID・words・label・description にこの語があれば、Claude を呼ばずに断る。
// 断るのは、武器・暴力・性的な物・憎しみの記号・薬物・たばこ・酒。料理の道具の刃物（包丁など）は作ってよい（リーダーの決め）。
// Claude にも同じ種類を断らせる（write.ts の PART_SYSTEM）。ここは、その前に分かりやすい語だけを止める網

/** 英語の語（単語の境目で比べる。複数形は別に書く） */
const ENGLISH = [
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
];

/** 日本語の語（含んでいれば断る） */
const JAPANESE = [
  "銃",
  "ピストル",
  "ライフル",
  "弾丸",
  "剣",
  "刀",
  "爆弾",
  "手榴弾",
  "ミサイル",
  "武器",
  "血",
  "死体",
  "ヌード",
  "裸",
  "ナチ",
  "ハーケンクロイツ",
  "麻薬",
  "大麻",
  "覚醒剤",
  "たばこ",
  "タバコ",
  "煙草",
  "葉巻",
  "灰皿",
  "酒",
  "ビール",
  "ワイン",
  "ウイスキー",
  "焼酎",
  "アルコール",
  "カクテル",
];

const ENGLISH_SET = new Set(ENGLISH);

/** 作らない物の語を含んでいれば、その語を返す。無ければ null */
export const refusedTerm = (text: string): string | null => {
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    if (ENGLISH_SET.has(word)) return word;
  }
  for (const term of JAPANESE) {
    if (text.includes(term)) return term;
  }
  return null;
};
