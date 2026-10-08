import { loginInputSchema } from "@uc/api";
import { consumeDashboardLink, createSession, findActiveSession, revokeSession } from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { createDb } from "../db";
import type { AppEnv } from "../env";
import { generateToken, sha256Hex } from "../security/tokens";
import { SESSION_TTL_MS, clearSessionCookie, readSessionToken, writeSessionCookie } from "./session";
import type { ApiDeps, ApiEnv } from "./types";

/** ログインとログアウト（ログイン前でも使える） */
export function createAuthRoutes(deps: ApiDeps) {
  return new Hono<{ Bindings: AppEnv }>()
    // ログインリンクのトークンを消費して、セッション（Cookie）を発行する
    .post("/login", zValidator("json", loginInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const now = deps.clock.now().getTime();

      const link = await consumeDashboardLink(db, await sha256Hex(c.req.valid("json").token), now);
      if (!link) {
        // 使用済み・期限切れ・存在しない、のどれかは区別して伝えない
        return c.json({ error: "invalid_or_expired" as const }, 401);
      }

      const sessionToken = generateToken();
      await createSession(db, {
        sessionHash: await sha256Hex(sessionToken),
        guildId: link.guildId,
        userId: link.issuedBy,
        userAgent: c.req.header("User-Agent")?.slice(0, 200) ?? null,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });
      writeSessionCookie(c, sessionToken);
      return c.json({ ok: true as const });
    })

    .post("/logout", async (c) => {
      const token = readSessionToken(c);
      if (token) {
        const db = createDb(c.env.DB);
        const now = deps.clock.now().getTime();
        const session = await findActiveSession(db, await sha256Hex(token), now);
        if (session) await revokeSession(db, session.guildId, session.id, now);
      }
      clearSessionCookie(c);
      return c.json({ ok: true as const });
    });
}

/** セッションがなければ 401。あれば、サーバーとユーザーを c.var.auth に入れる */
export const requireSession = (deps: ApiDeps) =>
  createMiddleware<ApiEnv>(async (c, next) => {
    const token = readSessionToken(c);
    const session = token
      ? await findActiveSession(createDb(c.env.DB), await sha256Hex(token), deps.clock.now().getTime())
      : undefined;
    if (!session) {
      return c.json({ error: "unauthorized" as const }, 401);
    }
    c.set("auth", { guildId: session.guildId, userId: session.userId, sessionId: session.id });
    await next();
  });
