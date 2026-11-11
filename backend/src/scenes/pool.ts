import index from "./pool/index.json";
import temp_eiken_2_rain from "./pool/temp-eiken-2-rain.json";
import temp_eiken_2_street from "./pool/temp-eiken-2-street.json";
import temp_eiken_3_park from "./pool/temp-eiken-3-park.json";
import temp_eiken_3_room from "./pool/temp-eiken-3-room.json";
import temp_eiken_pre2_bus_stop from "./pool/temp-eiken-pre2-bus-stop.json";
import temp_eiken_pre2_park from "./pool/temp-eiken-pre2-park.json";
import { GRADE_IDS, type GradeId, type SceneLayoutV2 } from "./types";

// 作り置きの場面（pool/）を Worker に同梱する。Worker は glob できないので 1 つずつ import する。
// 場面を足すときは、pool/ に JSON を置き、index.json とここの両方に足す（test/pool.test.ts が食い違いを見つける）。
// 今あるのは仮の場面（temp-…）。人が確かめた場面（gen-…）ができたら差し替える（pool/README.md）

/** 配置の JSON（scenenglish.scene/2） */
export type PoolScene = SceneLayoutV2;

const ALL = [
  temp_eiken_3_park,
  temp_eiken_3_room,
  temp_eiken_pre2_bus_stop,
  temp_eiken_pre2_park,
  temp_eiken_2_street,
  temp_eiken_2_rain,
] as unknown as PoolScene[];

const byId = new Map(ALL.map((s) => [s.id, s]));

type PoolIndex = Record<GradeId, { example: string; scenes: string[] }>;
const POOL_INDEX = index as PoolIndex;

/** index.json に載っている場面（例を含む）。載っていない JSON は使わない */
const listed = new Set(
  GRADE_IDS.flatMap((g) => [POOL_INDEX[g].example, ...POOL_INDEX[g].scenes]),
);

/** 作り置きの場面。例（待合で見せるもの）も引ける */
export const findPoolScene = (id: string): PoolScene | undefined =>
  listed.has(id) ? byId.get(id) : undefined;

/** その級の出題の候補（例は入れない） */
export const poolCandidates = (grade: GradeId): readonly string[] =>
  POOL_INDEX[grade].scenes;

/** test 用。import した場面の ID */
export const importedPoolIds = () => ALL.map((s) => s.id);
