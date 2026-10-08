import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { matches, matchSlots, wins } from "../schema";

/** 勝利の記録。どの試合かを持ち、その対戦枠の日付と時刻も持つ（結合で取る） */
export type WinRow = {
  id: number;
  guildId: string;
  matchId: number;
  /** 勝ったチーム */
  teamId: number;
  /** 組分け（試合）の2チーム。勝ったチームは、このどちらか */
  teamAId: number;
  teamBId: number;
  slotDate: string;
  slotHour: number;
  points: number;
  /** 有効か。無効な記録は、得点に数えない */
  active: boolean;
  screenshotKey: string | null;
  recordedBy: string;
  createdAt: number;
};

const columns = {
  id: wins.id,
  guildId: wins.guildId,
  matchId: wins.matchId,
  teamId: wins.teamId,
  teamAId: matches.teamAId,
  teamBId: matches.teamBId,
  slotDate: matchSlots.slotDate,
  slotHour: matchSlots.slotHour,
  points: wins.points,
  active: wins.active,
  screenshotKey: wins.screenshotKey,
  recordedBy: wins.recordedBy,
  createdAt: wins.createdAt,
};

const selectWins = (db: Db) =>
  db
    .select(columns)
    .from(wins)
    .innerJoin(matches, eq(wins.matchId, matches.id))
    .innerJoin(matchSlots, eq(matches.matchSlotId, matchSlots.id));

/**
 * 勝利を記録する（はじめは有効）。どの試合（組み合わせ）の勝利かを持つ。
 * teamId は、その試合の2チームのどちらか（呼び出し側が、findMatchForTeam で確かめる）。
 * 点数は入力された生の値（N 試合を超えた試合の固定点は、集計時に適用する）。
 */
export async function insertWin(
  db: Db,
  input: {
    guildId: string;
    matchId: number;
    teamId: number;
    points: number;
    screenshotKey: string | null;
    recordedBy: string;
    createdAt: number;
  },
): Promise<number> {
  const [row] = await db.insert(wins).values(input).returning({ id: wins.id });
  if (!row) throw new Error("勝利の記録に失敗しました");
  return row.id;
}

/** 記録を有効にする / 無効にする（間違えた記録を、削除せずに外す。あとで戻せる）。見つからなければ false */
export async function setWinActive(db: Db, input: { guildId: string; id: number; active: boolean }): Promise<boolean> {
  const rows = await db
    .update(wins)
    .set({ active: input.active })
    .where(and(eq(wins.guildId, input.guildId), eq(wins.id, input.id)))
    .returning({ id: wins.id });
  return rows.length > 0;
}

/** 記録の点数（生の点数）を直す。勝ったチーム・組分け・画像は、変えない。見つからなければ false */
export async function updateWinPoints(db: Db, input: { guildId: string; id: number; points: number }): Promise<boolean> {
  const rows = await db
    .update(wins)
    .set({ points: input.points })
    .where(and(eq(wins.guildId, input.guildId), eq(wins.id, input.id)))
    .returning({ id: wins.id });
  return rows.length > 0;
}

/**
 * 得点のクリア: サーバーの、すべての勝利の記録を削除する（履歴も 0 になる）。
 * 削除した記録が持っていた画像の R2 キーを返す（呼び出し側が、R2 からも消す）。
 */
export async function deleteAllWins(db: Db, guildId: string): Promise<string[]> {
  const rows = await db.delete(wins).where(eq(wins.guildId, guildId)).returning({ key: wins.screenshotKey });
  return rows.flatMap((row) => (row.key === null ? [] : [row.key]));
}

/** サーバーのすべての勝利の記録を、記録した順に返す（無効なものも含む） */
export function listWins(db: Db, guildId: string): Promise<WinRow[]> {
  return selectWins(db).where(eq(wins.guildId, guildId)).orderBy(asc(wins.id));
}

export async function findWin(db: Db, guildId: string, id: number): Promise<WinRow | undefined> {
  const [row] = await selectWins(db)
    .where(and(eq(wins.guildId, guildId), eq(wins.id, id)))
    .limit(1);
  return row;
}

/** その組分けに、有効な勝利の記録があるか（有効な記録は、1つの組分けに1件まで） */
export async function hasActiveWin(db: Db, matchId: number): Promise<boolean> {
  const rows = await db.select({ id: wins.id }).from(wins).where(and(eq(wins.matchId, matchId), eq(wins.active, true))).limit(1);
  return rows.length > 0;
}
