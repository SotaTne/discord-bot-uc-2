import { slotHourInputSchema, teamInputSchema } from "@uc/api";
import {
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
import { teamNames } from "../usecases/team-names";
import { parseId, type ApiDeps, type ApiEnv } from "./types";

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
      const teams = await listTeams(createDb(c.env.DB), guildId);
      const names = await teamNames(createRestFromEnv(c.env), guildId, teams);
      return c.json({ teams: teams.map((team) => ({ id: team.id, name: names.get(team.id) ?? team.roleId, roleId: team.roleId })) });
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
      return deleted ? c.json({ ok: true as const }) : c.json({ error: "not_found" as const }, 404);
    });
}
