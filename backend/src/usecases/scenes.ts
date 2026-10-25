import { composeLayout } from "../scenes/compose";
import {
  type GenerateEnv,
  type GenerateInput,
  type GenerateOptions,
  generatePlan,
  SceneGenerationError,
} from "../scenes/generate";
import { newSceneId } from "../scenes/id";
import { PARTS } from "../scenes/parts";

export type SceneGenerationEnv = GenerateEnv & { SCENE_GENERATION?: string };

/** 生成を止めるスイッチ。on のときだけ動かす（変数が無い・on 以外なら止める）。POST /scenes/generate と部屋で共通 */
export const sceneGenerationEnabled = (env: { SCENE_GENERATION?: string }) =>
  env.SCENE_GENERATION === "on";

/**
 * 難易度（とテーマ）から場面を作り、配置の JSON を返す。保存はしない（作り置きのスクリプトは受け取って確かめ、部屋は自分の保存領域に置く）。
 * Claude には関係だけを書かせ、座標は compose が計算する。失敗は SceneGenerationError で投げる。
 * options は generatePlan に渡す（部屋は 10 秒・1 回だけ・止める signal 付き）
 */
export const generateScene = async (
  env: SceneGenerationEnv,
  input: GenerateInput,
  options: GenerateOptions = {},
) => {
  if (!sceneGenerationEnabled(env)) {
    throw new SceneGenerationError(
      "unavailable",
      "場面の生成は止めてある（SCENE_GENERATION が on でない）",
    );
  }
  const started = Date.now();
  const result = await generatePlan(env, PARTS, input, {}, options);
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
