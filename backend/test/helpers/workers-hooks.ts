// Durable Object を Node のテストで読むため、cloudflare:workers を cloudflare-workers.mjs に差し替える。
// DO のクラスを import する前に、このファイルを import する
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
