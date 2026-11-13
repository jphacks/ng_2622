// 苦手の場面の口（POST /weak-scenes）の中身。止めるスイッチ・回数の上限を見てから、苦手を入れた場面を作る

export type WeakSceneEnv = {
  // "on" のときだけ作る。PR のプレビューは off（wrangler.jsonc の previews）
  WEAK_SCENE_GENERATION?: string;
};

/** 本文の大きさの上限（バイト）。癖 3 個の題と直し方・次に試すことで 2 KB ほど */
export const WEAK_SCENE_MAX_BODY_BYTES = 8_192;

/** 止めるスイッチ。on のときだけ動かす（変数が無い・on 以外なら止める） */
export const weakScenesEnabled = (env: WeakSceneEnv) =>
  env.WEAK_SCENE_GENERATION === "on";
