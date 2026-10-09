import { createDiscordRest } from "@uc/discord";
import type { AppEnv } from "./env";

/**
 * 環境変数から Discord REST のクライアントを作る。
 * 開発のときだけ、DISCORD_API_BASE がモックを指す（本番のビルドでは、この参照ごと消える。本番は、いつも本物の Discord）。
 */
export function createRestFromEnv(env: AppEnv, fetchImpl?: typeof fetch) {
  const baseUrl = import.meta.env.DEV ? env.DISCORD_API_BASE : undefined;
  return createDiscordRest({ token: env.DISCORD_BOT_TOKEN, baseUrl, fetch: fetchImpl });
}
