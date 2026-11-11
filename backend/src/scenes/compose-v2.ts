import { composeItems, MAX_ITEMS } from "./compose";
import type {
  GradeId,
  LayoutItemV2,
  Part,
  SceneLayoutV2,
  ScenePlanV2,
} from "./types";

// 2 段の生成で書いた場面を、配置の JSON（scenenglish.scene/2）にする。
// 座標は compose.ts の composeItems が計算し、Claude が書いた関係（place・facing・動きの toward・path）も残す

/**
 * 関係（plan）を /2 の配置の JSON にする。裏取り（verify.ts）を通った plan を渡す前提。
 * 一覧に無い部品を飛ばし 40 個までにするのは composeItems と同じ。
 * 同じ key が重なっていれば composeItems が _2 を付けるので、checklist の refs とずれる（裏取りで先に落とす）
 */
export const composeLayoutV2 = (
  plan: ScenePlanV2,
  partList: Part[],
  meta: { id: string; grade: GradeId },
): SceneLayoutV2 => {
  const ids = new Set(partList.map((p) => p.id));
  // composeItems と同じ絞り方。こうしておくと、返ってくる items と順に 1 対 1 で対応する
  const known = plan.items.filter((i) => ids.has(i.part)).slice(0, MAX_ITEMS);
  const placedItems = composeItems(known, partList);
  const items = placedItems.map((placed, n): LayoutItemV2 => {
    const written = known[n];
    const out: LayoutItemV2 = {
      key: placed.key,
      // 顔の向きで左右の部品に替わることがあるので、計算後の部品を使う
      part: placed.part,
      place: written.place,
      ...(written.facing !== undefined ? { facing: written.facing } : {}),
      position: placed.position,
    };
    if (placed.yaw !== undefined) out.yaw = placed.yaw;
    if (placed.scale !== undefined) out.scale = placed.scale;
    if (placed.motion) {
      // 座標の動きに、Claude が書いた動きの関係（toward・path）を並べる
      out.motion = { ...placed.motion };
      if (written.motion?.toward !== undefined)
        out.motion.toward = written.motion.toward;
      if (written.motion?.path !== undefined)
        out.motion.path = written.motion.path;
    }
    return out;
  });
  return {
    protocol: "scenenglish.scene/2",
    id: meta.id,
    name: plan.name.trim(),
    difficulty: meta.grade,
    description: plan.description.trim(),
    checklist: plan.checklist.map((c) => ({
      id: c.id.trim(),
      kind: c.kind,
      label: c.label.trim(),
      accept: c.accept.trim(),
      refs: [...c.refs],
    })),
    items,
  };
};
