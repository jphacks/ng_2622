import { DurableObject } from "cloudflare:workers";
import type { Scene } from "../scoring/types";

// 配置から作った採点の基準を、場面ごとに 1 つ覚える。インスタンスは場面のキーごと（getByName(key)）。
// 同じ場面の全員を同じ基準で採点するため、最初に保存された基準を使い続ける。1 日たったら消す

const KEY = "rubric";
const TTL_MS = 24 * 60 * 60 * 1000;

export class SceneRubrics extends DurableObject<CloudflareBindings> {
  async get(): Promise<Scene | null> {
    return (await this.ctx.storage.get<Scene>(KEY)) ?? null;
  }

  /** まだ無ければ保存する。もうあれば（ほかの人が先に作っていれば）そちらを返す */
  async keep(rubric: Scene): Promise<{ rubric: Scene; created: boolean }> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const existing = await this.ctx.storage.get<Scene>(KEY);
      if (existing) return { rubric: existing, created: false };
      await this.ctx.storage.put(KEY, rubric);
      await this.ctx.storage.setAlarm(Date.now() + TTL_MS);
      return { rubric, created: true };
    });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
