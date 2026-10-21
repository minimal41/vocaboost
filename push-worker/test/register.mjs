// テスト用: Workers実行環境にしか無い "cloudflare:workers" を簡易的なものに差し替える
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
    }
    return next(specifier, context);
  }
`));
