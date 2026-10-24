// ---------- 型 ----------

export type Player = {
  id: string;
  name: string | null;
  token: string;
  isHost: boolean;
};

// ---------- ドメインルール ----------

/** 新しい参加者を作る。名前は join で決まる */
export const createPlayer = (isHost: boolean): Player => ({
  id: crypto.randomUUID(),
  name: null,
  token: randomToken(),
  isHost,
});

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
