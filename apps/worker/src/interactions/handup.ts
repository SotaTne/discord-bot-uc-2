import { jstDateOf } from "@uc/core";
import { createHandup, MatchSlotMatchedError, isUniqueViolation } from "@uc/db";
import { ephemeralMessage, getIntegerOption } from "@uc/discord";
import { teamMention } from "../messages/mention";
import { resolveCaller } from "./caller";
import type { CommandHandler } from "./registry";
import { checkAcceptingSlot } from "./slot-access";

const ALREADY_RAISED = "すでに挙手しています";

/** /uc-handup time: 自チームの挙手をする（チームごとに、日・対戦枠で1件） */
export const handup: CommandHandler = async ({ interaction, clock, db }) => {
  const hour = getIntegerOption(interaction, "time");
  if (hour === null) {
    return ephemeralMessage("時刻を指定してください");
  }

  const resolved = await resolveCaller(interaction, db, {
    noTeamMessage: "挙手が許可されていません",
    action: "挙手",
  });
  if (!resolved.ok) return ephemeralMessage(resolved.message);
  const { guildId, userId, team } = resolved.caller;

  const now = clock.now();
  const access = await checkAcceptingSlot(db, { guildId, hour, now });
  if (!access.ok) return ephemeralMessage(access.message);

  try {
    await createHandup(db, {
      guildId,
      slotDate: jstDateOf(now),
      slotHour: hour,
      teamId: team.id,
      raisedBy: userId,
      createdAt: now.getTime(),
    });
  } catch (error) {
    // 同時に挙手されたときは、UNIQUE 制約が先に挙手した方だけを通す
    if (isUniqueViolation(error)) return ephemeralMessage(ALREADY_RAISED);
    // 確認のあとで、マッチングが先に処理されたとき
    if (error instanceof MatchSlotMatchedError) return ephemeralMessage(`${hour}時の試合は、すでにマッチングが済んでいます`);
    throw error;
  }

  return ephemeralMessage(`${teamMention(team)} ${hour}時の試合に挙手しました`);
};
