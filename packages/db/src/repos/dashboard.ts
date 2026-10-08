import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Db } from "../client";
import { dashboardLinks, sessions } from "../schema";

export type SessionRow = typeof sessions.$inferSelect;

/** ダッシュボードのログインリンクを発行する（トークンそのものではなく、ハッシュを保存する） */
export async function createDashboardLink(
  db: Db,
  input: { tokenHash: string; guildId: string; issuedBy: string; expiresAt: number; createdAt: number },
): Promise<void> {
  await db.insert(dashboardLinks).values(input);
}

/**
 * リンクを消費する。有効期限内で、まだ使われていなければ、使用済みにして発行者を返す。
 * 使用済み・期限切れ・存在しないときは null。1文で更新するので、同時に使っても1回しか成功しない。
 */
export async function consumeDashboardLink(
  db: Db,
  tokenHash: string,
  now: number,
): Promise<{ guildId: string; issuedBy: string } | null> {
  const [row] = await db
    .update(dashboardLinks)
    .set({ usedAt: now })
    .where(
      and(
        eq(dashboardLinks.tokenHash, tokenHash),
        isNull(dashboardLinks.usedAt),
        gt(dashboardLinks.expiresAt, now),
      ),
    )
    .returning({ guildId: dashboardLinks.guildId, issuedBy: dashboardLinks.issuedBy });
  return row ?? null;
}

export async function createSession(
  db: Db,
  input: {
    sessionHash: string;
    guildId: string;
    userId: string;
    userAgent: string | null;
    createdAt: number;
    expiresAt: number;
  },
): Promise<number> {
  const [row] = await db.insert(sessions).values(input).returning({ id: sessions.id });
  if (!row) throw new Error("セッションの作成に失敗しました");
  return row.id;
}

/** 有効なセッション（失効していない・期限内）。なければ undefined */
export async function findActiveSession(db: Db, sessionHash: string, now: number): Promise<SessionRow | undefined> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.sessionHash, sessionHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  return row;
}

/** サーバーの有効なセッションを、新しい順に返す */
export function listActiveSessions(db: Db, guildId: string, now: number): Promise<SessionRow[]> {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.guildId, guildId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .orderBy(desc(sessions.createdAt), desc(sessions.id));
}

/** セッションを失効させる。対象があれば true */
export async function revokeSession(db: Db, guildId: string, id: number, now: number): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.guildId, guildId), eq(sessions.id, id), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

/** サーバーの有効なセッションをすべて失効させる。失効させた件数を返す */
export async function revokeAllSessions(db: Db, guildId: string, now: number): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.guildId, guildId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

/** 期限切れのリンクとセッションを消す（保存を増やし続けないための掃除） */
export async function deleteExpiredCredentials(db: Db, now: number): Promise<void> {
  await db.delete(dashboardLinks).where(or(lte(dashboardLinks.expiresAt, now)));
  await db.delete(sessions).where(lte(sessions.expiresAt, now));
}

export type DashboardLinkRow = typeof dashboardLinks.$inferSelect;

/** 発行したログインリンクを、新しい順に返す（トークンのハッシュは含めない） */
export async function listDashboardLinks(db: Db, guildId: string, limit = 20) {
  const rows = await db
    .select({
      issuedBy: dashboardLinks.issuedBy,
      createdAt: dashboardLinks.createdAt,
      expiresAt: dashboardLinks.expiresAt,
      usedAt: dashboardLinks.usedAt,
    })
    .from(dashboardLinks)
    .where(eq(dashboardLinks.guildId, guildId))
    .orderBy(desc(dashboardLinks.id))
    .limit(limit);
  return rows;
}
