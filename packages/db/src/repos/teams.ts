import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { handups, matchSlots, teams } from "../schema";

export type Team = typeof teams.$inferSelect;

export type TeamLookup = {
  /** 削除したチームも含める（過去の組分け・勝利の名前を出すとき）。省略は、使われているチームだけ */
  includeDeleted?: boolean;
};

const live = (lookup: TeamLookup | undefined) => (lookup?.includeDeleted ? undefined : isNull(teams.deletedAt));

/**
 * チームを登録する。同じロールの、削除したチームがあれば、それを元に戻して、その ID を返す（過去の履歴が、つながる）。
 * 同じロールの、使われているチームがすでにあれば、一意制約の違反になる。
 */
export async function createTeam(
  db: Db,
  input: { guildId: string; roleId: string; createdAt: number },
): Promise<number> {
  const [deleted] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.guildId, input.guildId), eq(teams.roleId, input.roleId), isNotNull(teams.deletedAt)))
    .limit(1);
  if (deleted) {
    await db.update(teams).set({ deletedAt: null }).where(eq(teams.id, deleted.id));
    return deleted.id;
  }
  const [row] = await db.insert(teams).values(input).returning({ id: teams.id });
  if (!row) throw new Error("チームの作成に失敗しました");
  return row.id;
}

export async function findTeamById(db: Db, guildId: string, id: number, lookup?: TeamLookup): Promise<Team | undefined> {
  const [row] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.guildId, guildId), eq(teams.id, id), live(lookup)))
    .limit(1);
  return row;
}

/**
 * チームを削除する（論理削除）。過去の組分け・勝利は、そのまま残る。
 * まだマッチングされていない対戦枠の挙手は、取り消す（マッチング済みの対戦枠の挙手は、履歴なので残す）。
 * 見つからない・すでに削除済みなら false。
 */
export async function deleteTeam(db: Db, guildId: string, id: number, now: number): Promise<boolean> {
  const rows = await db
    .update(teams)
    .set({ deletedAt: now })
    .where(and(eq(teams.guildId, guildId), eq(teams.id, id), isNull(teams.deletedAt)))
    .returning({ id: teams.id });
  if (rows.length === 0) return false;

  const openSlots = db.select({ id: matchSlots.id }).from(matchSlots).where(eq(matchSlots.status, "open"));
  await db.delete(handups).where(and(eq(handups.teamId, id), inArray(handups.matchSlotId, openSlots)));
  return true;
}

export function listTeams(db: Db, guildId: string, lookup?: TeamLookup): Promise<Team[]> {
  return db
    .select()
    .from(teams)
    .where(and(eq(teams.guildId, guildId), live(lookup)))
    .orderBy(asc(teams.id));
}

/** メンバーが持っているロールのうち、チームとして登録されている（削除していない）もの */
export async function findTeamsByRoleIds(db: Db, guildId: string, roleIds: string[]): Promise<Team[]> {
  if (roleIds.length === 0) return [];
  return db
    .select()
    .from(teams)
    .where(and(eq(teams.guildId, guildId), inArray(teams.roleId, roleIds), isNull(teams.deletedAt)))
    .orderBy(asc(teams.id));
}
