import { Hono } from "hono";
import { createMockApi, type MockApiDeps } from "./api";
import type { DiscordServer } from "./discord";

export type MockAppDeps = MockApiDeps & { discord: Pick<DiscordServer, "routes"> };

/**
 * 疑似 Discord のサーバー全体。2 つの役を、別々の入口に、つなぐだけ。
 * - /api/v10/*: Discord のサーバー役（worker が呼ぶ）
 * - /mock-api/*: 画面用の API（ブラウザの画面が呼ぶ）
 */
export function createMockApp(deps: MockAppDeps) {
  return new Hono().route("/", deps.discord.routes).route("/mock-api", createMockApi(deps));
}
