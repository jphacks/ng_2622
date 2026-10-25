import gen_1oi548k4rk from "./pool/gen-1oi548k4rk.json";
import gen_3brfrhl0g2 from "./pool/gen-3brfrhl0g2.json";
import gen_3q2mp65pln from "./pool/gen-3q2mp65pln.json";
import gen_6sl29jx4d9 from "./pool/gen-6sl29jx4d9.json";
import gen_7q5atbrxwd from "./pool/gen-7q5atbrxwd.json";
import gen_8a52kkiyuq from "./pool/gen-8a52kkiyuq.json";
import gen_54o1w0cyfk from "./pool/gen-54o1w0cyfk.json";
import gen_098scv1adb from "./pool/gen-098scv1adb.json";
import gen_108v6d7kie from "./pool/gen-108v6d7kie.json";
import gen_anbqt6gsb3 from "./pool/gen-anbqt6gsb3.json";
import gen_b69go6aaqu from "./pool/gen-b69go6aaqu.json";
import gen_b5438s2pun from "./pool/gen-b5438s2pun.json";
import gen_d02dgjnp80 from "./pool/gen-d02dgjnp80.json";
import gen_ew36womk49 from "./pool/gen-ew36womk49.json";
import gen_fxzxvf5i8z from "./pool/gen-fxzxvf5i8z.json";
import gen_fzvbjc8jo0 from "./pool/gen-fzvbjc8jo0.json";
import gen_g8g7nvgt9v from "./pool/gen-g8g7nvgt9v.json";
import gen_gndqrszqbh from "./pool/gen-gndqrszqbh.json";
import gen_hd0dvf0mlv from "./pool/gen-hd0dvf0mlv.json";
import gen_ik3kjed8w0 from "./pool/gen-ik3kjed8w0.json";
import gen_j4o1dkp18j from "./pool/gen-j4o1dkp18j.json";
import gen_nx763d6t1t from "./pool/gen-nx763d6t1t.json";
import gen_ollvx1uzar from "./pool/gen-ollvx1uzar.json";
import gen_qccd1abq3c from "./pool/gen-qccd1abq3c.json";
import gen_s6rtuhtzvz from "./pool/gen-s6rtuhtzvz.json";
import gen_terxgvs6j3 from "./pool/gen-terxgvs6j3.json";
import gen_vzcedkhyvr from "./pool/gen-vzcedkhyvr.json";
import gen_xef36toaa0 from "./pool/gen-xef36toaa0.json";
import gen_yy111spsnv from "./pool/gen-yy111spsnv.json";
import gen_zd2giq5tll from "./pool/gen-zd2giq5tll.json";
import index from "./pool/index.json";
import { DIFFICULTIES, type Difficulty, type SceneLayout } from "./types";

// 作り置きの場面（pool/）を Worker に同梱する。Worker は glob できないので 1 つずつ import する。
// 場面を足すときは、pool/ に JSON を置き、index.json とここの両方に足す（test/pool.test.ts が食い違いを見つける）

export type { Difficulty };

/** 配置の JSON（scenenglish.scene/1、types.ts の SceneLayout） */
export type PoolScene = SceneLayout;

const ALL = [
  gen_098scv1adb,
  gen_108v6d7kie,
  gen_1oi548k4rk,
  gen_3brfrhl0g2,
  gen_3q2mp65pln,
  gen_54o1w0cyfk,
  gen_6sl29jx4d9,
  gen_7q5atbrxwd,
  gen_8a52kkiyuq,
  gen_anbqt6gsb3,
  gen_b5438s2pun,
  gen_b69go6aaqu,
  gen_d02dgjnp80,
  gen_ew36womk49,
  gen_fxzxvf5i8z,
  gen_fzvbjc8jo0,
  gen_g8g7nvgt9v,
  gen_gndqrszqbh,
  gen_hd0dvf0mlv,
  gen_ik3kjed8w0,
  gen_j4o1dkp18j,
  gen_nx763d6t1t,
  gen_ollvx1uzar,
  gen_qccd1abq3c,
  gen_s6rtuhtzvz,
  gen_terxgvs6j3,
  gen_vzcedkhyvr,
  gen_xef36toaa0,
  gen_yy111spsnv,
  gen_zd2giq5tll,
] as unknown as PoolScene[];

const byId = new Map(ALL.map((s) => [s.id, s]));

type PoolIndex = Record<Difficulty, { example: string; scenes: string[] }>;
const POOL_INDEX = index as PoolIndex;

/** index.json に載っている場面（例を含む）。載っていない JSON は使わない */
const listed = new Set(
  DIFFICULTIES.flatMap((d) => [POOL_INDEX[d].example, ...POOL_INDEX[d].scenes]),
);

/** 作り置きの場面。例（待合で見せるもの）も引ける */
export const findPoolScene = (id: string): PoolScene | undefined =>
  listed.has(id) ? byId.get(id) : undefined;

/** その難易度の出題の候補（例は入れない） */
export const poolCandidates = (difficulty: Difficulty): readonly string[] =>
  POOL_INDEX[difficulty].scenes;

/** test 用。import した場面の ID */
export const importedPoolIds = () => ALL.map((s) => s.id);
