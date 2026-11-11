import { DurableObject } from "cloudflare:workers";
import type { Score } from "../domain/round";
import type { SceneLayoutV2 } from "../scenes/types";
import type { Feedback } from "../scoring";
import type { SentContent } from "../scoring/checklist";

// 1 人 1 ラウンドの記録を、全部屋分まとめて持つ。インスタンスは 1 つだけ（getByName("global")）。
// 遊んだ本人が「きろく」の画面で、自分の点数と話した量の推移と、過去の振り返りを見返すために残す。
// 端末は場面の評価と同じ乱数の ID で区別する。表示名と録音は残さない。RETENTION_DAYS を過ぎた行は書き込むたびに消す

export const RETENTION_DAYS = 180;

/** 1 端末に返す記録の上限（新しい順） */
export const MAX_RECORDS_PER_DEVICE = 500;

export type PlayRecordInput = {
  deviceId: string;
  sceneId: string;
  score: Score;
  transcript: string;
  content: SentContent;
  feedback: Feedback;
  /** 遊んだ場面の配置。部屋が AI で作った場面は部屋が閉じると消えるので、振り返りを出し直すために丸ごと残す */
  layout: SceneLayoutV2;
};

export type PlayRecord = Omit<PlayRecordInput, "deviceId"> & {
  id: number;
  playedAt: string;
  words: number;
};

type Row = {
  id: number;
  created_at: string;
  words: number;
  body: string;
};

/** body に入れるもの（列にしない中身） */
type Body = Omit<PlayRecordInput, "deviceId" | "sceneId">;

const DAY_MS = 24 * 60 * 60 * 1000;

export const countWords = (text: string) =>
  text.split(/\s+/).filter(Boolean).length;

export class PlayRecords extends DurableObject<CloudflareBindings> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      device_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      words INTEGER NOT NULL,
      body TEXT NOT NULL
    )`);
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS records_device ON records (device_id, id)",
    );
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS records_created_at ON records (created_at)",
    );
  }

  /** 1 行足し、保存期間を過ぎた行を消す。now は試験で時刻を決めるため */
  async append(input: PlayRecordInput, now = Date.now()): Promise<void> {
    const { deviceId, sceneId, ...rest } = input;
    const body: Body = rest;
    this.sql.exec(
      "INSERT INTO records (created_at, device_id, scene_id, words, body) VALUES (?, ?, ?, ?, ?)",
      new Date(now).toISOString(),
      deviceId,
      sceneId,
      countWords(input.transcript),
      JSON.stringify(body),
    );
    this.sql.exec(
      "DELETE FROM records WHERE created_at < ?",
      new Date(now - RETENTION_DAYS * DAY_MS).toISOString(),
    );
  }

  /** その端末の記録を新しい順に返す。保存期間を過ぎた行は返さない */
  async listByDevice(
    deviceId: string,
    now = Date.now(),
  ): Promise<PlayRecord[]> {
    return this.sql
      .exec<Row & { scene_id: string }>(
        "SELECT id, created_at, scene_id, words, body FROM records WHERE device_id = ? AND created_at >= ? ORDER BY id DESC LIMIT ?",
        deviceId,
        new Date(now - RETENTION_DAYS * DAY_MS).toISOString(),
        MAX_RECORDS_PER_DEVICE,
      )
      .toArray()
      .map((r) => ({
        id: r.id,
        playedAt: r.created_at,
        sceneId: r.scene_id,
        words: r.words,
        ...(JSON.parse(r.body) as Body),
      }));
  }
}
