import type { Clock } from "@uc/core";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireCronSecret } from "../middleware/require-cron-secret";
import { runCron } from "../scheduled/run-cron";

export const CRON_PATH = "/cron";

/**
 * POST /cron: 外のタイマーが、毎分呼ぶ入口（Cloudflare の cron と同じ処理を、1 回行う）。
 * 募集開始の投稿と、締切のマッチングは、時刻が来ていて、まだ行っていないものだけを行う。何度呼んでも、二重には実行されない。
 * 呼んだ側（Apps Script）を待たせないように、「受け付けた」（202）をすぐ返して、処理は、そのあとで行う。結果は、Worker のログに出る。
 */
export function createCronRoute(deps: { clock: Clock }) {
  return new Hono<{ Bindings: AppEnv }>().use(requireCronSecret).post("/", (c) => {
    c.executionCtx.waitUntil(runCron(c.env, deps.clock, "http"));
    return c.json({ accepted: true as const }, 202);
  });
}
