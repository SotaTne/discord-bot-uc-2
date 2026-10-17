import { jstDateOf } from "@uc/core";
import { withdrawHandup } from "@uc/db";
import { ephemeralMessage, getIntegerOption } from "@uc/discord";
import { teamMention } from "../messages/mention";
import { resolveCaller } from "./caller";
import type { CommandHandler } from "./registry";
import { checkAcceptingSlot } from "./slot-access";

/** /uc-handdown time: 自チームの挙手を取り消す（チームの誰が取り消してもよい） */
export const handdown: CommandHandler = async ({ interaction, clock, db }) => {
  const hour = getIntegerOption(interaction, "time");
  if (hour === null) {
    return ephemeralMessage("時刻を指定してください");
  }

  const resolved = await resolveCaller(interaction, db, {
    noTeamMessage: "キャンセルが許可されていません",
    action: "キャンセル",
  });
  if (!resolved.ok) return ephemeralMessage(resolved.message);
  const { guildId, userId, team } = resolved.caller;

  const now = clock.now();
  const access = await checkAcceptingSlot(db, { guildId, hour, now });
  if (!access.ok) return ephemeralMessage(access.message);

  const withdrawn = await withdrawHandup(db, {
    guildId,
    slotDate: jstDateOf(now),
    slotHour: hour,
    teamId: team.id
  });
  if (withdrawn === "matched") return ephemeralMessage(`${hour}時の試合は、すでにマッチングが済んでいます`);
  if (withdrawn === "not_found") return ephemeralMessage(`${hour}時の挙手はありません`);

  return ephemeralMessage(`${teamMention(team)} ${hour}時の挙手を取り消しました`);
};
