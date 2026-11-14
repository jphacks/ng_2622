// GET /parts/{id}/{version}.usdz（src/routes/parts.ts）。R2 は miniflare の偽物
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { partRoutes } from "../src/routes/parts";

let mf: Miniflare;
let bucket: R2Bucket;

before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch: () => new Response(null) }",
      r2Buckets: ["BUCKET"],
    }),
  );
  bucket = (await mf.getR2Bucket("BUCKET")) as unknown as R2Bucket;
});

after(() => mf.dispose());

test("GET /parts/{id}/{version}.usdz は R2 の USDZ を返し、無ければ 404", async () => {
  const usdz = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  await bucket.put("parts/mailbox/1.usdz", usdz);
  await bucket.put("parts/mailbox/1.json", "{}");
  // 作っている途中（json がまだ無い）の版は返さない
  await bucket.put("parts/mailbox/2.usdz", usdz);
  const env = { BUCKET: bucket };
  const res = await partRoutes.request("/parts/mailbox/1.usdz", {}, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "model/vnd.usdz+zip");
  assert.equal(
    res.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), usdz);
  for (const path of [
    "/parts/mailbox/2.usdz",
    "/parts/nothing/1.usdz",
    "/parts/Mailbox/1.usdz",
    "/parts/mailbox/0.usdz",
    "/parts/mailbox/1.json",
  ]) {
    assert.equal((await partRoutes.request(path, {}, env)).status, 404, path);
  }
});
