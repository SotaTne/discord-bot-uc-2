import { systemClock, type Clock } from "@uc/core";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { API_PREFIX, createApiRoutes } from "./routes/api";
import { createDevRoutes } from "./routes/dev";
import { createInteractionsRoute, type InteractionsDeps } from "./routes/interactions";

export type AppDeps = {
  /** 現在時刻の取得元。テストや開発で差し替えられる */
  clock?: Clock;
  waitUntil?: InteractionsDeps["waitUntil"];
  fetch?: typeof fetch;
};

export function createApp(deps: AppDeps = {}) {
  const clock = deps.clock ?? systemClock;
  const app = new Hono<{ Bindings: AppEnv }>()
    .route(API_PREFIX, createApiRoutes({ clock }))
    .route("/interactions", createInteractionsRoute({ clock, waitUntil: deps.waitUntil, fetch: deps.fetch }));
  // 開発専用の入口（/dev/*。認証はない）。本番のビルドでは、`import.meta.env.DEV` が false になり、このコードごと消える
  if (import.meta.env.DEV) app.route("/dev", createDevRoutes({ clock }));
  return app;
}
