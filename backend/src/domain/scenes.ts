import { findPoolScene, poolCandidates } from "../scenes/pool";
import { GRADE_IDS, type GradeId } from "../scenes/types";

// 遊べる場面は、作り置きの場面（scenes/pool.ts）と、部屋が AI で作った場面（部屋の保存領域）。
// 手作りの場面は外した（docs/adr/20261111-score-only-with-checklist-and-drop-handmade-scenes.md）

/** 結果発表に出すシーンの名前。作り置きの場面は JSON の name（部屋が作った場面の名前は Round が持つ） */
export const sceneName = (id: string) => findPoolScene(id)?.name ?? id;

/** 選べるシーンか（index.json に載っている作り置きの場面） */
export const isSceneId = (id: string) => findPoolScene(id) !== undefined;

/** 一覧に出すシーン。作り置きの場面は出題まで名前を見せないので、今は 1 つも出さない */
export const listScenes = (): {
  id: string;
  name: string;
  kind: "vanilla";
}[] => [];

/** おまかせ（sceneId も difficulty も無いスタート）のときのシーン。全部の級の出題の候補から選ぶ */
export const pickRandomSceneId = (random: () => number = Math.random) => {
  const all = GRADE_IDS.flatMap((g) => poolCandidates(g));
  return all[Math.floor(random() * all.length)];
};

/**
 * 難易度から作り置きの場面を選ぶ。その部屋でまだ出ていないものからランダムに 1 つ。
 * その難易度を全部出したら、その難易度の分の履歴を消して最初に戻る。選んだ場面を足した履歴も返す
 */
export const pickPoolSceneId = (
  difficulty: GradeId,
  played: readonly string[],
  random: () => number = Math.random,
): { sceneId: string; played: string[] } => {
  const candidates = poolCandidates(difficulty);
  const fresh = candidates.filter((id) => !played.includes(id));
  const history =
    fresh.length > 0
      ? [...played]
      : played.filter((id) => !candidates.includes(id));
  const pool = fresh.length > 0 ? fresh : candidates;
  const sceneId = pool[Math.floor(random() * pool.length)];
  return { sceneId, played: [...history, sceneId] };
};
