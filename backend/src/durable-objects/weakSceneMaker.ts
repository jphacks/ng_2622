import { DurableObject } from "cloudflare:workers";
import { createWeakSceneRepository } from "../repositories/weakSceneRepository";
import {
  makeWeakScene,
  type WeakSceneEnv,
  type WeakSceneInput,
  type WeakSceneOutcome,
} from "../usecases/weakScenes";
import { workshopOf } from "../usecases/workshop";

// 苦手の場面を作る Durable Object。場面の裏取りと座標の計算（verify.ts・compose.ts）は CPU を 1 回 10〜50 ms 使い、
// Worker の無料プランの CPU の上限（10 ms）を超えるので、ここで動かす。1 回ごとに新しいインスタンス（newUniqueId）で、
// 保存領域は使わない（作った場面は R2 に置く）。回数の上限は呼ぶ側（routes/weakScenes.ts）が数える
export class WeakSceneMaker extends DurableObject<CloudflareBindings> {
  async make(input: WeakSceneInput): Promise<WeakSceneOutcome> {
    const env = this.env as CloudflareBindings & WeakSceneEnv;
    return makeWeakScene(env, input, {
      workshop: workshopOf(env),
      store: createWeakSceneRepository(env.BUCKET),
    });
  }
}
