import { appClock } from "./clock";
import { createApp } from "./app";
import { createDb } from "./db";
import { createRestFromEnv } from "./discord";
import type { AppEnv } from "./env";
import { runScheduled } from "./scheduled/run";

// 時計は、1 つを、HTTP と cron で共有する（開発では、疑似時計）
const clock = appClock();
const app = createApp({ clock });

export default {
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
