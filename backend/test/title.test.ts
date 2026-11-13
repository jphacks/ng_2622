// タイトル画面に期間つきで出す 3D（GET /title と予定の JSON）のテスト
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import app from "../src/app";
import { makeTitleRoutes } from "../src/routes/title";
import { TitleResponse } from "../src/schemas/http";
import {
  campaignsOf,
  currentTitle,
  TITLE_SCHEDULE,
  type TitleSchedule,
} from "../src/title/schedule";

const assetOf = (file: string) =>
  new URL(`../../assets/title/${file}`, import.meta.url);

const schedule: TitleSchedule = {
  titles: [
    {
      id: "jphacks-2026",
      file: "hackathon.usdz",
      sha256:
        "ecc5df6420d58288105de59ecfde931755a1d345b0789245f9dca72f09719dae",
      caption: "広告の見本：JPHACKS",
      startsAt: "2026-11-12T15:00:00Z",
      expiresAt: "2026-11-15T14:59:59Z",
    },
    {
      id: "other-sponsor",
      file: "other.usdz",
      sha256: "0".repeat(64),
      caption: "広告の見本：ほか",
      startsAt: "2026-11-01T00:00:00Z",
      expiresAt: "2026-12-31T14:59:59Z",
    },
  ],
};
const ORIGIN = "https://example.workers.dev/title";
const inside = new Date("2026-11-14T03:00:00Z");

test("予定の 3D のファイルは assets/title にあり、sha256 が予定に書いた値と同じ（作り直したら書き直す）", () => {
  assert.ok(TITLE_SCHEDULE.titles.length > 0);
  for (const entry of TITLE_SCHEDULE.titles) {
    const sha = createHash("sha256")
      .update(readFileSync(assetOf(entry.file)))
      .digest("hex");
    assert.equal(sha, entry.sha256, `${entry.file} の sha256 が予定と違う`);
  }
});

test("予定の期間は始まりが終わりより前で、id は重ならない", () => {
  for (const entry of TITLE_SCHEDULE.titles) {
    assert.ok(Date.parse(entry.startsAt) < Date.parse(entry.expiresAt));
  }
  const ids = TITLE_SCHEDULE.titles.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("返す id（予定の id と sha256 の先頭 8 文字）は、アプリがファイルの名前に使える形と長さ（64 文字まで）", () => {
  // アプリの TitleStore.isValid と同じ形: 英小文字か数字で始まり、英小文字・数字・ハイフンで 64 文字まで
  for (const entry of TITLE_SCHEDULE.titles) {
    const id = `${entry.id}-${entry.sha256.slice(0, 8)}`;
    assert.match(
      id,
      /^[a-z0-9][a-z0-9-]{0,63}$/,
      `${id} はアプリで受け付けない`,
    );
  }
});

test("JPHACKS は日本時間 2026-11-15 23:59:59 まで", () => {
  const entry = TITLE_SCHEDULE.titles.find((e) => e.id === "jphacks-2026");
  assert.equal(entry?.expiresAt, "2026-11-15T14:59:59Z");
  assert.equal(entry?.caption, "広告の見本：JPHACKS");
});

test("配るファイルは assets/title の直下の .usdz（assets/.assetsignore で戻すのはそれだけ）", () => {
  const ignore = readFileSync(
    new URL("../../assets/.assetsignore", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(ignore, ["*", "!title/", "!title/*.usdz"]);
  for (const entry of TITLE_SCHEDULE.titles) {
    assert.match(entry.file, /^[^/]+\.usdz$/);
  }
});

test("TITLE_CAMPAIGN はカンマ区切りで、空白と空の欄は無視する", () => {
  assert.deepEqual(campaignsOf(undefined), []);
  assert.deepEqual(campaignsOf(""), []);
  assert.deepEqual(campaignsOf(" jphacks-2026 , ,other "), [
    "jphacks-2026",
    "other",
  ]);
});

test("期間の中なら、id に sha256 の先頭を付け、model は同じホストの絶対 URL", () => {
  const title = currentTitle(schedule, ["jphacks-2026"], inside, ORIGIN);
  assert.deepEqual(title, {
    id: "jphacks-2026-ecc5df64",
    caption: "広告の見本：JPHACKS",
    model: "https://example.workers.dev/title/hackathon.usdz?v=ecc5df64",
    sha256: schedule.titles[0].sha256,
    expiresAt: "2026-11-15T14:59:59Z",
  });
});

test("期間の両端は含み、外は出さない", () => {
  const at = (iso: string) =>
    currentTitle(schedule, ["jphacks-2026"], new Date(iso), ORIGIN)?.id ?? null;
  assert.equal(at("2026-11-12T14:59:59Z"), null);
  assert.equal(at("2026-11-12T15:00:00Z"), "jphacks-2026-ecc5df64");
  assert.equal(at("2026-11-15T14:59:59Z"), "jphacks-2026-ecc5df64");
  assert.equal(at("2026-11-15T15:00:00Z"), null);
});

test("変数が空・知らない id なら出さない。複数あれば予定の順で先のもの", () => {
  assert.equal(currentTitle(schedule, [], inside, ORIGIN), null);
  assert.equal(currentTitle(schedule, ["nobody"], inside, ORIGIN), null);
  assert.equal(
    currentTitle(schedule, ["other-sponsor", "jphacks-2026"], inside, ORIGIN)
      ?.id,
    "jphacks-2026-ecc5df64",
  );
  // 先の予定が期間の外なら、次の予定を出す
  assert.equal(
    currentTitle(
      schedule,
      ["other-sponsor", "jphacks-2026"],
      new Date("2026-12-01T00:00:00Z"),
      ORIGIN,
    )?.id,
    "other-sponsor-00000000",
  );
});

test("GET /title は変数に入っていて期間の中のものを返し、途中で覚えさせない", async () => {
  const routes = makeTitleRoutes({ now: () => inside, schedule });
  const res = await routes.request(
    "https://staging.example.workers.dev/title",
    {},
    { TITLE_CAMPAIGN: "jphacks-2026" },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = TitleResponse.parse(await res.json());
  assert.equal(body.title?.id, "jphacks-2026-ecc5df64");
  assert.equal(
    body.title?.model,
    "https://staging.example.workers.dev/title/hackathon.usdz?v=ecc5df64",
  );
  assert.equal(body.title?.expiresAt, "2026-11-15T14:59:59Z");
});

test("GET /title は期間の外・変数が空・知らない id なら title が null", async () => {
  const cases: [Date, string | undefined][] = [
    [new Date("2026-11-16T00:00:00Z"), "jphacks-2026"],
    [inside, ""],
    [inside, undefined],
    [inside, "nobody"],
  ];
  for (const [now, campaign] of cases) {
    const routes = makeTitleRoutes({ now: () => now, schedule });
    const res = await routes.request(
      "/title",
      {},
      campaign === undefined ? {} : { TITLE_CAMPAIGN: campaign },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { title: null });
  }
});

test("アプリの GET /title は同梱の予定を使い、変数が無ければ null（本番と同じ）", async () => {
  const res = await app.request("/title", {}, { TITLE_CAMPAIGN: "" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { title: null });
});
