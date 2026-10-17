import { seasonAccess, type SeasonAccess } from "@uc/core";
import { getGuildSettings, type Db, type GuildSettingsValues } from "@uc/db";

/** 設定から、大会の期間だけを取り出す */
export function seasonWindow(settings: Pick<GuildSettingsValues, "seasonStart" | "seasonEnd">) {
  return { start: settings.seasonStart, end: settings.seasonEnd };
}

/** 今日と対象の日から、そのサーバーの大会の期間に対する操作の可否を返す */
export async function seasonAccessFor(db: Db, guildId: string, today: string, date: string): Promise<SeasonAccess> {
  const settings = await getGuildSettings(db, guildId);
  return seasonAccess(today, date, seasonWindow(settings));
}
