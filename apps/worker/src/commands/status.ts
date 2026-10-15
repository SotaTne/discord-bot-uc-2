import { handupPhase, jstDateOf } from "@uc/core";
import { getGuildSettings, listMatchSlots, listSlotHours, listTeamHandupsOnDate } from "@uc/db";
import { ephemeralMessage } from "@uc/discord";
import { formatStatus, type SlotStatus } from "../messages/status";
import { resolveCaller } from "./caller";
import type { CommandHandler } from "./registry";

/** /uc-status: 自チームの挙手状況だけを見せる（他チームの状況は見せない） */
export const status: CommandHandler = async ({ interaction, clock, db }) => {
  const resolved = await resolveCaller(interaction, db, {
    noTeamMessage: "チームに所属していません",
    action: "確認",
  });
  if (!resolved.ok) return ephemeralMessage(resolved.message);
  const { guildId, team } = resolved.caller;

  const now = clock.now();
  const slotDate = jstDateOf(now);
  const settings = await getGuildSettings(db, guildId);
  const [slots, matchSlots, handups] = await Promise.all([
    listSlotHours(db, guildId),
    listMatchSlots(db, { guildId, slotDate }),
    listTeamHandupsOnDate(db, { guildId, slotDate, teamId: team.id }),
  ]);

  return ephemeralMessage(
    formatStatus({
      team,
      slotDate,
      slots: slots.map((slot) => ({
        hour: slot.hour,
        phase: handupPhase(now, slot.hour, settings),
        handups: handups.filter((h) => h.slotHour === slot.hour),
        matched: matchSlots.some((matchSlot) => matchSlot.slotHour === slot.hour && matchSlot.status === "matched"),
      })),
    }),
  );
};
