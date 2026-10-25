// バックエンドの部品の一覧（src/scenes/parts.json）が、正本（assets/parts/index.json）の写しのままか
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import parts from "../src/scenes/parts.json" with { type: "json" };

test("parts.json は assets/parts/index.json と同じ（部品を足したら写し直す）", () => {
  const source = JSON.parse(
    readFileSync(
      new URL("../../assets/parts/index.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(parts, source);
});
