import { adminHandupInputSchema } from "@uc/api";
import { jstDateOf } from "@uc/core";
import {
  createHandup,
  MatchSlotMatchedError,
  findSlot,
  findTeamById,
  isUniqueViolation,
  withdrawHandupById,
} from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { parseId, type ApiDeps, type ApiEnv } from "./types";

/** 管理者による、代理の挙手と取り消し（一覧は、枠の画面（/board）で見る） */
export function createHandupRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>()
    // 管理者による代理の挙手。受付時間に関係なくできる。ただし、マッチング処理済みの対戦枠には、できない
    .post("/handups", zValidator("json", adminHandupInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId, userId } = c.get("auth");
      const input = c.req.valid("json");
      const now = deps.clock.now();

      if (!(await findTeamById(db, guildId, input.teamId))) return c.json({ error: "team_not_found" as const }, 404);
      if (!(await findSlot(db, guildId, input.slotHour))) return c.json({ error: "slot_not_found" as const }, 404);

      try {
        const id = await createHandup(db, {
          guildId,
          slotDate: input.slotDate ?? jstDateOf(now),
          slotHour: input.slotHour,
          teamId: input.teamId,
          raisedBy: userId,
          createdAt: now.getTime(),
        });
        return c.json({ id }, 201);
      } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: "already_raised" as const }, 409);
        if (error instanceof MatchSlotMatchedError) return c.json({ error: "slot_matched" as const }, 409);
        throw error;
      }
    })

    // 管理者による代理の取り消し
    .delete("/handups/:id", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);
      const { guildId } = c.get("auth");

      const withdrawn = await withdrawHandupById(createDb(c.env.DB), { guildId, id });
      if (withdrawn === "matched") return c.json({ error: "slot_matched" as const }, 409);
      return withdrawn === "withdrawn" ? c.json({ ok: true as const }) : c.json({ error: "not_found" as const }, 404);
    });
}
