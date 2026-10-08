import type { Clock } from "@uc/core";
import { deleteGuildActivity, findWin, listConfiguredGuilds, type Db } from "@uc/db";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { resolveClock } from "../clock";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { buildDevSnapshot } from "../dev/snapshot";
import type { AppEnv } from "../env";
import { runScheduled } from "../scheduled/run";

/** 対象のサーバー。?guildId= があればそれ、なければ、投稿先のチャンネルを設定した最初のサーバー */
async function targetGuildId(db: Db, query: string | undefined): Promise<string | undefined> {
  if (query) return query;
  return (await listConfiguredGuilds(db))[0]?.guildId;
}

/**
 * 開発専用。DEV_CLOCK=true のときだけ動き、それ以外は 404 を返す（本番では使えない）。
 * - POST /tick: cron を待たずに、指定した日時で cron の処理（募集開始・締切）を1回実行する
 * - GET /state: いまの状態（挙手・対戦・得点・cron の予定と履歴・照合・ログイン）をまとめて返す
 * - GET /screenshots/:id: 保存した画像（ログインなしで見られる）
 * - POST /reset: 活動の記録（挙手・マッチング・得点・cron の履歴・ログイン）を消す。設定・枠・チームは残す
 */
export function createDevRoutes(deps: { clock: Clock }) {
  const onlyInDev = createMiddleware<{ Bindings: AppEnv }>(async (c, next) => {
    if (c.env.DEV_CLOCK !== "true") return c.json({ error: "not found" }, 404);
    await next();
  });

  return new Hono<{ Bindings: AppEnv }>()
    .use(onlyInDev)

    .post("/tick", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { now?: string };
      const clock = resolveClock(deps.clock, c.env, body.now);
      const summary = await runScheduled({ db: createDb(c.env.DB), rest: createRestFromEnv(c.env), clock });
      return c.json(summary);
    })

    .get("/state", async (c) => {
      const db = createDb(c.env.DB);
      const guildId = await targetGuildId(db, c.req.query("guildId"));
      if (!guildId) return c.json({ error: "no_guild" as const }, 404);

      const clock = resolveClock(deps.clock, c.env, c.req.header("X-Dev-Now"));
      return c.json(await buildDevSnapshot({ db, guildId, clock, baseClock: deps.clock, rest: createRestFromEnv(c.env) }), 200);
    })

    .get("/screenshots/:id", async (c) => {
      const db = createDb(c.env.DB);
      const guildId = await targetGuildId(db, c.req.query("guildId"));
      const id = Number(c.req.param("id"));
      if (!guildId || !Number.isInteger(id)) return c.json({ error: "not_found" as const }, 404);

      const event = await findWin(db, guildId, id);
      const object = event?.screenshotKey ? await c.env.SCREENSHOTS.get(event.screenshotKey) : null;
      if (!object) return c.json({ error: "not_found" as const }, 404);

      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        },
      });
    })

    .post("/reset", async (c) => {
      const db = createDb(c.env.DB);
      const guildId = await targetGuildId(db, c.req.query("guildId"));
      if (!guildId) return c.json({ error: "no_guild" as const }, 404);

      await deleteGuildActivity(db, guildId);
      return c.json({ ok: true as const });
    });
}
