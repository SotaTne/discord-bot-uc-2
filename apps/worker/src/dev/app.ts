import { systemClock } from "@uc/core";
import { createApp, type AppDeps } from "../app";
import { createDevRoutes } from "./routes";

/** 本番と同じアプリに、開発専用のルート（/dev/*。認証はない）を足したもの。開発の入口（entry.ts）と、テストだけが使う */
export function createDevApp(deps: AppDeps = {}) {
  const clock = deps.clock ?? systemClock;
  return createApp({ ...deps, clock }).route("/dev", createDevRoutes({ clock }));
}
