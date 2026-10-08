import { commands } from "./commands";
import { createDiscordRest } from "./rest";

export type RegisterEnv = Record<string, string | undefined>;

/**
 * 環境変数から、スラッシュコマンドを Discord に登録する。
 * - DISCORD_BOT_TOKEN と DISCORD_APPLICATION_ID が必要
 * - DISCORD_GUILD_ID を指定すると、そのサーバーだけに登録する（すぐに反映される。動作確認向け）。省略すると全サーバー
 * - DISCORD_API_BASE を指定すると、Discord の代わりにモックに登録する
 */
export async function registerAllCommands(
  env: RegisterEnv,
  options: { fetch?: typeof fetch } = {},
): Promise<{ count: number; scope: "guild" | "global"; names: string[] }> {
  const token = env.DISCORD_BOT_TOKEN;
  const applicationId = env.DISCORD_APPLICATION_ID;
  const guildId = env.DISCORD_GUILD_ID || undefined;

  if (!token) throw new Error("DISCORD_BOT_TOKEN が設定されていません");
  if (!applicationId) throw new Error("DISCORD_APPLICATION_ID が設定されていません");

  const rest = createDiscordRest({ token, baseUrl: env.DISCORD_API_BASE, fetch: options.fetch });
  const registered = await rest.registerCommands(applicationId, commands, guildId);

  return { count: registered.length, scope: guildId ? "guild" : "global", names: registered.map((command) => command.name) };
}
