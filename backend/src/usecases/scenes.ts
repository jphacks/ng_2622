import { composeLayout } from "../scenes/compose";
import {
  type GenerateEnv,
  type GenerateInput,
  generatePlan,
  SceneGenerationError,
} from "../scenes/generate";
import { newSceneId } from "../scenes/id";
import { PARTS } from "../scenes/parts";

/**
 * 難易度（とテーマ）から場面を作り、配置の JSON を返す。保存はしない（作り置きのスクリプトが受け取って確かめる）。
 * Claude には関係だけを書かせ、座標は compose が計算する。失敗は SceneGenerationError で投げる
 */
export const generateScene = async (
  env: GenerateEnv & { SCENE_GENERATION?: string },
  input: GenerateInput,
) => {
  // on のときだけ動かす（変数が無い・on 以外なら止める）
  if (env.SCENE_GENERATION !== "on") {
    throw new SceneGenerationError(
      "unavailable",
      "場面の生成は止めてある（SCENE_GENERATION が on でない）",
    );
  }
  const started = Date.now();
  const result = await generatePlan(env, PARTS, input);
  const sceneId = newSceneId();
  const layout = composeLayout(result.plan, PARTS, {
    id: sceneId,
    difficulty: input.difficulty,
  });
  if (layout.items.length === 0 || layout.elements.length === 0) {
    throw new SceneGenerationError("invalid", "置ける部品か要素が無かった");
  }
  console.log(
    JSON.stringify({
      event: "scene_generated",
      sceneId,
      difficulty: input.difficulty,
      theme: input.theme ?? null,
      model: result.model,
      attempts: result.attempts,
      elapsedMs: Date.now() - started,
      usage: result.usage,
    }),
  );
  return layout;
};
