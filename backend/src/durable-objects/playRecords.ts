import { DurableObject } from "cloudflare:workers";
import type { ElementJudgment, Feedback } from "../scoring/types";

// 1 人 1 ラウンドの記録を、全部屋分まとめて持つ。インスタンスは 1 つだけ（getByName("global")）。
// 利用実験で、端末ごとに「話す量・内容点が伸びたか、何日続けたか」を数えるために残す。録音は残さない。
// 端末は場面の評価と同じ乱数の ID で区別し、表示名は残さない。RETENTION_DAYS を過ぎた行は書き込むたびに消す

export const RETENTION_DAYS = 180;

export type PlayRecordInput = {
  deviceId: string;
  sceneId: string;
  difficulty: string | null;
  transcript: string;
  content: number;
  expression: number;
  speech: number;
  total: number;
  /** 話し方の 3 つの点 */
  accuracy: number;
  fluency: number;
  prosody: number;
  /** 振り返りの講評（JSON で残す） */
  feedback: Feedback;
  /** 内容の要素ごとの判定（手作りの場面だけ。作り置き・AI の場面は空） */
  elements: ElementJudgment[];
};

export type PlayRecord = PlayRecordInput & {
  id: number;
  createdAt: string;
  words: number;
};

type Row = {
  id: number;
  created_at: string;
  device_id: string;
  scene_id: string;
  difficulty: string | null;
  transcript: string;
  words: number;
  content: number;
  expression: number;
  speech: number;
  total: number;
  accuracy: number;
  fluency: number;
  prosody: number;
  feedback: string;
  elements: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

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
      difficulty TEXT,
      transcript TEXT NOT NULL,
      words INTEGER NOT NULL,
      content REAL NOT NULL,
      expression REAL NOT NULL,
      speech REAL NOT NULL,
      total REAL NOT NULL,
      accuracy REAL NOT NULL,
      fluency REAL NOT NULL,
      prosody REAL NOT NULL,
      feedback TEXT NOT NULL,
      elements TEXT NOT NULL
    )`);
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS records_created_at ON records (created_at)",
    );
  }

  /** 1 行足し、保存期間を過ぎた行を消す。now は試験で時刻を決めるため */
  async append(input: PlayRecordInput, now = Date.now()): Promise<void> {
    this.sql.exec(
      `INSERT INTO records (created_at, device_id, scene_id, difficulty, transcript, words,
         content, expression, speech, total, accuracy, fluency, prosody, feedback, elements)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      new Date(now).toISOString(),
      input.deviceId,
      input.sceneId,
      input.difficulty,
      input.transcript,
      countWords(input.transcript),
      input.content,
      input.expression,
      input.speech,
      input.total,
      input.accuracy,
      input.fluency,
      input.prosody,
      JSON.stringify(input.feedback),
      JSON.stringify(input.elements),
    );
    this.sql.exec(
      "DELETE FROM records WHERE created_at < ?",
      new Date(now - RETENTION_DAYS * DAY_MS).toISOString(),
    );
  }

  /** 古い順。afterId より後の行を limit 件まで（続きは最後の id を渡して取る） */
  async list(afterId: number, limit: number): Promise<PlayRecord[]> {
    return this.sql
      .exec<Row>(
        "SELECT * FROM records WHERE id > ? ORDER BY id LIMIT ?",
        afterId,
        limit,
      )
      .toArray()
      .map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        deviceId: r.device_id,
        sceneId: r.scene_id,
        difficulty: r.difficulty,
        transcript: r.transcript,
        words: r.words,
        content: r.content,
        expression: r.expression,
        speech: r.speech,
        total: r.total,
        accuracy: r.accuracy,
        fluency: r.fluency,
        prosody: r.prosody,
        feedback: JSON.parse(r.feedback),
        elements: JSON.parse(r.elements),
      }));
  }
}
