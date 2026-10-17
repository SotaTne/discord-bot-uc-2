import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Discord の ID（snowflake）は桁が大きいので、すべて文字列で持つ。
// 時刻は epoch ミリ秒の整数で持つ（@uc/core の Date 計算と揃える）。

export const guildSettings = sqliteTable("guild_settings", {
  guildId: text("guild_id").primaryKey(),
  /** 募集開始・締切・マッチングを投稿するチャンネル */
  channelId: text("channel_id"),
  /** 募集を開始する時刻（JST の時） */
  recruitHour: integer("recruit_hour").notNull().default(12),
  /** 試合開始の何分前に打ち切るか */
  cutoffMinutes: integer("cutoff_minutes").notNull().default(7),
  /** 募集開始の投稿で、誰に通知するか。none: 誰にも / teams: 登録済みのチームのロール全部 / roles: recruit_mention_targets で選んだもの */
  recruitMentionMode: text("recruit_mention_mode", { enum: ["none", "teams", "roles"] }).notNull().default("none"),
  /** recruit_mention_mode が roles のときの、通知先。Discord のロールの ID と、"here"（@here）の配列（JSON） */
  recruitMentionTargets: text("recruit_mention_targets", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  /** ロール登録のメッセージ（チームのロールを選ぶボタン）を投稿するチャンネル。空は、ロール登録を使わない */
  roleChannelId: text("role_channel_id"),
  /**
   * 投稿したロール登録のメッセージの ID（投稿順の JSON 配列）。
   * チームは 20 ごとにメッセージを分けるので、2 件以上になる。チームを登録・削除したとき、このメッセージを編集する（設定の保存では変わらない）。
   */
  roleMessageIds: text("role_message_id", { mode: "json" }).$type<string[] | null>(),
  /** チームの試合数の規定数（これを超えると、/uc-teams とダッシュボードに「超過」と出す。null は、規定数なし）。表示だけで、挙手・マッチングは止めない */
  matchLimit: integer("match_limit"),
  /**
   * 大会の期間（JST の日付。YYYY-MM-DD）。開始日と終了日は、どちらも含む。両方空なら、期間を設けない。
   * 時刻は持たない（終了日の試合は、その日の試合開始まで行う）。
   */
  seasonStart: text("season_start"),
  seasonEnd: text("season_end"),
  /** ダッシュボードのリンクを再発行したときに、古いセッションを失効させるか */
  revokeSessionsOnReissue: integer("revoke_sessions_on_reissue", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** 試合時刻（設定で登録する、試合を行う時刻）。ある日の、ある試合時刻の場（対戦枠）は、`match_slots` */
export const slotHours = sqliteTable(
  "slot_hours",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    /** 試合開始時刻（JST の時） */
    hour: integer("hour").notNull(),
    createdAt: integer("created_at").notNull(),
    /** 削除した時刻（論理削除）。入っていれば、削除済みの試合時刻。同じ時刻を追加し直すと、null に戻る */
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("slot_hours_guild_hour").on(t.guildId, t.hour),
    check("slot_hours_hour_range", sql`${t.hour} BETWEEN 0 AND 23`),
  ],
);

export const teams = sqliteTable(
  "teams",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    /** チームを表す Discord のロール ID。このロールを持つ人がメンバー。表示名は、ロールの名前（Discord から取る）を使うので、持たない */
    roleId: text("role_id").notNull(),
    createdAt: integer("created_at").notNull(),
    /**
     * 削除した時刻（論理削除）。空なら、使われているチーム。
     * 削除しても、過去の組分け・勝利には、名前が残る。同じロールを登録し直すと、この行が元に戻る。
     */
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("teams_guild_role").on(t.guildId, t.roleId),
  ],
);

/**
 * 対戦枠（match slot）: ある日の、ある時刻の試合（日付 × 試合時刻）。挙手・組分け（matches）は、すべてこれに紐づく。
 * open（未マッチング。挙手を受け付ける）→ matched（マッチング済み。挙手を受け付けない）。
 * 時刻ではなく、この状態が「挙手を受け付けるか」の根拠になる（時計を戻しても、処理済みの対戦枠は開かない）。
 */
export const matchSlots = sqliteTable(
  "match_slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    /** 試合の日付（JST, YYYY-MM-DD） */
    slotDate: text("slot_date").notNull(),
    slotHour: integer("slot_hour").notNull(),
    status: text("status", { enum: ["open", "matched"] })
      .notNull()
      .default("open"),
    /** マッチングを処理した時刻。open なら空 */
    matchedAt: integer("matched_at"),
    /** 奇数などで、組まれなかったチーム（処理済みのときだけ入りうる） */
    excludedTeamId: integer("excluded_team_id").references(() => teams.id),
    /**
     * 継続募集: 組まれなかったチームが、「待機する」を押した時刻。空なら、待機していない。
     * 待機しているチームは、excluded_team_id。継続募集中かどうかは、これと時刻から、計算する（`isContinuedRecruit`）
     */
    waitingSince: integer("waiting_since"),
    /** 継続募集の案内（「待機する」のボタン）を投稿した、Discord のメッセージの ID（ボタンの編集に使う） */
    waitingMessageId: text("waiting_message_id"),
    /** 継続募集の募集のメッセージ（「対戦する」「待機をキャンセル」のボタン）の ID。最初の待機のとき、1 回だけ投稿し、あとは、編集する */
    waitingAnnounceMessageId: text("waiting_announce_message_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("match_slots_slot").on(t.guildId, t.slotDate, t.slotHour),
    check("match_slots_hour_range", sql`${t.slotHour} BETWEEN 0 AND 23`),
    check(
      "match_slots_status_shape",
      sql`(${t.status} = 'open' AND ${t.matchedAt} IS NULL AND ${t.excludedTeamId} IS NULL) OR (${t.status} = 'matched' AND ${t.matchedAt} IS NOT NULL)`,
    ),
  ],
);

export const handups = sqliteTable(
  "handups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    matchSlotId: integer("match_slot_id")
      .notNull()
      .references(() => matchSlots.id),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    raisedBy: text("raised_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    // 同じ対戦枠・チームの挙手は1件だけ。取り消すと、行ごと削除する（取り消した履歴は、残さない）ので、取り消した後の再挙手もできる。
    uniqueIndex("handups_unique").on(t.matchSlotId, t.teamId),
    index("handups_match_slot").on(t.matchSlotId),
  ],
);

/**
 * 組分け: 対戦枠で組まれた2チーム。
 * 対戦枠のマッチングを処理すると作られる。
 */
export const matches = sqliteTable(
  "matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchSlotId: integer("match_slot_id")
      .notNull()
      .references(() => matchSlots.id),
    teamAId: integer("team_a_id")
      .notNull()
      .references(() => teams.id),
    teamBId: integer("team_b_id")
      .notNull()
      .references(() => teams.id),
    /** 主催（マリオカートの部屋を立てる側）。組分けを作るときに、2 チームから無作為に決めて保存する。古い行は空（表示では、計算で補う） */
    hostTeamId: integer("host_team_id").references(() => teams.id),
  },
  (t) => [
    index("matches_match_slot").on(t.matchSlotId),
    check("matches_distinct_teams", sql`${t.teamAId} <> ${t.teamBId}`),
  ],
);

export const dashboardLinks = sqliteTable("dashboard_links", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** トークンそのものは保存せず、ハッシュだけを持つ */
  tokenHash: text("token_hash").notNull().unique(),
  guildId: text("guild_id").notNull(),
  issuedBy: text("issued_by").notNull(),
  expiresAt: integer("expires_at").notNull(),
  /** 使用済みなら入る。1回しか使えない */
  usedAt: integer("used_at"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionHash: text("session_hash").notNull().unique(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
});

/** cron が二重に動いても、投稿やマッチングが重複しないようにする */
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    /** 例: recruit:2026-10-07:12 / cutoff:2026-10-07:21 */
    jobKey: text("job_key").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("job_runs_unique").on(t.guildId, t.jobKey)],
);
