// Node のテストで Durable Object を動かすための cloudflare:workers の代わり（test/helpers/room-harness.ts が差し込む）
export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}
