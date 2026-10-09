import { listTeams } from "@uc/db";
import { ephemeralMessage } from "@uc/discord";
import { formatScoreboard } from "../messages/scoreboard";
import { loadScores } from "../usecases/scores";
import type { CommandHandler } from "./registry";

/** /uc-teams: チームごとの得点を見る */
export const teams: CommandHandler = async ({ interaction, db }) => {
  const guildId = interaction.guild_id;
  if (!guildId) return ephemeralMessage("サーバー内で実行してください");

  const [{ settings, scores, matchCounts }, teamList] = await Promise.all([loadScores(db, guildId), listTeams(db, guildId)]);
  return ephemeralMessage(formatScoreboard(teamList, scores, settings, matchCounts));
};
