import { DurableObject } from "cloudflare:workers";

// 外部 API の使い過ぎを数える。インスタンスは全体で 1 つだけ（getByName("global")）。
// 今は苦手の分析（POST /weak-points）の、IP ごとの 1 時間の回数と、全体の 1 日の回数を数える
// （docs/design/weak-point-analysis.md の 8）。Cloudflare の Rate Limiting の binding は期間が 10 秒か 60 秒だけで、
// 場所ごとの近似の数なので、1 時間の回数と全体の上限はここで数える。
//
// 数え方:
// - IP ごとの回数は、受け付けたリクエスト（形の確かめを通ったもの）1 つで 1 回（take）。1 時間の区切り（毎時 0 分）で数え直す。
// - 全体の 1 日の回数は、Claude を呼んだ回数（呼び直しも 1 回。take と takeDaily）。日本時間の日付で区切る。
// - 上限で断ったもの（429）は、どちらにも数えない。
//
// IP はそのまま覚えない。この DO が日ごとに作る乱数を鍵にした HMAC-SHA-256 で覚える（新しい secret は要らない）。
// IP ごとの回数は区切りが過ぎたら消し（alarm）、乱数は日が変われば捨てる。乱数が無くなると、残った値からも元の IP は辿れない。
// 分析の中身は受け取らない

export type UsageLimits = {
  // IP ごとの 1 時間の回数
  perHour: number;
  // 全体の 1 日の回数（Claude を呼んだ回数。呼び直しも数える）
  daily: number;
};

export type TakeResult =
  | { ok: true }
  | { ok: false; reason: "ip_hourly" | "daily" };

type State = {
  // 1 時間の区切り（UTC の 1970 年からの時間の数）と、その区切りの IP（HMAC）ごとの回数
  hour: number;
  ips: Record<string, number>;
  // 日本時間の日付（YYYY-MM-DD）と、その日の回数と、その日の HMAC の鍵（乱数の 16 進。まだ作っていなければ空）
  day: string;
  daily: number;
  secret: string;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;
const KEY = "weak-points";

/** 日本時間の日付（YYYY-MM-DD） */
export const jstDay = (ms: number) =>
  new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);

/** 次の日本時間の 0 時（ms） */
const nextJstMidnight = (ms: number) =>
  (Math.floor((ms + JST_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - JST_OFFSET_MS;

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (s: string) =>
  new Uint8Array(s.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);

const newSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));

const hmacIp = async (secret: string, ip: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    fromHex(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip),
  );
  return hex(mac).slice(0, 32);
};

const empty = (now: number): State => ({
  hour: Math.floor(now / HOUR_MS),
  ips: {},
  day: jstDay(now),
  daily: 0,
  secret: "",
});

export class UsageCounter extends DurableObject<CloudflareBindings> {
  private state: State | undefined;
  /** 今の時刻（ms）。テストで差し替える */
  clock: () => number = () => Date.now();

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = await ctx.storage.get<State>(KEY);
    });
  }

  /** 区切りが変わっていたら数え直す（同期。await の間に他の呼び出しが割り込んでも数を取り違えない） */
  private current(now: number): State {
    const s = this.state ?? empty(now);
    const hour = Math.floor(now / HOUR_MS);
    if (s.hour !== hour) {
      s.hour = hour;
      s.ips = {};
    }
    const day = jstDay(now);
    if (s.day !== day) {
      s.day = day;
      s.daily = 0;
      s.secret = "";
    }
    this.state = s;
    return s;
  }

  /** 保存し、次に消すもの（IP の回数は区切りの終わり、鍵は日本時間の 0 時）の時刻に alarm を置く */
  private async save(s: State, now: number) {
    await this.ctx.storage.put(KEY, s);
    if (Object.keys(s.ips).length > 0) {
      await this.ctx.storage.setAlarm((s.hour + 1) * HOUR_MS);
    } else if (s.secret) {
      await this.ctx.storage.setAlarm(nextJstMidnight(now));
    }
  }

  /**
   * 分析のリクエストを 1 つ受け付けてよいかを確かめ、よければ IP の 1 時間の回数と全体の 1 日の回数を 1 つずつ増やす
   * （このあと Claude を 1 回呼ぶ）。断ったときは数えない（断られた呼び出しで全体の回数が埋まらないように）
   */
  async take(ip: string, limits: UsageLimits): Promise<TakeResult> {
    let s = this.current(this.clock());
    if (!s.secret) s.secret = newSecret();
    let secret = s.secret;
    let id = await hmacIp(secret, ip);
    // HMAC を作っている間に日が変わったら、新しい鍵で作り直す
    s = this.current(this.clock());
    if (!s.secret) s.secret = newSecret();
    if (s.secret !== secret) {
      secret = s.secret;
      id = await hmacIp(secret, ip);
      s = this.current(this.clock());
    }
    const used = s.ips[id] ?? 0;
    if (used >= limits.perHour) return { ok: false, reason: "ip_hourly" };
    if (s.daily >= limits.daily) return { ok: false, reason: "daily" };
    s.ips[id] = used + 1;
    s.daily++;
    await this.save(s, this.clock());
    return { ok: true };
  }

  /** 呼び直す前に、全体の 1 日の回数を 1 つ足す。上限に達していれば足さずに false（呼び直さない） */
  async takeDaily(limits: Pick<UsageLimits, "daily">): Promise<boolean> {
    const now = this.clock();
    const s = this.current(now);
    if (s.daily >= limits.daily) return false;
    s.daily++;
    await this.save(s, now);
    return true;
  }

  /** 区切りの終わり。過ぎた区切りの IP の回数と、過ぎた日の鍵を消す */
  async alarm() {
    const now = this.clock();
    await this.save(this.current(now), now);
  }
}
