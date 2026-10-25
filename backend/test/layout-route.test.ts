import assert from "node:assert/strict";
import { test } from "node:test";
import app from "../src/app";
import { findPoolScene } from "../src/scenes/pool";
import index from "../src/scenes/pool/index.json";

test("GET /scenes/{sceneId}/layout は作り置きの場面の JSON をそのまま返す", async () => {
  for (const id of [index.hard.scenes[0], index.easy.example]) {
    const res = await app.request(`/scenes/${id}/layout`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), findPoolScene(id));
  }
});

test("無い場面と手作りの場面は 404 unknown_scene", async () => {
  for (const id of ["gen-xxxxxxxxxx", "park"]) {
    const res = await app.request(`/scenes/${id}/layout`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "unknown_scene");
  }
});
