// mini で作った作り置きの場面を絵で見て、通す・落とすを人が決めたもの（2026-11-12）を、裏取りに掛けるテスト。
// 場面は test/fixtures/pool-v2-review.json（関係だけ。座標は裏取りが計算し直す）。expect が空なら通す場面、
// 空でなければ落とす場面で、そのとき出るはずの理由の code。
// 人が落としたが、コードでは確かめにくいので指示で止めることにした 5 場面（理由の筋・人が隠れる・道の場面）は入れていない
import assert from "node:assert/strict";
import { test } from "node:test";
import { PARTS } from "../src/scenes/parts";
import type { GradeId, SceneSentences } from "../src/scenes/types";
import { verifyScene } from "../src/scenes/verify";
import review from "./fixtures/pool-v2-review.json";

type Scene = SceneSentences & {
  id: string;
  difficulty: GradeId;
  expect: string[];
  items: never[];
};
const scenes = review as unknown as Scene[];

test("絵で見て通すと決めた 21 場面は、裏取りを通る（落としすぎない）", () => {
  const keep = scenes.filter((s) => s.expect.length === 0);
  assert.equal(keep.length, 21);
  for (const s of keep) {
    assert.deepEqual(
      verifyScene(s.difficulty, s, PARTS).map((p) => p.message),
      [],
      s.id,
    );
  }
});

test("絵で見て落とすと決めた場面のうち 9 場面は、決めた理由で落ちる", () => {
  const drop = scenes.filter((s) => s.expect.length > 0);
  assert.equal(drop.length, 9);
  for (const s of drop) {
    const codes = [
      ...new Set(verifyScene(s.difficulty, s, PARTS).map((p) => p.code)),
    ];
    assert.deepEqual(codes, s.expect, s.id);
  }
});
