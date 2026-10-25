// 部屋の Durable Object（src/durable-objects/room.ts）を Node で動かすための仕掛け。
// cloudflare:workers を差し替え、保存領域と WebSocket をメモリでまねる
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") {
      return {
        url: new URL("./cloudflare-workers.mjs", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});

// joinRoom の合言葉の比較は Workers だけにある crypto.subtle.timingSafeEqual を使う
const subtle = crypto.subtle as SubtleCrypto & {
  timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
};
subtle.timingSafeEqual ??= (a, b) =>
  Buffer.compare(
    Buffer.from(a.buffer, a.byteOffset, a.byteLength),
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  ) === 0;

const { Room } = await import("../../src/durable-objects/room");

export { Room };

export type FakeSocket = WebSocket & { sent: Record<string, unknown>[] };

/** DO の ctx のまね。保存領域は Map、WebSocket は配列 */
export const fakeContext = (storage = new Map<string, unknown>()) => {
  const sockets: FakeSocket[] = [];
  const ctx = {
    storage: {
      get: async (key: string) => structuredClone(storage.get(key)),
      put: async (key: string, value: unknown) => {
        storage.set(key, structuredClone(value));
      },
      delete: async (key: string) => storage.delete(key),
      deleteAll: async () => storage.clear(),
      setAlarm: async () => {},
    },
    acceptWebSocket: () => {},
    getWebSockets: () => sockets as unknown as WebSocket[],
  };
  return { ctx, storage, sockets };
};

const OPEN = 1;
const CLOSED = 3;

export const fakeSocket = (): FakeSocket => {
  let attachment: unknown = null;
  const ws = {
    readyState: OPEN,
    sent: [] as Record<string, unknown>[],
    send(data: string) {
      ws.sent.push(JSON.parse(data));
    },
    close() {
      ws.readyState = CLOSED;
    },
    serializeAttachment(a: unknown) {
      attachment = structuredClone(a);
    },
    deserializeAttachment() {
      return attachment;
    },
  };
  return ws as unknown as FakeSocket;
};

export type Welcome = { playerId: string; token: string };

/** 部屋を作り、ホストと names の参加者を join させる */
export const openRoom = async (
  env: Record<string, unknown>,
  names: string[] = ["B"],
) => {
  const { ctx, sockets, storage } = fakeContext();
  // biome-ignore lint/suspicious/noExplicitAny: テストのまねなので型を合わせない
  const room = new Room(ctx as any, env as any);
  const created = await room.create("0427");
  if (!created) throw new Error("部屋を作れない");
  const host = fakeSocket();
  sockets.push(host);
  await send(room, host, {
    type: "join",
    name: "host",
    playerId: created.playerId,
    token: created.token,
  });
  const others: FakeSocket[] = [];
  for (const name of names) {
    const ws = fakeSocket();
    sockets.push(ws);
    await send(room, ws, { type: "join", name });
    others.push(ws);
  }
  const welcomes = [host, ...others].map(
    (ws) => received(ws, "welcome")[0] as Welcome,
  );
  return { room, ctx, sockets, storage, host, others, welcomes };
};

/** 同じ保存領域とソケットで DO を作り直す（休止や作り直しのまね。メモリの中身は消える） */
export const reopen = (
  ctx: ReturnType<typeof fakeContext>["ctx"],
  env: Record<string, unknown>,
  // biome-ignore lint/suspicious/noExplicitAny: テストのまねなので型を合わせない
) => new Room(ctx as any, env as any);

export const send = (
  room: InstanceType<typeof Room>,
  ws: WebSocket,
  message: unknown,
) => room.webSocketMessage(ws, JSON.stringify(message));

/** そのソケットに届いたメッセージのうち、type が合うもの */
export const received = (ws: FakeSocket, type: string) =>
  ws.sent.filter((m) => m.type === type);
