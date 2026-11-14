import type { Part } from "../scenes/types";
import type { RecipeRecord } from "./make";

// 作った部品の置き場（R2、binding BUCKET）。決めたことの正本は docs/design/scene-protocol.md の R2 の節。
//   parts/<id>/<version>.usdz   部品の 3D モデル（GET /parts/{id}/{version}.usdz が返す）
//   parts/<id>/<version>.json   メタデータ（assets/parts/index.json の 1 件と同じ形）
//   recipes/<id>/<version>.json 部品表と、作ったときの注文・時間・費用（RecipeRecord）
// 書く順は usdz → recipes → json で、どれも「無いときだけ置く」（R2 の条件付きの put）。usdz を置けたらその版を取ったことにし、
// 既にあれば版を上げて置き直す（同じ ID を別の Durable Object で同時に作ったとき）。json があれば、その版はそろっている
// （読む側は json を見て有無を決める。GET /parts/{id}/{version}.usdz も json の無い版は返さない）。
// 一度置いた版は書き換えない（アプリは版ごとに取っておくので、中身を変えるときは版を上げる）

export const USDZ_CONTENT_TYPE = "model/vnd.usdz+zip";

export const partUsdzKey = (id: string, version: number) =>
  `parts/${id}/${version}.usdz`;
export const partMetaKey = (id: string, version: number) =>
  `parts/${id}/${version}.json`;
export const recipeKey = (id: string, version: number) =>
  `recipes/${id}/${version}.json`;

/** R2 の部品の版の一覧（既定は json があるもの。ext に usdz を渡せば usdz があるもの。小さい順） */
export const listVersions = async (
  bucket: R2Bucket,
  id: string,
  ext: "json" | "usdz" = "json",
): Promise<number[]> => {
  const versions: number[] = [];
  const pattern = new RegExp(`/([1-9][0-9]*)\\.${ext}$`);
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `parts/${id}/`, cursor });
    for (const o of page.objects) {
      const m = pattern.exec(o.key);
      if (m) versions.push(Number(m[1]));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return versions.sort((a, b) => a - b);
};

/** R2 の部品のメタデータ。version を省くと最も新しい版。無ければ null */
export const readPartMeta = async (
  bucket: R2Bucket,
  id: string,
  version?: number,
): Promise<Part | null> => {
  const v = version ?? (await listVersions(bucket, id)).at(-1);
  if (v === undefined) return null;
  const object = await bucket.get(partMetaKey(id, v));
  if (!object) return null;
  return (await object.json()) as Part;
};

/** 置き直すときに版を上げる回数の上限 */
const MAX_VERSION_TRIES = 5;

/** 無いときだけ置く。既にあれば false（R2 の条件付きの put。公式の文書にある If-None-Match: * の形） */
const putIfAbsent = async (
  bucket: R2Bucket,
  key: string,
  body: string | Uint8Array,
  contentType: string,
): Promise<boolean> =>
  (await bucket.put(key, body, {
    httpMetadata: { contentType },
    onlyIf: new Headers({ "If-None-Match": "*" }),
  })) !== null;

/**
 * 作った部品を置き、置いた版のメタデータを返す。
 * まず usdz を「無いときだけ」置いてその版を取る。試す版は、今ある usdz の版の最大＋1（無ければ meta.version）から。
 * 同じ ID を別の所で同時に作っていて、その版が既にあれば、版を 1 つ上げて置き直す。
 * 版が決まってから recipes → json の順に、これも無いときだけ置く（recipes を置けなければ json は置かずに投げる）。
 * 一度置いた版は書き換えない
 */
export const savePart = async (
  bucket: R2Bucket,
  meta: Part,
  usdz: Uint8Array,
  record: RecipeRecord,
): Promise<Part> => {
  const existing = (await listVersions(bucket, meta.id, "usdz")).at(-1);
  let version = Math.max(meta.version, (existing ?? 0) + 1);
  const first = version;
  let claimed = false;
  for (let i = 0; i < MAX_VERSION_TRIES && !claimed; i++) {
    if (i > 0) version++;
    claimed = await putIfAbsent(
      bucket,
      partUsdzKey(meta.id, version),
      usdz,
      USDZ_CONTENT_TYPE,
    );
  }
  if (!claimed) {
    throw new Error(
      `部品 ${meta.id} の版を取れなかった（${first}〜${version} が既にある）`,
    );
  }
  const placed: Part = {
    ...meta,
    version,
    file: partUsdzKey(meta.id, version),
  };
  const json = "application/json";
  // usdz で版を取ったので、ここで既にあることは無いはず（あれば、その版はほかの物と混ざっているので、json を置かずに投げる）
  if (
    !(await putIfAbsent(
      bucket,
      recipeKey(meta.id, version),
      JSON.stringify({ ...record, version }),
      json,
    ))
  ) {
    throw new Error(`部品 ${meta.id}@${version} の記録が既にあった`);
  }
  if (
    !(await putIfAbsent(
      bucket,
      partMetaKey(meta.id, version),
      JSON.stringify(placed),
      json,
    ))
  ) {
    throw new Error(`部品 ${meta.id}@${version} のメタデータが既にあった`);
  }
  return placed;
};
