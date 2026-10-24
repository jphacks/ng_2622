import scenes from "../scoring/scenes.json";

// シーンの一覧は採点と同じ scoring/scenes.json を使う
const SCENE_IDS = scenes.map((s) => s.id);

/** 選べるシーンか */
export const isSceneId = (id: string) => SCENE_IDS.includes(id);

/** おまかせのときのシーン */
export const pickRandomSceneId = () =>
  SCENE_IDS[Math.floor(Math.random() * SCENE_IDS.length)];
