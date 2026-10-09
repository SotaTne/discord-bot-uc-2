import { findActiveSession } from "@uc/db";
import { createMiddleware } from "hono/factory";
import { readSessionToken } from "../api/session";
import type { ApiDeps, ApiEnv } from "../api/types";
import { createDb } from "../db";
import { sha256Hex } from "../security/tokens";

/** ダッシュボードのログイン。セッションがなければ 401。あれば、サーバーとユーザーを c.var.auth に入れる */
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
