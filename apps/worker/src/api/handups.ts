import { adminHandupInputSchema } from "@uc/api";
import { jstDateOf } from "@uc/core";
import { findHandupById, findSlotHour, findTeamById } from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { addHandupByAdmin, withdrawHandupByAdmin } from "../usecases/admin-matches";
import { seasonAccessFor } from "../usecases/season";
import { parseId, type ApiDeps, type ApiEnv } from "./types";

/** 管理者による、代理の挙手と取り消し（一覧は、対戦枠の画面（/board）で見る） */
export function createHandupRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>()
    // 管理者による代理の挙手。受付時間に関係なくできる。マッチング済み・試合開始後の対戦枠にも、記録として付けられる（マッチングは、しない）
    .post("/handups", zValidator("json", adminHandupInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId, userId } = c.get("auth");
      const input = c.req.valid("json");
      const now = deps.clock.now();

      const today = jstDateOf(now);
      const slotDate = input.slotDate ?? today;
      if ((await seasonAccessFor(db, guildId, today, slotDate)) !== "play") return c.json({ error: "outside_season" as const }, 409);
      if (!(await findTeamById(db, guildId, input.teamId))) return c.json({ error: "team_not_found" as const }, 404);
      if (!(await findSlotHour(db, guildId, input.slotHour))) return c.json({ error: "slot_not_found" as const }, 404);

      const added = await addHandupByAdmin({ db, now }, { guildId, userId, slotDate, slotHour: input.slotHour, teamId: input.teamId });
      if (added === "already") return c.json({ error: "already_raised" as const }, 409);
      return c.json({ id: added.id }, 201);
    })

    // 管理者による代理の取り消し。マッチング済みの対戦枠でも、記録として取り消せる。ただし、そのチームが組分けに入っているときは、先に組分けを削除する
    .delete("/handups/:id", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);
      const { guildId } = c.get("auth");
      const db = createDb(c.env.DB);
      const found = await findHandupById(db, { guildId, id });
      if (!found) return c.json({ error: "not_found" as const }, 404);
      const today = jstDateOf(deps.clock.now());
      if ((await seasonAccessFor(db, guildId, today, found.slotDate)) !== "play") return c.json({ error: "outside_season" as const }, 409);

      const withdrawn = await withdrawHandupByAdmin({ db, rest: createRestFromEnv(c.env), now: deps.clock.now() }, { guildId, id });
      if (withdrawn === "in_match") return c.json({ error: "team_in_match" as const }, 409);
      return withdrawn === "withdrawn" ? c.json({ ok: true as const }) : c.json({ error: "not_found" as const }, 404);
    });
}
