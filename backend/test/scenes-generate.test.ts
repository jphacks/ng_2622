// POST /scenes/generate の合言葉・本文の形・止めるスイッチのテスト（Claude は呼ばない）
import assert from "node:assert/strict";
import { test } from "node:test";
import app from "../src/app";

const post = (body: unknown, init: { token?: string } = {}, env = {}) =>
  app.request(
    "/scenes/generate",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: JSON.stringify(body),
    },
    { SCENE_WRITE_TOKEN: "secret-token", ...env },
  );

test("POST /scenes/generate は合言葉が無い・違えば 401 で、本文より先に断る", async () => {
  assert.equal((await post({ difficulty: "easy" })).status, 401);
  assert.equal(
    (await post({ difficulty: "easy" }, { token: "wrong-token!" })).status,
    401,
  );
  assert.equal((await post({}, { token: "wrong" })).status, 401);
  // 合言葉が設定されていなければ、何を送っても通さない
  const r = await app.request(
    "/scenes/generate",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " },
      body: "{}",
    },
    {},
  );
  assert.equal(r.status, 401);
});

test("POST /scenes/generate は本文の形を確かめ、止めてあれば 503", async () => {
  const token = "secret-token";
  for (const body of [
    {},
    { difficulty: "extreme" },
    { difficulty: "easy", theme: "" },
    { difficulty: "easy", theme: "あ".repeat(51) },
  ]) {
    assert.equal(
      (await post(body, { token })).status,
      400,
      JSON.stringify(body),
    );
  }
  const off = await post({ difficulty: "easy", theme: "公園" }, { token });
  assert.equal(off.status, 503);
  assert.equal(
    ((await off.json()) as { error: { code: string } }).error.code,
    "generation_unavailable",
  );
});

test("GET /parts は同梱の部品の一覧を返す", async () => {
  const res = await app.request("/parts", {}, {});
  assert.equal(res.status, 200);
  const body = (await res.json()) as { parts: { id: string }[] };
  assert.ok(body.parts.some((p) => p.id === "grass_patch"));
});
