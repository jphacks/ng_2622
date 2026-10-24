import { listScenes } from "../domain/scenes";
import type { ReviewInput } from "../durable-objects/sceneReviews";
import type { SceneReviewRepository } from "../repositories/sceneReviewRepository";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** シーンの一覧と、それぞれの★の平均（小数第 1 位まで）と件数 */
export const listScenesWithRatings = async (
  repository: SceneReviewRepository,
) => {
  const summaries = await repository.summaries();
  return listScenes().map((scene) => {
    const s = summaries.find((x) => x.sceneId === scene.id);
    return {
      ...scene,
      rating: { average: s ? round1(s.average) : null, count: s?.count ?? 0 },
    };
  });
};

/** 評価を保存し、そのシーンの新しい平均と件数を返す */
export const submitReview = async (
  repository: SceneReviewRepository,
  input: ReviewInput,
) => {
  const s = await repository.upsert(input);
  return { average: round1(s.average), count: s.count };
};

export const listReviews = (
  repository: SceneReviewRepository,
  sceneId: string,
  limit: number,
) => repository.list(sceneId, limit);
