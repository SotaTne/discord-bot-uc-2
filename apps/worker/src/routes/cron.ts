import type { Clock } from "@uc/core";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import type { AppEnv } from "../env";
import { requireCronSecret } from "../middleware/require-cron-secret";
import { runScheduled } from "../scheduled/run";

export const CRON_PATH = "/cron";

/**
 * POST /cron: 外のタイマー（apps/cron の Apps Script）が、毎分呼ぶ入口。cron の処理を、1 回行う。
 * 募集開始の投稿と、締切のマッチングは、時刻が来ていて、まだ行っていないものだけを行う。何度呼んでも、二重には実行されない。
 * 呼んだ側を待たせないように、「受け付けた」（202）をすぐ返して、処理は、そのあとで行う。結果は、Worker のログに出る
 * （何かを実行したか、失敗があったときだけ）。
 */
export function createCronRoute(deps: { clock: Clock }) {
  return new Hono<{ Bindings: AppEnv }>().use(requireCronSecret).post("/", (c) => {
    c.executionCtx.waitUntil(runCron(c.env, deps.clock));
    return c.json({ accepted: true as const }, 202);
  });
}

/** 処理を行って、結果をログに出す。失敗しても、例外にはしない（ログに出す） */
async function runCron(env: AppEnv, clock: Clock): Promise<void> {
  try {
    const summary = await runScheduled({ db: createDb(env.DB), rest: createRestFromEnv(env), clock });
    if (summary.ran.length > 0 || summary.errors.length > 0) console.log("cron:", JSON.stringify(summary));
  } catch (error) {
    console.error("cron に失敗しました", error);
  }
}
