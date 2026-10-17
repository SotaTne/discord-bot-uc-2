import { ephemeralMessage } from "@uc/discord";
import { formatTeamCounts } from "../messages/teams";
import { teamMatchCounts } from "../usecases/team-match-counts";
import type { CommandHandler } from "./registry";

/** /uc-teams: チームごとの試合数（全員が使える。返信は、本人にだけ見える） */
export const teams: CommandHandler = async ({ interaction, db }) => {
  const guildId = interaction.guild_id;
  if (!guildId) return ephemeralMessage("サーバー内で実行してください");

  return ephemeralMessage(formatTeamCounts(await teamMatchCounts(db, guildId)));
};
