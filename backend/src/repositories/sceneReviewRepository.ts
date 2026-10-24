import type { ReviewInput } from "../durable-objects/sceneReviews";

const INSTANCE = "global";

export const createSceneReviewRepository = (
  reviews: CloudflareBindings["SCENE_REVIEWS"],
) => ({
  upsert: (input: ReviewInput) => reviews.getByName(INSTANCE).upsert(input),
  summaries: () => reviews.getByName(INSTANCE).summaries(),
  list: (sceneId: string, limit: number) =>
    reviews.getByName(INSTANCE).list(sceneId, limit),
});

export type SceneReviewRepository = ReturnType<
  typeof createSceneReviewRepository
>;
