import type { ReviewInput } from "../durable-objects/sceneReviews";
import type { SceneReviewRepository } from "../repositories/sceneReviewRepository";

const round1 = (n: number) => Math.round(n * 10) / 10;

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
