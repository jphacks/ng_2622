import parts from "./parts.json";
import type { Part } from "./types";

// 部品の一覧。Hack Day では部品をアプリに同梱するので、一覧も Worker に同梱する。
// 正本は assets/parts/index.json。変えたら backend/src/scenes/parts.json に写す（test/parts.test.ts が突き合わせる）
export const PARTS = parts as Part[];
