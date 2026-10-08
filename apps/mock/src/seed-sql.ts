import type { Seed } from "./state";

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * ローカルの D1 に投入する開発用データ（SQL）。
 * 疑似 Discord のロールをそのままチームとして登録し、試合時刻とチャンネルを設定する。
 * INSERT OR IGNORE なので、何度実行しても同じ結果になる。
 */
export function buildSeedSql(seed: Seed, options: { slotHours: number[]; now: number }): string {
  const guild = quote(seed.guildId);
  const statements = [
    `INSERT OR IGNORE INTO guild_settings (guild_id, channel_id, created_at, updated_at) VALUES (${guild}, ${quote(seed.channelId)}, ${options.now}, ${options.now});`,
    ...seed.roles.map(
      (role) =>
        `INSERT OR IGNORE INTO teams (guild_id, role_id, created_at) VALUES (${guild}, ${quote(role.id)}, ${options.now});`,
    ),
    ...options.slotHours.map(
      (hour) =>
        `INSERT OR IGNORE INTO slots (guild_id, hour, created_at) VALUES (${guild}, ${hour}, ${options.now});`,
    ),
  ];
  return `${statements.join("\n")}\n`;
}
