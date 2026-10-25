import type { Scene } from "../scoring/types";

export const createSceneRubricRepository = (
  rubrics: CloudflareBindings["SCENE_RUBRICS"],
) => ({
  get: (key: string) => rubrics.getByName(key).get(),
  keep: (key: string, rubric: Scene) => rubrics.getByName(key).keep(rubric),
});

export type SceneRubricRepository = ReturnType<
  typeof createSceneRubricRepository
>;
