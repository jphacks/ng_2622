import { PARTS } from "../scenes/parts";

// 部品の ID の規約（docs/design/part-generation.md）。場面の生成は部品を ID で引き、一覧を prompt に出さない。
// - 物: `名詞` か `名詞_区別`（英小文字。_ で 3 語まで、32 文字まで）。例 apple_red・table_small・wall_kitchen_tile
// - 人: `person_動作_誰_変種`。動作は 1 語以上（raise_hand・carry_veg）、誰は 1 語、変種は英小文字 1 文字。例 person_stand_woman_a
// - 動物: `animal_動作_種類_変種`（動作は省けることがある）。例 animal_run_dog_a・animal_bird_a
// 同梱の 154 個はすべてこの形（test/part-ids.test.ts が確かめる）

export const MAX_ID_LENGTH = 32;

/** 物の ID（名詞か名詞_区別。32 文字まで。person_・animal_ で始まるものは物ではない） */
export const OBJECT_ID = /^[a-z]+(?:_[a-z]+){0,2}$/;
/** 人の ID。1 = 動作、2 = 誰、3 = 変種 */
export const PERSON_ID = /^person_([a-z]+(?:_[a-z]+)*)_([a-z]+)_([a-z])$/;
/** 動物の ID。1 = 動作（無いこともある）、2 = 種類、3 = 変種 */
export const ANIMAL_ID = /^animal_(?:([a-z]+(?:_[a-z]+)*)_)?([a-z]+)_([a-z])$/;

export type ParsedPartId =
  | { kind: "person"; action: string; who: string; variant: string }
  | { kind: "animal"; action?: string; species: string; variant: string }
  | { kind: "object"; noun: string; qualifier?: string };

/** 物の ID の規約に合うか（作る部品の ID はこれに合うものだけ） */
export const isObjectId = (id: string): boolean =>
  id.length <= MAX_ID_LENGTH &&
  OBJECT_ID.test(id) &&
  !id.startsWith("person_") &&
  !id.startsWith("animal_");

/** ID を規約で分ける。どれにも合わなければ null */
export const parsePartId = (id: string): ParsedPartId | null => {
  if (id.length > 64) return null;
  if (id.startsWith("person_")) {
    const m = PERSON_ID.exec(id);
    return m
      ? { kind: "person", action: m[1], who: m[2], variant: m[3] }
      : null;
  }
  if (id.startsWith("animal_")) {
    const m = ANIMAL_ID.exec(id);
    if (!m) return null;
    return m[1]
      ? { kind: "animal", action: m[1], species: m[2], variant: m[3] }
      : { kind: "animal", species: m[2], variant: m[3] };
  }
  if (!isObjectId(id)) return null;
  const [noun, ...rest] = id.split("_");
  return rest.length > 0
    ? { kind: "object", noun, qualifier: rest.join("_") }
    : { kind: "object", noun };
};

const BUNDLED = new Set(PARTS.map((p) => p.id));

/** アプリと Worker に同梱した部品の ID か（作る部品はこれと重ねない） */
export const isBundledPart = (id: string): boolean => BUNDLED.has(id);

/** 配置の JSON の部品の参照（作った部品は `id@版`、同梱の部品は `id`）を分ける */
export const parsePartRef = (
  ref: string,
): { id: string; version?: number } | null => {
  const m = /^([a-z0-9_]+)(?:@([1-9][0-9]{0,5}))?$/.exec(ref);
  if (!m) return null;
  return m[2] ? { id: m[1], version: Number(m[2]) } : { id: m[1] };
};

/** 作った部品の参照（`id@版`） */
export const partRef = (id: string, version: number) => `${id}@${version}`;
