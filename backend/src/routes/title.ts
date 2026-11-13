import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { TitleResponse } from "../schemas/http";
import {
  campaignsOf,
  currentTitle,
  TITLE_SCHEDULE,
  type TitleSchedule,
} from "../title/schedule";
import { type AppEnv, jsonContent } from "./shared";

/** テストで時刻と予定を差し替えられるようにした GET /title。アプリは titleRoutes（今の時刻と同梱の予定）を使う */
export const makeTitleRoutes = (
  deps: { now?: () => Date; schedule?: TitleSchedule } = {},
) => {
  const now = deps.now ?? (() => new Date());
  const schedule = deps.schedule ?? TITLE_SCHEDULE;
  return new Hono<AppEnv>().get(
    "/title",
    describeRoute({
      operationId: "getTitle",
      tags: ["title"],
      summary: "タイトル画面に今出す 3D",
      description:
        "予定（src/title/schedule.json）のうち、環境の変数 TITLE_CAMPAIGN に入っていて、今が期間の中にあるもの。無ければ title が null。" +
        "期間の判定はサーバーの時刻で行う。アプリは起動時と前に戻ったときに毎回呼び、id が変われば model を取り直す。" +
        "3D のファイル（model）は Worker の静的アセットで、この API とは別に GET で取る。",
      responses: {
        200: {
          description: "今出すタイトル",
          content: jsonContent(TitleResponse),
        },
      },
    }),
    (c) => {
      const title = currentTitle(
        schedule,
        campaignsOf(c.env?.TITLE_CAMPAIGN),
        now(),
        c.req.url,
      );
      // 期間の切り替わりをすぐ届けるため、途中で覚えさせない
      c.header("Cache-Control", "no-store");
      return c.json({ title });
    },
  );
};

export const titleRoutes = makeTitleRoutes();
