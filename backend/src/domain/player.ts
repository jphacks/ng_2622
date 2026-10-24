// ---------- 型 ----------

export type Player = {
  id: string;
  name: string | null;
  /** アバターの色（0xRRGGBB）。名前と同じく join で決まる */
  color: number | null;
  token: string;
  isHost: boolean;
};

// ---------- ドメインルール ----------

/** 色を送らなかった人に使う色（iOS のホームで選べる色と同じ） */
export const AVATAR_COLORS = [
  0x5b5be6, 0xf07aa8, 0x2fae9b, 0xf29a3a, 0xb06ad9, 0x3aa0e8,
];

/** 新しい参加者を作る。名前は join で決まる */
export const createPlayer = (isHost: boolean): Player => ({
  id: crypto.randomUUID(),
  name: null,
  color: null,
  token: randomToken(),
  isHost,
});

/** まだ誰も使っていない色。全部使われていたら最初の色 */
export const pickColor = (players: readonly Player[]) =>
  AVATAR_COLORS.find((c) => !players.some((p) => p.color === c)) ??
  AVATAR_COLORS[0];

/** 合言葉が合うか。比べる時間から中身を推測されないよう一定時間で比べる */
export const tokenMatches = (player: Player, token: string) => {
  const encoder = new TextEncoder();
  const a = encoder.encode(player.token);
  const b = encoder.encode(token);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
};

/** 推測されにくい合言葉（URL に使える文字だけ） */
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};
