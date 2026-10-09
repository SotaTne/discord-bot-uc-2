import { systemClock } from "@uc/core";
import { teams } from "@uc/db";
import { Hono } from "hono";
import { createAuthRoutes } from "../api/auth";
import { createBoardRoutes } from "../api/board";
import { createCatalogRoutes } from "../api/catalog";
import { createHandupRoutes } from "../api/handups";
import { createScoreRoutes } from "../api/scores";
import { createSessionRoutes } from "../api/sessions";
import { createSettingsRoutes } from "../api/settings";
import type { ApiDeps, ApiEnv } from "../api/types";
import { createDb } from "../db";
import { originGuard } from "../middleware/origin-guard";
import { requireSession } from "../middleware/require-session";

export const API_PREFIX = "/api";

/**
 * ログインなしで使える API。ここにないパスは、すべて、有効なセッションが必要（原則は、認証あり）。
 * 新しいルートを足しても、ここに書かない限り、認証が掛かる。
 */
export const PUBLIC_API_PATHS: ReadonlySet<string> = new Set([
  `${API_PREFIX}/health`,
  `${API_PREFIX}/health/db`,
  `${API_PREFIX}/login`,
  `${API_PREFIX}/logout`,
]);

/**
 * ダッシュボード用の JSON API。
 * - 状態を変える操作は、同じオリジンからのものだけを受け付ける（originGuard）
 * - PUBLIC_API_PATHS 以外は、有効なセッションが必要（requireSession。通ると、c.var.auth に、サーバーとユーザーが入る）
 * ルートはメソッドチェーンでつなぐこと（Hono RPC の型が、チェーンの結果から作られるため）。
 */
export function createApiRoutes(deps: ApiDeps = { clock: systemClock }) {
  const session = requireSession(deps);

  return new Hono<ApiEnv>()
    .use(originGuard)
    .use(async (c, next) => (PUBLIC_API_PATHS.has(c.req.path) ? next() : session(c, next)))
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
    .route("/", createSessionRoutes(deps))
    .route("/", createSettingsRoutes(deps))
    .route("/", createCatalogRoutes(deps))
    .route("/", createBoardRoutes(deps))
    .route("/", createHandupRoutes(deps))
    .route("/", createScoreRoutes(deps));
}

/** ダッシュボードが `hc<ApiType>` で使う型。dist/types に宣言ファイルとして出力される */
export type ApiType = ReturnType<typeof createApiRoutes>;
