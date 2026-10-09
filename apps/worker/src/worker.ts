import type { Clock } from "@uc/core";
import type { Hono } from "hono";
import type { AppEnv } from "./env";
import { runCron } from "./scheduled/run-cron";

/**
 * Cloudflare に出す Worker（HTTP と cron）を作る。時計は、HTTP と cron で、同じものを使う。
 * 本番の入口（index.ts）と、開発の入口（dev/entry.ts）が、それぞれ、アプリと時計を渡す。
 */
export function createWorker(app: Pick<Hono<{ Bindings: AppEnv }>, "fetch">, clock: Clock) {
  return {
    fetch: app.fetch,

    /** cron（毎分）。募集開始の投稿と、試合の K 分前の締切（マッチングの確定）を行う。外のタイマー（POST /cron）と、同じ処理（runCron） */
    async scheduled(controller, env, ctx) {
      // 動いているかを、tail で確かめられるように、何も実行しなかった回も、1 行だけ残す
      console.log("cron: 発火", new Date(controller.scheduledTime).toISOString());
      ctx.waitUntil(runCron(env, clock, "scheduled"));
    },
  } satisfies ExportedHandler<AppEnv>;
}
