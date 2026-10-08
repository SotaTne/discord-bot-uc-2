import { listActiveSessions, revokeAllSessions, revokeSession } from "@uc/db";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { nameOrId, userNames } from "../usecases/user-names";
import { clearSessionCookie } from "./session";
import { parseId, type ApiDeps, type ApiEnv } from "./types";

/** ログイン中の人の確認と、セッションの管理（一覧・失効） */
export function createSessionRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>()
    .get("/me", (c) => {
      const { guildId, userId } = c.get("auth");
      return c.json({ guildId, userId });
    })

    .get("/sessions", async (c) => {
      const { guildId, sessionId } = c.get("auth");
      const sessions = await listActiveSessions(createDb(c.env.DB), guildId, deps.clock.now().getTime());
      const people = await userNames(createRestFromEnv(c.env), guildId, sessions.map((session) => session.userId));
      return c.json({
        sessions: sessions.map((session) => ({
          id: session.id,
          userId: session.userId,
          userName: nameOrId(people, session.userId) ?? session.userId,
          userAgent: session.userAgent,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          current: session.id === sessionId,
        })),
      });
    })

    .delete("/sessions/:id", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);
      const { guildId, sessionId } = c.get("auth");

      const revoked = await revokeSession(createDb(c.env.DB), guildId, id, deps.clock.now().getTime());
      if (!revoked) return c.json({ error: "not_found" as const }, 404);
      if (id === sessionId) clearSessionCookie(c);
      return c.json({ ok: true as const });
    })

    // すべてのセッション（いま使っているものも含む）を失効させる
    .post("/sessions/revoke-all", async (c) => {
      const revoked = await revokeAllSessions(createDb(c.env.DB), c.get("auth").guildId, deps.clock.now().getTime());
      clearSessionCookie(c);
      return c.json({ revoked });
    });
}
