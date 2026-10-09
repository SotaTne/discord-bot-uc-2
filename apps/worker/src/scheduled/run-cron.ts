import type { Clock } from "@uc/core";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import type { AppEnv } from "../env";
import { runScheduled } from "./run";

/**
 * cron の処理を 1 回行う。Cloudflare の Cron Trigger（scheduled）と、外のタイマー（POST /cron）の、どちらも、これを呼ぶ。
 * 何かを実行したか、失敗があったときだけ、ログに出す。失敗しても、例外にはしない（ログに出す）
 */
export async function runCron(env: AppEnv, clock: Clock, source: "scheduled" | "http"): Promise<void> {
  try {
    const summary = await runScheduled({ db: createDb(env.DB), rest: createRestFromEnv(env), clock });
    if (summary.ran.length > 0 || summary.errors.length > 0) console.log(`cron(${source}):`, JSON.stringify(summary));
  } catch (error) {
    console.error(`cron(${source}) に失敗しました`, error);
  }
}
