// AI が作った場面（作り置きの場面も）の ID。gen- ＋英小文字と数字 10 文字（docs/design/scene-protocol.md の「配置の JSON」）

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const newSceneId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  // 36 で割った余りは少し偏るが、ID の衝突を避けるだけなので構わない
  return `gen-${[...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;
};
