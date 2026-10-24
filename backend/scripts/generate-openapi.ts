// backend/openapi.json を生成する。iOS はこのファイルから型を作る。
//   pnpm openapi          生成して書き出す
//   pnpm openapi --check  生成した結果と commit 済みのファイルが同じかを確かめる（CI で使う）
import { readFile, writeFile } from "node:fs/promises";
import app from "../src/app";
import { buildOpenAPISpec } from "../src/openapi";

const path = new URL("../openapi.json", import.meta.url);
const generated = `${JSON.stringify(await buildOpenAPISpec(app), null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = await readFile(path, "utf8").catch(() => "");
  if (current !== generated) {
    console.error(
      "openapi.json が古い。`pnpm openapi` で生成し直して commit する",
    );
    process.exit(1);
  }
  console.log("openapi.json は最新");
} else {
  await writeFile(path, generated);
  console.log("openapi.json を書き出した");
}
