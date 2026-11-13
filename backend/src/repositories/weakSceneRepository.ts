import type { z } from "zod";
import type { Part } from "../scenes/types";
import { WEAK_SCENE_ID, type WeakSceneResponse } from "../schemas/http";

// 苦手の場面の置き場。R2（binding BUCKET）の weak-scenes/<sceneId>.json に、
// POST /weak-scenes で返した中身と、配置が使う同梱に無い部品のメタデータを置く。部屋が sceneId で読む。
// 消さない（作った部品と同じく、みんなで使う。容量は 1 件 10〜20 KB）

/** 置く 1 件。返した中身（sceneId・name・difficulty・focus・pitch・layout・createdParts）に、部品のメタデータと作った時刻を足す */
export type WeakSceneRecord = z.infer<typeof WeakSceneResponse> & {
  /** 配置が使う、同梱に無い部品（前に作った・その場で作った）のメタデータ。採点に渡す */
  parts: Part[];
  createdAt: string;
};

export type WeakSceneStore = {
  put: (record: WeakSceneRecord) => Promise<void>;
  /** 無い・ID の形が違えば null */
  find: (sceneId: string) => Promise<WeakSceneRecord | null>;
};

export const weakSceneKey = (sceneId: string) => `weak-scenes/${sceneId}.json`;

/** 苦手の場面の ID か（weak- ＋ uuid） */
export const isWeakSceneId = (id: string) => WEAK_SCENE_ID.test(id);

export const createWeakSceneRepository = (
  bucket: R2Bucket,
): WeakSceneStore => ({
  put: async (record) => {
    await bucket.put(weakSceneKey(record.sceneId), JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" },
    });
  },
  find: async (sceneId) => {
    if (!isWeakSceneId(sceneId)) return null;
    const object = await bucket.get(weakSceneKey(sceneId));
    if (!object) return null;
    try {
      return (await object.json()) as WeakSceneRecord;
    } catch {
      return null;
    }
  },
});
