import { eq, isNotNull } from "drizzle-orm";
import type { Db } from "../client";
import { guildSettings } from "../schema";

/** 募集開始の通知先の選び方 */
export type RecruitMentionMode = "none" | "teams" | "roles";

export type GuildSettingsValues = {
  channelId: string | null;
  /** ロール登録のメッセージを投稿するチャンネル（空は、使わない） */
  roleChannelId: string | null;
  recruitHour: number;
  cutoffMinutes: number;
  /** 募集開始の投稿で、誰に通知するか（既定は、誰にも通知しない） */
  recruitMentionMode: RecruitMentionMode;
  /** mode が roles のときの、通知先。Discord のロールの ID と、"here"（@here） */
  recruitMentionTargets: string[];
  /** チームの試合数の規定数（超過は、表示だけ）。null は、規定数なし */
  matchLimit: number | null;
  /** 大会の期間の開始日（JST。YYYY-MM-DD）。終了日と両方空なら、期間を設けない */
  seasonStart: string | null;
  seasonEnd: string | null;
  revokeSessionsOnReissue: boolean;
};

/** まだ設定されていないサーバーで使う値（スキーマの既定値と同じ。テストで一致を確かめている） */
export const defaultGuildSettings: GuildSettingsValues = {
  channelId: null,
  roleChannelId: null,
  recruitHour: 12,
  cutoffMinutes: 7,
  recruitMentionMode: "none",
  recruitMentionTargets: [],
  matchLimit: null,
  seasonStart: null,
  seasonEnd: null,
  revokeSessionsOnReissue: false,
};

/** サーバーの設定を返す。未設定なら既定値 */
export async function getGuildSettings(db: Db, guildId: string): Promise<GuildSettingsValues> {
  const [row] = await db.select().from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1);
  if (!row) return { ...defaultGuildSettings };
  return {
    channelId: row.channelId,
    roleChannelId: row.roleChannelId,
    recruitHour: row.recruitHour,
    cutoffMinutes: row.cutoffMinutes,
    recruitMentionMode: row.recruitMentionMode,
    recruitMentionTargets: row.recruitMentionTargets,
    matchLimit: row.matchLimit,
    seasonStart: row.seasonStart,
    seasonEnd: row.seasonEnd,
    revokeSessionsOnReissue: row.revokeSessionsOnReissue,
  };
}

/** ロール登録のメッセージの ID（投稿順。まだ投稿していなければ空）。設定の保存では変わらない、状態 */
export async function getRoleMessageIds(db: Db, guildId: string): Promise<string[]> {
  const [row] = await db.select({ ids: guildSettings.roleMessageIds }).from(guildSettings).where(eq(guildSettings.guildId, guildId)).limit(1);
  return row?.ids ?? [];
}

/** ロール登録のメッセージの ID を、投稿順で保存する（空配列で、消す）。設定のないサーバーでは、何もしない */
export async function setRoleMessageIds(db: Db, guildId: string, messageIds: readonly string[]): Promise<void> {
  await db.update(guildSettings).set({ roleMessageIds: messageIds.length === 0 ? null : [...messageIds] }).where(eq(guildSettings.guildId, guildId));
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
    roleChannelId: row.roleChannelId,
    recruitHour: row.recruitHour,
    cutoffMinutes: row.cutoffMinutes,
    recruitMentionMode: row.recruitMentionMode,
    recruitMentionTargets: row.recruitMentionTargets,
    matchLimit: row.matchLimit,
    seasonStart: row.seasonStart,
    seasonEnd: row.seasonEnd,
    revokeSessionsOnReissue: row.revokeSessionsOnReissue,
  }));
}
