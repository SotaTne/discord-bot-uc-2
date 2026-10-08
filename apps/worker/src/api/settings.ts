import { settingsInputSchema } from "@uc/api";
import { getGuildSettings, saveGuildSettings } from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import type { ApiDeps, ApiEnv } from "./types";

/** サーバーの設定と、Discord のロール一覧 */
export function createSettingsRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>()
    .get("/settings", async (c) => {
      const { guildId } = c.get("auth");
      return c.json(await getGuildSettings(createDb(c.env.DB), guildId));
    })

    .put("/settings", zValidator("json", settingsInputSchema), async (c) => {
      const { guildId } = c.get("auth");
      await saveGuildSettings(createDb(c.env.DB), guildId, c.req.valid("json"), deps.clock.now().getTime());
      return c.json({ ok: true as const });
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
