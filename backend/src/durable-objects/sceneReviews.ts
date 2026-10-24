import { DurableObject } from "cloudflare:workers";

// シーンの評価（★とコメント）を全シーン分まとめて持つ。インスタンスは 1 つだけ（getByName("global")）
// 今はバニラのシーンだけだが、ユーザーが作るシーンも同じ表に scene_id で足せる

export type ReviewInput = {
  sceneId: string;
  reviewerId: string;
  name: string;
  rating: number;
  comment: string | null;
};

export type Review = {
  name: string;
  rating: number;
  comment: string | null;
  updatedAt: string;
};

export type RatingSummary = { sceneId: string; average: number; count: number };

export class SceneReviews extends DurableObject<CloudflareBindings> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // 同じ人（端末）が同じシーンを評価し直したら上書きする
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reviews (
      scene_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scene_id, reviewer_id)
    )`);
  }

  async upsert(input: ReviewInput): Promise<RatingSummary> {
    this.sql.exec(
      `INSERT INTO reviews (scene_id, reviewer_id, name, rating, comment, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (scene_id, reviewer_id) DO UPDATE SET
         name = excluded.name, rating = excluded.rating,
         comment = excluded.comment, updated_at = excluded.updated_at`,
      input.sceneId,
      input.reviewerId,
      input.name,
      input.rating,
      input.comment,
      new Date().toISOString(),
    );
    return this.summaryOf(input.sceneId);
  }

  /** 評価が 1 件以上あるシーンの平均と件数 */
  async summaries(): Promise<RatingSummary[]> {
    return this.sql
      .exec<{ scene_id: string; average: number; count: number }>(
        `SELECT scene_id, AVG(rating) AS average, COUNT(*) AS count
         FROM reviews GROUP BY scene_id`,
      )
      .toArray()
      .map((r) => ({
        sceneId: r.scene_id,
        average: r.average,
        count: r.count,
      }));
  }

  /** 新しい順。コメントの無い評価も含む */
  async list(sceneId: string, limit: number): Promise<Review[]> {
    return this.sql
      .exec<{
        name: string;
        rating: number;
        comment: string | null;
        updated_at: string;
      }>(
        `SELECT name, rating, comment, updated_at FROM reviews
         WHERE scene_id = ? ORDER BY updated_at DESC LIMIT ?`,
        sceneId,
        limit,
      )
      .toArray()
      .map((r) => ({
        name: r.name,
        rating: r.rating,
        comment: r.comment,
        updatedAt: r.updated_at,
      }));
  }

  private summaryOf(sceneId: string): RatingSummary {
    const row = this.sql
      .exec<{ average: number | null; count: number }>(
        "SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE scene_id = ?",
        sceneId,
      )
      .one();
    return { sceneId, average: row.average ?? 0, count: row.count };
  }
}
