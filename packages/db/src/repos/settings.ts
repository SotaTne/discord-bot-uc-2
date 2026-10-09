import { eq, isNotNull } from "drizzle-orm";
import type { Db } from "../client";
import { guildSettings } from "../schema";

/** 募集開始の通知先の選び方 */
export type RecruitMentionMode = "none" | "teams" | "roles";

export type GuildSettingsValues = {
  channelId: string | null;
  recruitHour: number;
  cutoffMinutes: number;
  fixedAfterMatches: number;
  fixedPoints: number;
  /** 募集開始の投稿で、誰に通知するか（既定は、誰にも通知しない） */
  recruitMentionMode: RecruitMentionMode;
  /** mode が roles のときの、通知先。Discord のロールの ID と、"here"（@here） */
  recruitMentionTargets: string[];
  revokeSessionsOnReissue: boolean;
};

/** まだ設定されていないサーバーで使う値（スキーマの既定値と同じ。テストで一致を確かめている） */
export const defaultGuildSettings: GuildSettingsValues = {
  channelId: null,
  recruitHour: 12,
  cutoffMinutes: 7,
  fixedAfterMatches: 5,
  fixedPoints: 100,
  recruitMentionMode: "none",
  recruitMentionTargets: [],
  revokeSessionsOnReissue: false,
};

/** サーバーの設定を返す。未設定なら既定値 */
export async function getGuildSettings(db: Db, guildId: string): Promise<GuildSettingsValues> {
  const [row] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1);
  if (!row) return { ...defaultGuildSettings };
  return {
    channelId: row.channelId,
    recruitHour: row.recruitHour,
    cutoffMinutes: row.cutoffMinutes,
    fixedAfterMatches: row.fixedAfterMatches,
    fixedPoints: row.fixedPoints,
    recruitMentionMode: row.recruitMentionMode,
    recruitMentionTargets: row.recruitMentionTargets,
    revokeSessionsOnReissue: row.revokeSessionsOnReissue,
  };
}

/** サーバーの設定を保存する（なければ作成、あれば更新） */
export async function saveGuildSettings(
  db: Db,
  guildId: string,
  values: GuildSettingsValues,
  now: number,
): Promise<void> {
  await db
    .insert(guildSettings)
    .values({ guildId, ...values, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: guildSettings.guildId, set: { ...values, updatedAt: now } });
}

/** 投稿先のチャンネルが設定されているサーバー（cron の対象） */
export async function listConfiguredGuilds(db: Db): Promise<({ guildId: string } & GuildSettingsValues)[]> {
  const rows = await db.select().from(guildSettings).where(isNotNull(guildSettings.channelId));
  return rows.map((row) => ({
    guildId: row.guildId,
    channelId: row.channelId,
    recruitHour: row.recruitHour,
    cutoffMinutes: row.cutoffMinutes,
    fixedAfterMatches: row.fixedAfterMatches,
    fixedPoints: row.fixedPoints,
    recruitMentionMode: row.recruitMentionMode,
    recruitMentionTargets: row.recruitMentionTargets,
    revokeSessionsOnReissue: row.revokeSessionsOnReissue,
  }));
}
