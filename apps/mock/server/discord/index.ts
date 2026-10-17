import { Hono } from "hono";
import type { DevKeyPair } from "@uc/discord/testing";
import { createDiscordInteractions, type InteractionClientOptions } from "./interactions";
import { createDiscordRestRoutes } from "./rest";
import type { MockState } from "./state";

export { createDiscordInteractions, type InteractionClientOptions } from "./interactions";
export { createDiscordRestRoutes } from "./rest";
export { createMockState, type MockMessage, type MockRole, type MockState, type MockUser, type Seed } from "./state";

export type DiscordServerOptions = InteractionClientOptions & { keys: DevKeyPair };

/**
 * 疑似 Discord の「Discord のサーバー役」。
 * - 世界の状態（ユーザー・ロール・メッセージ）
 * - worker が呼ぶ REST（/api/v10/*）
 * - worker に、署名つきで、コマンドやボタンの操作を送る（Interactions）
 * 画面用の API（時計・状態の取得・操作の受け付け）は、ここにはない（../api）。
 */
export function createDiscordServer(options: DiscordServerOptions, state: MockState) {
  const interactions = createDiscordInteractions(options, state);

  const routes = new Hono()
    .route("/api/v10", createDiscordRestRoutes(state));

  return { state, interactions, routes };
}

export type DiscordServer = ReturnType<typeof createDiscordServer>;
