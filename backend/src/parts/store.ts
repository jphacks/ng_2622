import type { Part } from "../scenes/types";
import type { RecipeRecord } from "./make";

// 作った部品の置き場（R2、binding BUCKET）。決めたことの正本は docs/design/scene-protocol.md の R2 の節。
//   parts/<id>/<version>.usdz   部品の 3D モデル（GET /parts/{id}/{version}.usdz が返す）
//   parts/<id>/<version>.json   メタデータ（assets/parts/index.json の 1 件と同じ形）
//   recipes/<id>/<version>.json 部品表と、作ったときの注文・時間・費用（RecipeRecord）
// 書く順は usdz → recipes → json。json があれば、その版はそろっている（読む側は json を見て有無を決める）。
// 一度置いた版は書き換えない（アプリは版ごとに取っておくので、中身を変えるときは版を上げる）

export const USDZ_CONTENT_TYPE = "model/vnd.usdz+zip";

export const partUsdzKey = (id: string, version: number) =>
  `parts/${id}/${version}.usdz`;
export const partMetaKey = (id: string, version: number) =>
  `parts/${id}/${version}.json`;
export const recipeKey = (id: string, version: number) =>
  `recipes/${id}/${version}.json`;

/** R2 の部品の版の一覧（json があるものだけ。小さい順） */
export const listVersions = async (
  bucket: R2Bucket,
  id: string,
): Promise<number[]> => {
  const versions: number[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `parts/${id}/`, cursor });
    for (const o of page.objects) {
      const m = /\/([1-9][0-9]*)\.json$/.exec(o.key);
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

/** 作った部品を置く（usdz → recipes → json の順） */
export const savePart = async (
  bucket: R2Bucket,
  meta: Part,
  usdz: Uint8Array,
  record: RecipeRecord,
): Promise<void> => {
  const json = { httpMetadata: { contentType: "application/json" } };
  await bucket.put(partUsdzKey(meta.id, meta.version), usdz, {
    httpMetadata: { contentType: USDZ_CONTENT_TYPE },
  });
  await bucket.put(
    recipeKey(meta.id, meta.version),
    JSON.stringify(record),
    json,
  );
  await bucket.put(
    partMetaKey(meta.id, meta.version),
    JSON.stringify(meta),
    json,
  );
};
