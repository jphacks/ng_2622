import scenes from "../scoring/scenes.json";

// シーンの一覧は採点と同じ scoring/scenes.json を使う
const SCENE_IDS = scenes.map((s) => s.id);

/** 結果発表に出すシーンの名前（例: 公園） */
export const sceneName = (id: string) =>
  scenes.find((s) => s.id === id)?.name ?? id;

/** 選べるシーンか */
export const isSceneId = (id: string) => SCENE_IDS.includes(id);

/** 選べるシーンの一覧。kind は今はバニラ（最初から入っているシーン）だけ */
export const listScenes = () =>
  scenes.map((s) => ({ id: s.id, name: s.name, kind: "vanilla" as const }));

/** おまかせのときのシーン */
export const pickRandomSceneId = () =>
  SCENE_IDS[Math.floor(Math.random() * SCENE_IDS.length)];
