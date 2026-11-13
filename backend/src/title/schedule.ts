import { z } from "zod";
import raw from "./schedule.json";

// タイトル画面（ホーム）に期間つきで出す 3D の予定（docs/adr/20261113-decide-title-diorama-on-server-with-expiry.md）。
// 正本は schedule.json。PR で変えてデプロイする。3D のファイルは repo の assets/title/<file> を、Worker の静的アセット
// （wrangler.jsonc の assets）として /title/<file> で配る。
//
// - id: 広告の名前。環境の変数 TITLE_CAMPAIGN（カンマ区切り）に入っているものだけを出す。本番は空で何も出さない
// - file: assets/title の中の USDZ の名前
// - sha256: file の中身の sha256（16 進数の小文字）。test/title.test.ts が実物と突き合わせる。ファイルを作り直したら書き直す
// - caption: タイトルの下に出す字
// - startsAt・expiresAt: 出す期間（秒までの UTC。両端を含む）。期間の判定はサーバーの時刻で行う
//   jphacks-2026 は日本時間 2026-11-13 0:00 から 11-15 23:59:59 まで

const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export const TitleScheduleEntry = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  file: z.string().regex(/^[a-z0-9_-]+\.usdz$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  caption: z.string().min(1),
  startsAt: z.string().regex(ISO_SECONDS),
  expiresAt: z.string().regex(ISO_SECONDS),
});
export type TitleScheduleEntry = z.infer<typeof TitleScheduleEntry>;

export const TitleSchedule = z.object({ titles: z.array(TitleScheduleEntry) });
export type TitleSchedule = z.infer<typeof TitleSchedule>;

/** Worker に同梱した予定。形が崩れていれば起動で落ちる（test/title.test.ts が先に止める） */
export const TITLE_SCHEDULE: TitleSchedule = TitleSchedule.parse(raw);

/** 静的アセットとして配る 3D のパス（assets/.assetsignore で assets/title/*.usdz だけを配る） */
export const titleModelPath = (file: string) => `/title/${file}`;

/** アプリへ返す、今出すタイトル */
export type CurrentTitle = {
  id: string;
  caption: string;
  model: string;
  sha256: string;
  expiresAt: string;
};

/** 環境の変数 TITLE_CAMPAIGN（カンマ区切り）から、出してよい広告の名前を取り出す。空なら何も出さない */
export const campaignsOf = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/**
 * 今出すタイトル。campaigns に入っていて、now が期間（startsAt 以上 expiresAt 以下）の中にある予定のうち、予定の順で先のもの。
 * 無ければ null。id は広告の名前とファイルの sha256 の先頭 8 文字（ファイルを差し替えると id も変わり、アプリが取り直す）。
 * model は origin（リクエストの URL）からの絶対 URL で、キャッシュに古い中身が残らないよう ?v= に sha256 の先頭を付ける
 */
export function currentTitle(
  schedule: TitleSchedule,
  campaigns: string[],
  now: Date,
  origin: string,
): CurrentTitle | null {
  const t = now.getTime();
  const entry = schedule.titles.find(
    (e) =>
      campaigns.includes(e.id) &&
      Date.parse(e.startsAt) <= t &&
      t <= Date.parse(e.expiresAt),
  );
  if (!entry) return null;
  const short = entry.sha256.slice(0, 8);
  return {
    id: `${entry.id}-${short}`,
    caption: entry.caption,
    model: new URL(
      `${titleModelPath(entry.file)}?v=${short}`,
      origin,
    ).toString(),
    sha256: entry.sha256,
    expiresAt: entry.expiresAt,
  };
}
