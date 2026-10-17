import { settingsUpdateSchema } from "@uc/api";
import { jstDateOf, recruitJobKey, slotStart } from "@uc/core";
import { claimJob, getGuildSettings, listTeams, releaseJob, saveGuildSettings } from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { postSettingsChange, recruitMention } from "../messages";
import type { SettingsChange } from "../messages/settings-change";
import type { ApiDeps, ApiEnv } from "./types";

/** サーバーの設定と、Discord のロール一覧 */
export function createSettingsRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>()
    .get("/settings", async (c) => {
      const { guildId } = c.get("auth");
      return c.json(await getGuildSettings(createDb(c.env.DB), guildId));
    })

    // 保存する。notifyChange が true で、募集開始の時刻か締切が変わったときは、変更を、チャンネルに知らせる。
    // 知らせるのに失敗しても、保存は、取り消さない（notifyFailed で、画面に知らせる）
    .put("/settings", zValidator("json", settingsUpdateSchema), async (c) => {
      const { guildId } = c.get("auth");
      const { notifyChange, ...values } = c.req.valid("json");
      const db = createDb(c.env.DB);
      const now = deps.clock.now();

      const before = await getGuildSettings(db, guildId);
      await saveGuildSettings(db, guildId, values, now.getTime());

      const change: SettingsChange = {};
      const today = jstDateOf(now);
      if (before.recruitHour !== values.recruitHour) {
        change.recruit = {
          from: before.recruitHour,
          to: values.recruitHour,
          // 新しい時刻が、もう来ている。受付は、時刻で開くので、いまから、挙手できる
          started: now.getTime() >= slotStart(today, values.recruitHour).getTime(),
        };
      }
      if (before.cutoffMinutes !== values.cutoffMinutes) change.cutoff = { from: before.cutoffMinutes, to: values.cutoffMinutes };

      if (!notifyChange || !values.channelId || (!change.recruit && !change.cutoff)) {
        return c.json({ ok: true as const, notified: false, notifyFailed: false });
      }

      // 新しい募集開始の時刻が、すでに来ているときは、この知らせが、募集開始の投稿を兼ねる。cron が、続けて、同じ内容を投稿しないように、先に、権利を取る
      const recruitKey = change.recruit?.started ? recruitJobKey(today, values.recruitHour) : null;
      const claimed = recruitKey ? await claimJob(db, guildId, recruitKey, now.getTime()) : false;
      try {
        const teams = values.recruitMentionMode === "teams" ? await listTeams(db, guildId) : [];
        await postSettingsChange(createRestFromEnv(c.env), {
          channelId: values.channelId,
          change,
          mention: recruitMention(values, teams),
        });
        return c.json({ ok: true as const, notified: true, notifyFailed: false });
      } catch (error) {
        console.error("設定の変更の知らせの投稿に失敗しました", error);
        if (recruitKey && claimed) await releaseJob(db, guildId, recruitKey);
        return c.json({ ok: true as const, notified: false, notifyFailed: true });
      }
    })

    // チームのロールを選ぶための、サーバーのロール一覧（@everyone は除く）
    .get("/roles", async (c) => {
      const { guildId } = c.get("auth");
      try {
        const roles = await createRestFromEnv(c.env).getGuildRoles(guildId);
        return c.json({
          roles: roles
            .filter((role) => role.id !== guildId)
            .sort((a, b) => b.position - a.position)
            .map((role) => ({ id: role.id, name: role.name })),
        });
      } catch (error) {
        console.error("ロール一覧の取得に失敗しました", error);
        return c.json({ error: "discord_unavailable" as const }, 502);
      }
    });
}
