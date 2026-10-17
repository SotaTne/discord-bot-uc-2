import type { Clock } from "@uc/core";
import { deleteGuildActivity, listConfiguredGuilds, type Db } from "@uc/db";
import { Hono } from "hono";
import { getDevClockState, parseDevClockState, setDevClockState } from "./clock";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { buildDevSnapshot } from "./snapshot";
import type { AppEnv } from "../env";
import { runScheduled } from "../scheduled/run";

/** 対象のサーバー。?guildId= があればそれ、なければ、投稿先のチャンネルを設定した最初のサーバー */
async function targetGuildId(db: Db, query: string | undefined): Promise<string | undefined> {
  if (query) return query;
  return (await listConfiguredGuilds(db))[0]?.guildId;
}

/**
 * 開発専用（認証はない）。開発の入口（dev/entry.ts → dev/app.ts）だけが組み込む。本番の入口（index.ts）は、このファイルを、読み込まない。
 * - GET /clock: 疑似時計の状態（本物の時刻 + ずれ）と、いまの時刻
 * - PUT /clock: 疑似時計の状態を設定する。worker 全体（API・Discord・cron）が、この時計に従う
 * - POST /tick: cron を待たずに、いまの疑似時計で cron の処理（募集開始・締切）を1回実行する
 * - GET /state: いまの状態（挙手・対戦・得点・cron の予定と履歴・照合・ログイン）をまとめて返す
 * - GET /screenshots/:id: 保存した画像（ログインなしで見られる）
 * - POST /reset: 活動の記録（挙手・マッチング・得点・cron の履歴・ログイン）を消す。設定・対戦枠・チームは残す
 */
export function createDevRoutes(deps: { clock: Clock }) {
  return new Hono<{ Bindings: AppEnv }>()
    .get("/clock", (c) => c.json({ ...getDevClockState(), now: deps.clock.now().getTime() }))

    .put("/clock", async (c) => {
      const next = parseDevClockState(await c.req.json().catch(() => null));
      if (!next) return c.json({ error: "invalid_clock" as const }, 400);
      setDevClockState(next);
      return c.json({ ...next, now: deps.clock.now().getTime() });
    })

    .post("/tick", async (c) => {
      const summary = await runScheduled({ db: createDb(c.env.DB), rest: createRestFromEnv(c.env), clock: deps.clock });
      return c.json(summary);
    })

    .get("/state", async (c) => {
      const db = createDb(c.env.DB);
      const guildId = await targetGuildId(db, c.req.query("guildId"));
      if (!guildId) return c.json({ error: "no_guild" as const }, 404);

      return c.json(await buildDevSnapshot({ db, guildId, clock: deps.clock, rest: createRestFromEnv(c.env) }), 200);
    })

    .post("/reset", async (c) => {
      const db = createDb(c.env.DB);
      const guildId = await targetGuildId(db, c.req.query("guildId"));
      if (!guildId) return c.json({ error: "no_guild" as const }, 404);

      await deleteGuildActivity(db, guildId);
      return c.json({ ok: true as const });
    });
}
