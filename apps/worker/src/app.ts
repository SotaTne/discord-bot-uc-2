import { systemClock, type Clock } from "@uc/core";
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { createApiRoutes } from "./routes/api";
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
  return new Hono<{ Bindings: AppEnv }>()
    .route("/api", createApiRoutes({ clock }))
    .route("/dev", createDevRoutes({ clock }))
    .route("/interactions", createInteractionsRoute({ clock, waitUntil: deps.waitUntil, fetch: deps.fetch }));
}
