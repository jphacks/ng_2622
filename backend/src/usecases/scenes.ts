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
  MAX_REMAKES,
  SceneVerificationError,
} from "../scenes/generate-v2";
import { newSceneId } from "../scenes/id";
import { withVersions } from "../scenes/lookup";
import { PARTS } from "../scenes/parts";
import type { Part, SceneLayoutV2 } from "../scenes/types";
import { workshopOf } from "./workshop";

export type SceneGenerationEnv = GenerateEnv & {
  // 作った部品の置き場（R2）。ID の規約で引く道で、前に作った部品を引き、足りない部品を作って置く
  BUCKET?: R2Bucket;
  SCENE_GENERATION?: string;
  // 2 回目の部品の引き方。"convention" なら ID の規約で引き（部品の一覧を出さず、無い物は作る）、
  // それ以外（既定）は今の道（部品の一覧を出す）。苦手の場面（POST /weak-scenes）はいつも規約で引く
  SCENE_PART_LOOKUP?: string;
};

/** 2 回目を ID の規約で引くか（SCENE_PART_LOOKUP が convention のときだけ） */
export const partLookupByConvention = (env: { SCENE_PART_LOOKUP?: string }) =>
  env.SCENE_PART_LOOKUP === "convention";

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
): Promise<SceneLayoutV2> =>
  (await generateSceneWithParts(env, input, options, deps)).layout;

/**
 * generateScene と同じ。配置と一緒に、配置が使う同梱に無い部品（ID の規約で引いた道で、前に作った・その場で作った部品）の
 * メタデータも返す（部屋が配置と一緒に置き、採点に渡す）。部品の一覧を出す道では parts は空
 */
export const generateSceneWithParts = async (
  env: SceneGenerationEnv,
  input: GenerateV2Input,
  options: GenerateSceneOptions = {},
  deps: GenerateV2Deps = {},
): Promise<{ layout: SceneLayoutV2; parts: Part[] }> => {
  if (!sceneGenerationEnabled(env)) {
    throw new SceneGenerationError(
      "unavailable",
      "場面の生成は止めてある（SCENE_GENERATION が on でない）",
    );
  }
  const { remake = false, ...callOptions } = options;
  const started = Date.now();
  const convention = partLookupByConvention(env);
  const bucket = env.BUCKET;
  if (convention && !bucket && !deps.lookup) {
    throw new SceneGenerationError(
      "unavailable",
      "部品の置き場（BUCKET）が無いので、ID の規約で引けない",
    );
  }
  const result =
    remake || convention
      ? await generateVerifiedScene(
          env,
          PARTS,
          input,
          convention
            ? {
                ...deps,
                lookup: deps.lookup ?? {
                  workshop: workshopOf({ ...env, BUCKET: bucket as R2Bucket }),
                },
              }
            : deps,
          { ...callOptions, maxRemakes: remake ? MAX_REMAKES : 0 },
        )
      : await generateSceneV2(env, PARTS, input, deps, callOptions);
  if ("problems" in result && result.problems.length > 0) {
    throw new SceneVerificationError([result.problems]);
  }
  const sceneId = newSceneId();
  const extra = "extraParts" in result ? result.extraParts : [];
  const layout = withVersions(
    composeLayoutV2(result.plan, [...PARTS, ...extra], {
      id: sceneId,
      grade: input.grade,
    }),
    extra,
  );
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
  return { layout, parts: extra };
};
