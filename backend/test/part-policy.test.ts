// 作らない物の語（src/parts/policy.ts）。断る物は断り、普通の物は断らない
import assert from "node:assert/strict";
import { test } from "node:test";
import { refusedTerm } from "../src/parts/policy";

test("武器・酒・たばこ・薬物などの語は断る", () => {
  const cases: [string, string][] = [
    ["gun", "gun"],
    ["toy_gun", "gun"],
    ["sword", "sword"],
    ["a bottle of beer", "beer"],
    ["beer_bottle", "beer"],
    ["ashtray", "ashtray"],
    ["a box of cigarettes", "cigarettes"],
    ["red wine", "wine"],
    ["drugs", "drugs"],
    ["拳銃", "銃"],
    ["日本刀", "日本刀"],
    ["たばこの箱", "たばこ"],
    ["日本酒の瓶", "日本酒"],
    ["お酒", "お酒"],
    ["ビールの瓶", "ビール"],
    ["ワインのボトル", "ワイン"],
    ["ナチスの旗", "ナチス"],
  ];
  for (const [text, term] of cases) assert.equal(refusedTerm(text), term, text);
});

test("普通の物は断らない（合成語・色の語・1 字の日本語が当たらない）", () => {
  for (const text of [
    "bullet train",
    "train_bullet",
    "blood orange",
    "a blood pressure monitor",
    "a wine-red sofa",
    "wine glass",
    "root beer",
    "fruit cocktail",
    "glue gun",
    "drug store",
    "nude beige",
    "champagne gold",
    "for the sake of",
    "kitchen_knife",
    "a kitchen knife with a wooden handle",
    "swordfish",
    "glasses",
    "ナチュラルな木の棚",
    "ナチョス",
    "剣道の防具",
    "剣山",
    "竹刀",
    "木刀",
    "血圧計",
    "甘酒",
    "ワインレッドのソファ",
    "シャンパンゴールドの時計",
    "裸電球",
    "包丁",
    "ノンアルコールの飲み物",
  ]) {
    assert.equal(refusedTerm(text), null, text);
  }
});

test("注文を渡すと id・words・label・description を全部見る", () => {
  const order = {
    id: "bottle_green",
    words: ["bottle"],
    label: "緑の瓶",
    description: "A green glass bottle.",
  };
  assert.equal(refusedTerm(order), null);
  assert.equal(refusedTerm({ ...order, label: "ビールの瓶" }), "ビール");
  assert.equal(
    refusedTerm({ ...order, description: "A green bottle of whisky." }),
    "whisky",
  );
  assert.equal(refusedTerm({ ...order, words: ["bottle", "sake"] }), "sake");
  // 色としての wine は description でも断らない
  assert.equal(
    refusedTerm({ ...order, description: "A wine red glass bottle." }),
    null,
  );
});
