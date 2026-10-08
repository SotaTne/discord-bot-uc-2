import { eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { dashboardLinks, handups, jobRuns, matches, matchSlots, sessions, wins } from "../schema";

/**
 * 開発用: サーバーの「活動の記録」（挙手・マッチング結果・得点・cron の履歴・ログイン）をすべて消す。
 * 設定・試合枠・チームは、残す。本番のデータには使わない（worker は、開発用の設定のときだけ呼べるようにしている）。
 */
export async function deleteGuildActivity(db: Db, guildId: string): Promise<void> {
  await db.delete(wins).where(eq(wins.guildId, guildId));
  const slots = await db.select({ id: matchSlots.id }).from(matchSlots).where(eq(matchSlots.guildId, guildId));
  if (slots.length > 0) {
    await db.delete(matches).where(
      inArray(
        matches.matchSlotId,
        slots.map((slot) => slot.id),
      ),
    );
  }
  await db.delete(handups).where(eq(handups.guildId, guildId));
  await db.delete(matchSlots).where(eq(matchSlots.guildId, guildId));
  await db.delete(jobRuns).where(eq(jobRuns.guildId, guildId));
  await db.delete(dashboardLinks).where(eq(dashboardLinks.guildId, guildId));
  await db.delete(sessions).where(eq(sessions.guildId, guildId));
}
