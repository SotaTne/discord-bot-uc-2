import type { PlayedMatch, Win } from "@uc/core";
import type { WinRow } from "@uc/db";

/** DB の行を、@uc/core の得点計算が受け取る形に変換する（チーム ID は文字列にそろえる） */
export function toCoreWins(rows: WinRow[]): Win[] {
  return rows.map((row) => ({
    id: row.id,
    matchId: row.matchId,
    teamId: String(row.teamId),
    points: row.points,
    active: row.active,
  }));
}

/** 組分け（試合）を、@uc/core の得点計算が受け取る形に変換する */
export function toCoreMatches(
  rows: { id: number; slotDate: string; slotHour: number; teamAId: number; teamBId: number }[],
): PlayedMatch[] {
  return rows.map((row) => ({
    id: row.id,
    teamIds: [String(row.teamAId), String(row.teamBId)],
    slotDate: row.slotDate,
    slotHour: row.slotHour,
  }));
}
