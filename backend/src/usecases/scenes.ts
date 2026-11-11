import { composeLayoutV2 } from "../scenes/compose-v2";
import {
  type GenerateEnv,
  type GenerateOptions,
  SceneGenerationError,
} from "../scenes/generate";
import {
  type GenerateV2Deps,
  type GenerateV2Input,
  generateSceneV2,
  generateVerifiedScene,
  SceneVerificationError,
} from "../scenes/generate-v2";
import { newSceneId } from "../scenes/id";
import { PARTS } from "../scenes/parts";
import type { SceneLayoutV2 } from "../scenes/types";

export type SceneGenerationEnv = GenerateEnv & { SCENE_GENERATION?: string };

/** 生成を止めるスイッチ。on のときだけ動かす（変数が無い・on 以外なら止める）。POST /scenes/generate と部屋で共通 */
export const sceneGenerationEnabled = (env: { SCENE_GENERATION?: string }) =>
  env.SCENE_GENERATION === "on";

export type GenerateSceneOptions = GenerateOptions & {
  /**
   * 裏取りで落ちたときに、理由を指示に足して作り直すか。
   * 作り置き（POST /scenes/generate）は true。部屋は作り直さず、落ちたら作り置きの場面に切り替える
   */
  remake?: boolean;
};

/**
 * 級（とテーマ）から 2 段の生成で場面を作り、配置の JSON（scenenglish.scene/2）を返す。
 * 保存はしない（作り置きのスクリプトは受け取って確かめ、部屋は自分の保存領域に置く）。
 * Claude には英文と関係を書かせ、裏取り（verify.ts）を通ったものだけ、compose が座標を計算する。
 * 失敗と、裏取りで落ちたときは SceneGenerationError で投げる。deps はテストで Claude を差し替えるためのもの
 */
export const generateScene = async (
  env: SceneGenerationEnv,
  input: GenerateV2Input,
  options: GenerateSceneOptions = {},
  deps: GenerateV2Deps = {},
): Promise<SceneLayoutV2> => {
  if (!sceneGenerationEnabled(env)) {
    throw new SceneGenerationError(
      "unavailable",
      "場面の生成は止めてある（SCENE_GENERATION が on でない）",
    );
  }
  const { remake = false, ...callOptions } = options;
  const started = Date.now();
  const result = remake
    ? await generateVerifiedScene(env, PARTS, input, deps, callOptions)
    : await generateSceneV2(env, PARTS, input, deps, callOptions);
  if ("problems" in result && result.problems.length > 0) {
    throw new SceneVerificationError([result.problems]);
  }
  const sceneId = newSceneId();
  const layout = composeLayoutV2(result.plan, PARTS, {
    id: sceneId,
    grade: input.grade,
  });
  if (layout.items.length === 0) {
    throw new SceneGenerationError("invalid", "置ける部品が無かった");
  }
  console.log(
    JSON.stringify({
      event: "scene_generated",
      sceneId,
      grade: input.grade,
      theme: input.theme ?? null,
      model: result.model,
      remakes: "remakes" in result ? result.remakes : 0,
      elapsedMs: Date.now() - started,
      usage: result.usage,
    }),
  );
  return layout;
};
