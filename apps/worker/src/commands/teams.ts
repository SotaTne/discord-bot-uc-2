import type { TeamScore } from "@uc/core";
import { listTeams, type Team } from "@uc/db";
import { ephemeralMessage } from "@uc/discord";
import { loadScores } from "../usecases/scores";
import type { CommandHandler } from "./registry";

/**
 * 得点の内訳の文面（試合数・勝利数。試合数が N を超えていれば、その旨）。例: 5試合・3勝・試合数5を超過しました
 * 試合数が N を超えると、それ以降の試合で、勝っても、記録した点数に関係なく、固定点で数える。
 */
export function scoreDetail(input: { matches: number; wins: number }, rule: { fixedAfterMatches: number }): string {
  const exceeded = input.matches > rule.fixedAfterMatches ? `・試合数${rule.fixedAfterMatches}を超過しました` : "";
  return `${input.matches}試合・${input.wins}勝${exceeded}`;
}

/**
 * 得点の一覧の文面を作る（純粋な関数）。チームは、ロールのメンションで表す（Discord が、ロールの名前で見せる）。得点の高い順で、同点は同じ順位（1位, 1位, 3位）。
 * 有効な勝利のないチームは 0pt として並べる。
 */
export function formatScoreboard(
  teams: Team[],
  scores: Map<string, TeamScore>,
  rule: { fixedAfterMatches: number; fixedPoints: number } = { fixedAfterMatches: 5, fixedPoints: 100 },
  /** チームごとの試合数（対戦した組分けの数）。省略すると、0 試合 */
  matchCounts: Map<number, number> = new Map(),
): string {
  if (teams.length === 0) return "チームが登録されていません";

  const rows = teams
    .map((team) => ({
      id: team.id,
      roleId: team.roleId,
      total: scores.get(String(team.id))?.total ?? 0,
      wins: scores.get(String(team.id))?.wins.length ?? 0,
      matches: matchCounts.get(team.id) ?? 0,
    }))
    .sort((a, b) => b.total - a.total || a.id - b.id);

  let rank = 0;
  let previousTotal: number | null = null;
  const lines = rows.map((row, index) => {
    if (row.total !== previousTotal) rank = index + 1;
    previousTotal = row.total;
    return `${rank}位 <@&${row.roleId}> ${row.total}pt（${scoreDetail(row, rule)}）`;
  });
  return ["# チームの得点", ...lines].join("\n");
}

/** /uc-teams: チームごとの得点を見る */
export const teams: CommandHandler = async ({ interaction, db }) => {
  const guildId = interaction.guild_id;
  if (!guildId) return ephemeralMessage("サーバー内で実行してください");

  const [{ settings, scores, matchCounts }, teamList] = await Promise.all([loadScores(db, guildId), listTeams(db, guildId)]);
  return ephemeralMessage(formatScoreboard(teamList, scores, settings, matchCounts));
};
