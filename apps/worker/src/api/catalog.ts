import { slotHourInputSchema, teamInputSchema } from "@uc/api";
import {
  getGuildSettings,
  createSlotHour,
  createTeam,
  deleteSlotHour,
  deleteTeam,
  isUniqueViolation,
  listSlotHours,
  listTeams,
} from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { syncRoleMessage } from "../usecases/role-registration";
import { teamMatchCounts } from "../usecases/team-match-counts";
import { teamNames } from "../usecases/team-names";
import type { AppEnv } from "../env";
import { parseId, type ApiDeps, type ApiEnv } from "./types";

/** チームの登録・削除のあと、ロール登録のメッセージ（永続）を、いまのチームの一覧に合わせる。失敗しても、登録・削除は、取り消さない */
async function syncRoleMessageSafely(env: AppEnv, guildId: string) {
  try {
    await syncRoleMessage({ db: createDb(env.DB), rest: createRestFromEnv(env) }, guildId);
  } catch (error) {
    console.error("ロール登録のメッセージの更新に失敗しました", error);
  }
}

/** 試合時刻とチームの登録 */
export function createCatalogRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>()
    .get("/slot-hours", async (c) => {
      const { guildId } = c.get("auth");
      const slotHours = await listSlotHours(createDb(c.env.DB), guildId);
      return c.json({ slotHours: slotHours.map((slotHour) => ({ id: slotHour.id, hour: slotHour.hour })) });
    })

    .post("/slot-hours", zValidator("json", slotHourInputSchema), async (c) => {
      const { guildId } = c.get("auth");
      try {
        const id = await createSlotHour(createDb(c.env.DB), {
          guildId,
          hour: c.req.valid("json").hour,
          createdAt: deps.clock.now().getTime(),
        });
        return c.json({ id }, 201);
      } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "already_exists" as const }, 409);
        throw error;
      }
    })

    .delete("/slot-hours/:id", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);
      const deleted = await deleteSlotHour(createDb(c.env.DB), c.get("auth").guildId, id, deps.clock.now().getTime());
      return deleted ? c.json({ ok: true as const }) : c.json({ error: "not_found" as const }, 404);
    })

    .get("/teams", async (c) => {
      const { guildId } = c.get("auth");
      const db = createDb(c.env.DB);
      const teams = await listTeams(db, guildId);
      const names = await teamNames(createRestFromEnv(c.env), guildId, teams);
      // 各チームの試合数（そのチームが入った組分けの数。保存せず、毎回、数える）。/uc-teams と同じ数
      const counts = new Map((await teamMatchCounts(db, guildId)).map((row) => [row.team.id, row]));
      return c.json({
        teams: teams.map((team) => ({ id: team.id, name: names.get(team.id) ?? team.roleId, roleId: team.roleId, matchCount: counts.get(team.id)?.count ?? 0, matchOver: counts.get(team.id)?.over ?? false })),
        matchLimit: (await getGuildSettings(db, guildId)).matchLimit,
      });
    })

    .post("/teams", zValidator("json", teamInputSchema), async (c) => {
      const { guildId } = c.get("auth");
      const input = c.req.valid("json");
      try {
        const id = await createTeam(createDb(c.env.DB), {
          guildId,
          roleId: input.roleId,
          createdAt: deps.clock.now().getTime(),
        });
        await syncRoleMessageSafely(c.env, guildId);
        return c.json({ id }, 201);
      } catch (error) {
        // 同じロールのチームがすでにある
        if (isUniqueViolation(error)) return c.json({ error: "already_exists" as const }, 409);
        throw error;
      }
    })

    // 論理削除。過去の組分け・勝利は残り、名前も出る。同じロールを登録し直すと、元に戻る
    .delete("/teams/:id", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);
      const deleted = await deleteTeam(createDb(c.env.DB), c.get("auth").guildId, id, deps.clock.now().getTime());
      if (!deleted) return c.json({ error: "not_found" as const }, 404);
      await syncRoleMessageSafely(c.env, c.get("auth").guildId);
      return c.json({ ok: true as const });
    });
}
