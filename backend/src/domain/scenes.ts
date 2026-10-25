import scenes from "../scoring/scenes.json";

// シーンの一覧は採点と同じ scoring/scenes.json を使う
const SCENE_IDS = scenes.map((s) => s.id);

// ホログラム用の映像の場面（hologram: true）。アプリが「ホログラム」で sceneId を指定したときだけ出す
const isHologram = (s: { hologram?: boolean }) => s.hologram === true;
const VANILLA_IDS = scenes.filter((s) => !isHologram(s)).map((s) => s.id);

/** 結果発表に出すシーンの名前（例: 公園） */
export const sceneName = (id: string) =>
  scenes.find((s) => s.id === id)?.name ?? id;

/** 選べるシーンか（ホログラムの場面も含む） */
export const isSceneId = (id: string) => SCENE_IDS.includes(id);

/** 選べるシーンの一覧。kind は今はバニラ（最初から入っているシーン）だけ。ホログラムの場面は入れない */
export const listScenes = () =>
  scenes
    .filter((s) => !isHologram(s))
    .map((s) => ({ id: s.id, name: s.name, kind: "vanilla" as const }));

/** おまかせのときのシーン。ホログラムの場面は選ばない */
export const pickRandomSceneId = () =>
  VANILLA_IDS[Math.floor(Math.random() * VANILLA_IDS.length)];
