import { systemClock } from "@uc/core";
import { teams } from "@uc/db";
import { Hono } from "hono";
import { createAuthRoutes, requireSession } from "../api/auth";
import { createBoardRoutes } from "../api/board";
import { createCatalogRoutes } from "../api/catalog";
import { createHandupRoutes } from "../api/handups";
import { createScoreRoutes } from "../api/scores";
import { createSessionRoutes } from "../api/sessions";
import { createSettingsRoutes } from "../api/settings";
import type { ApiDeps, ApiEnv } from "../api/types";
import { createDb } from "../db";
import type { AppEnv } from "../env";
import { originGuard } from "../middleware/origin-guard";

/**
 * ダッシュボード用の JSON API。
 * - 状態を変える操作は、同じオリジンからのものだけを受け付ける（originGuard）
 * - /health と /login と /logout 以外は、有効なセッションが必要
 * ルートはメソッドチェーンでつなぐこと（Hono RPC の型が、チェーンの結果から作られるため）。
 */
export function createApiRoutes(deps: ApiDeps = { clock: systemClock }) {
  const protectedRoutes = new Hono<ApiEnv>()
    .use(requireSession(deps))
    .route("/", createSessionRoutes(deps))
    .route("/", createSettingsRoutes(deps))
    .route("/", createCatalogRoutes(deps))
    .route("/", createBoardRoutes(deps))
    .route("/", createHandupRoutes(deps))
    .route("/", createScoreRoutes(deps));

  return new Hono<{ Bindings: AppEnv }>()
    .use(originGuard)
    .get("/health", (c) => c.json({ ok: true as const }))
    // DB（D1）に Drizzle で接続できるかの確認。データは返さない
    .get("/health/db", async (c) => {
      try {
        await createDb(c.env.DB).select({ id: teams.id }).from(teams).limit(1);
        return c.json({ ok: true as const });
      } catch (error) {
        console.error("DB の確認に失敗しました", error);
        return c.json({ ok: false as const }, 503);
      }
    })
    .route("/", createAuthRoutes(deps))
    .route("/", protectedRoutes);
}

/** ダッシュボードが `hc<ApiType>` で使う型。dist/types に宣言ファイルとして出力される */
export type ApiType = ReturnType<typeof createApiRoutes>;
