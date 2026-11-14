import gen_v2_eiken2_beach_09 from "./pool/gen-v2-eiken2-beach-09.json";
import gen_v2_eiken2_bus_stop_11 from "./pool/gen-v2-eiken2-bus-stop-11.json";
import gen_v2_eiken2_bus_stop_23 from "./pool/gen-v2-eiken2-bus-stop-23.json";
import gen_v2_eiken2_bus_stop_35 from "./pool/gen-v2-eiken2-bus-stop-35.json";
import gen_v2_eiken2_cafe_02 from "./pool/gen-v2-eiken2-cafe-02.json";
import gen_v2_eiken2_classroom_18 from "./pool/gen-v2-eiken2-classroom-18.json";
import gen_v2_eiken2_kitchen_05 from "./pool/gen-v2-eiken2-kitchen-05.json";
import gen_v2_eiken2_living_room_07 from "./pool/gen-v2-eiken2-living-room-07.json";
import gen_v2_eiken2_living_room_31 from "./pool/gen-v2-eiken2-living-room-31.json";
import gen_v2_eiken2_park_13 from "./pool/gen-v2-eiken2-park-13.json";
import gen_v2_eiken2_playground_24 from "./pool/gen-v2-eiken2-playground-24.json";
import gen_v2_eiken2_street_34 from "./pool/gen-v2-eiken2-street-34.json";
import gen_v2_eiken2_train_station_04 from "./pool/gen-v2-eiken2-train-station-04.json";
import gen_v2_eiken3_beach_09 from "./pool/gen-v2-eiken3-beach-09.json";
import gen_v2_eiken3_beach_45 from "./pool/gen-v2-eiken3-beach-45.json";
import gen_v2_eiken3_bus_stop_11 from "./pool/gen-v2-eiken3-bus-stop-11.json";
import gen_v2_eiken3_bus_stop_47 from "./pool/gen-v2-eiken3-bus-stop-47.json";
import gen_v2_eiken3_cafe_02 from "./pool/gen-v2-eiken3-cafe-02.json";
import gen_v2_eiken3_cafe_38 from "./pool/gen-v2-eiken3-cafe-38.json";
import gen_v2_eiken3_classroom_06 from "./pool/gen-v2-eiken3-classroom-06.json";
import gen_v2_eiken3_classroom_42 from "./pool/gen-v2-eiken3-classroom-42.json";
import gen_v2_eiken3_kitchen_05 from "./pool/gen-v2-eiken3-kitchen-05.json";
import gen_v2_eiken3_kitchen_41 from "./pool/gen-v2-eiken3-kitchen-41.json";
import gen_v2_eiken3_library_08 from "./pool/gen-v2-eiken3-library-08.json";
import gen_v2_eiken3_library_44 from "./pool/gen-v2-eiken3-library-44.json";
import gen_v2_eiken3_living_room_31 from "./pool/gen-v2-eiken3-living-room-31.json";
import gen_v2_eiken3_park_01 from "./pool/gen-v2-eiken3-park-01.json";
import gen_v2_eiken3_park_37 from "./pool/gen-v2-eiken3-park-37.json";
import gen_v2_eiken3_playground_12 from "./pool/gen-v2-eiken3-playground-12.json";
import gen_v2_eiken3_playground_48 from "./pool/gen-v2-eiken3-playground-48.json";
import gen_v2_eiken3_store_39 from "./pool/gen-v2-eiken3-store-39.json";
import gen_v2_eiken3_street_10 from "./pool/gen-v2-eiken3-street-10.json";
import gen_v2_eiken3_street_34 from "./pool/gen-v2-eiken3-street-34.json";
import gen_v2_eiken3_train_station_04 from "./pool/gen-v2-eiken3-train-station-04.json";
import gen_v2_eiken3_train_station_40 from "./pool/gen-v2-eiken3-train-station-40.json";
import gen_v2_pre2_beach_09 from "./pool/gen-v2-pre2-beach-09.json";
import gen_v2_pre2_beach_21 from "./pool/gen-v2-pre2-beach-21.json";
import gen_v2_pre2_bus_stop_11 from "./pool/gen-v2-pre2-bus-stop-11.json";
import gen_v2_pre2_cafe_02 from "./pool/gen-v2-pre2-cafe-02.json";
import gen_v2_pre2_kitchen_17 from "./pool/gen-v2-pre2-kitchen-17.json";
import gen_v2_pre2_library_20 from "./pool/gen-v2-pre2-library-20.json";
import gen_v2_pre2_library_32 from "./pool/gen-v2-pre2-library-32.json";
import gen_v2_pre2_living_room_07 from "./pool/gen-v2-pre2-living-room-07.json";
import gen_v2_pre2_living_room_31 from "./pool/gen-v2-pre2-living-room-31.json";
import gen_v2_pre2_park_01 from "./pool/gen-v2-pre2-park-01.json";
import gen_v2_pre2_playground_24 from "./pool/gen-v2-pre2-playground-24.json";
import gen_v2_pre2_street_34 from "./pool/gen-v2-pre2-street-34.json";
import gen_v2_pre2_train_station_16 from "./pool/gen-v2-pre2-train-station-16.json";
import index from "./pool/index.json";
import { GRADE_IDS, type GradeId, type SceneLayoutV2 } from "./types";

// 作り置きの場面（pool/）を Worker に同梱する。Worker は glob できないので 1 つずつ import する。
// 場面を足すときは、pool/ に JSON を置き、index.json とここの両方に足す（test/pool.test.ts が食い違いを見つける）。
// 今あるのは、2 段の生成で作り、絵で選んだ 48 場面（級ごとに例 1 つ。出題は 3 級 21・準 2 級 12・2 級 12。pool/README.md）

/** 配置の JSON（scenenglish.scene/2） */
export type PoolScene = SceneLayoutV2;

const ALL = [
  gen_v2_eiken3_park_01,
  gen_v2_eiken3_beach_09,
  gen_v2_eiken3_bus_stop_11,
  gen_v2_eiken3_cafe_02,
  gen_v2_eiken3_classroom_06,
  gen_v2_eiken3_kitchen_05,
  gen_v2_eiken3_library_08,
  gen_v2_eiken3_playground_12,
  gen_v2_eiken3_street_10,
  gen_v2_eiken3_train_station_04,
  gen_v2_pre2_park_01,
  gen_v2_pre2_beach_09,
  gen_v2_pre2_beach_21,
  gen_v2_pre2_bus_stop_11,
  gen_v2_pre2_cafe_02,
  gen_v2_pre2_kitchen_17,
  gen_v2_pre2_library_20,
  gen_v2_pre2_living_room_07,
  gen_v2_pre2_playground_24,
  gen_v2_pre2_train_station_16,
  gen_v2_eiken2_kitchen_05,
  gen_v2_eiken2_beach_09,
  gen_v2_eiken2_bus_stop_11,
  gen_v2_eiken2_bus_stop_23,
  gen_v2_eiken2_cafe_02,
  gen_v2_eiken2_classroom_18,
  gen_v2_eiken2_living_room_07,
  gen_v2_eiken2_park_13,
  gen_v2_eiken2_playground_24,
  gen_v2_eiken2_train_station_04,
  gen_v2_eiken3_store_39,
  gen_v2_eiken3_living_room_31,
  gen_v2_eiken3_kitchen_41,
  gen_v2_eiken3_classroom_42,
  gen_v2_eiken3_cafe_38,
  gen_v2_eiken3_train_station_40,
  gen_v2_eiken3_street_34,
  gen_v2_eiken3_playground_48,
  gen_v2_eiken3_park_37,
  gen_v2_eiken3_beach_45,
  gen_v2_eiken3_bus_stop_47,
  gen_v2_eiken3_library_44,
  gen_v2_pre2_library_32,
  gen_v2_pre2_street_34,
  gen_v2_pre2_living_room_31,
  gen_v2_eiken2_living_room_31,
  gen_v2_eiken2_street_34,
  gen_v2_eiken2_bus_stop_35,
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
