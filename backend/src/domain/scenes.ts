import { type Difficulty, findPoolScene, poolCandidates } from "../scenes/pool";
import scenes from "../scoring/scenes.json";

// 手作りのシーンの一覧は採点と同じ scoring/scenes.json を使う。作り置きの場面は scenes/pool.ts
const SCENE_IDS = scenes.map((s) => s.id);

/** 結果発表に出すシーンの名前（例: 公園）。作り置きの場面は JSON の name */
export const sceneName = (id: string) =>
  findPoolScene(id)?.name ?? scenes.find((s) => s.id === id)?.name ?? id;

/** 選べるシーンか（手作りの場面と、index.json に載っている作り置きの場面） */
export const isSceneId = (id: string) =>
  SCENE_IDS.includes(id) || findPoolScene(id) !== undefined;

/** 選べるシーンの一覧。kind は今はバニラ（最初から入っているシーン）だけ。作り置きの場面は名前を見せないので出さない */
export const listScenes = () =>
  scenes.map((s) => ({ id: s.id, name: s.name, kind: "vanilla" as const }));

/** おまかせのときのシーン（手作りの場面から） */
export const pickRandomSceneId = () =>
  SCENE_IDS[Math.floor(Math.random() * SCENE_IDS.length)];

/**
 * 難易度から作り置きの場面を選ぶ。その部屋でまだ出ていないものからランダムに 1 つ。
 * その難易度を全部出したら、その難易度の分の履歴を消して最初に戻る。選んだ場面を足した履歴も返す
 */
export const pickPoolSceneId = (
  difficulty: Difficulty,
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
