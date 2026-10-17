import { listGuildMatches, listTeams, type Db, type Team } from "@uc/db";

/** チームごとの試合数。試合数は、そのチームが入った組分けの数（勝ち負けに関係なく）。次の試合は、試合数 + 1 試合目 */
export type TeamMatchCount = { team: Team; count: number };

/**
 * いま登録されているチームごとの、これまでの試合数。チームの登録順（並べ替えて、順位に見せない）。
 * 保存せず、組分けから、毎回、数える（管理者が追加した組分けも、数に入る。削除したチームは、出さない）。
 */
export async function teamMatchCounts(db: Db, guildId: string): Promise<TeamMatchCount[]> {
  const [teams, matches] = await Promise.all([listTeams(db, guildId), listGuildMatches(db, guildId)]);
  const counts = new Map<number, number>();
  for (const match of matches) {
    for (const teamId of [match.teamAId, match.teamBId]) counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
  }
  return teams.map((team) => ({ team, count: counts.get(team.id) ?? 0 }));
}
