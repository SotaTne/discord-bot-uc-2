import type { Clock } from "@uc/core";
import type { Hono } from "hono";
import { createDb } from "./db";
import { createRestFromEnv } from "./discord";
import type { AppEnv } from "./env";
import { runScheduled } from "./scheduled/run";

/**
 * Cloudflare に出す Worker（HTTP と cron）を作る。時計は、HTTP と cron で、同じものを使う。
 * 本番の入口（index.ts）と、開発の入口（dev/entry.ts）が、それぞれ、アプリと時計を渡す。
 */
export function createWorker(app: Pick<Hono<{ Bindings: AppEnv }>, "fetch">, clock: Clock) {
  return {
    fetch: app.fetch,

    /** cron（毎分）。募集開始の投稿と、試合の K 分前の締切（マッチングの確定）を行う */
    async scheduled(_controller, env, ctx) {
      ctx.waitUntil(
        runScheduled({ db: createDb(env.DB), rest: createRestFromEnv(env), clock }).then((summary) => {
          if (summary.ran.length > 0 || summary.errors.length > 0) {
            console.log("cron:", JSON.stringify(summary));
          }
        }),
      );
    },
  } satisfies ExportedHandler<AppEnv>;
}
