import { createDiscordRest } from "@uc/discord";
import type { AppEnv } from "./env";

/** 環境変数から Discord REST のクライアントを作る（開発時は DISCORD_API_BASE がモックを指す） */
export function createRestFromEnv(env: AppEnv, fetchImpl?: typeof fetch) {
  return createDiscordRest({ token: env.DISCORD_BOT_TOKEN, baseUrl: env.DISCORD_API_BASE, fetch: fetchImpl });
}
