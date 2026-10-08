import { calculateScores, type TeamScore } from "@uc/core";
import { getGuildSettings, listGuildMatches, listWins, type Db } from "@uc/db";
import { toCoreMatches, toCoreWins } from "../scoring/events";

/**
 * サーバーの得点（チーム ID → 得点）と、チームごとの試合数（対戦した組分けの数）を、まとめて求める。
 * 得点は、勝利の記録と、組分け（何試合目か）から決まる。
 */
export async function loadScores(db: Db, guildId: string) {
  const [settings, wins, matches] = await Promise.all([getGuildSettings(db, guildId), listWins(db, guildId), listGuildMatches(db, guildId)]);

  const scores: Map<string, TeamScore> = calculateScores(toCoreWins(wins), toCoreMatches(matches), settings);
  const matchCounts = new Map<number, number>();
  for (const match of matches) {
    for (const teamId of [match.teamAId, match.teamBId]) matchCounts.set(teamId, (matchCounts.get(teamId) ?? 0) + 1);
  }
  return { settings, scores, matchCounts, wins };
}
