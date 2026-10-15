import { handupPhase, jstDateOf, matchNumberKey, matchNumbers } from "@uc/core";
import { getGuildSettings, listGuildMatches, listMatchSlots, listSlotHours, listTeamHandupsOnDate } from "@uc/db";
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
  const [slots, matchSlots, handups, guildMatches] = await Promise.all([
    listSlotHours(db, guildId),
    listMatchSlots(db, { guildId, slotDate }),
    listTeamHandupsOnDate(db, { guildId, slotDate, teamId: team.id }),
    listGuildMatches(db, guildId),
  ]);
  // 何試合目か: 自チームが入った組分けを、日付・時刻の順に数える（保存せず、毎回、数える）
  const numbers = matchNumbers(guildMatches);
  const mine = guildMatches.filter((match) => match.teamAId === team.id || match.teamBId === team.id);

  return ephemeralMessage(
    formatStatus({
      team,
      slotDate,
      matchCount: mine.length,
      slots: slots.map((slot) => {
        const own = mine.find((match) => match.slotDate === slotDate && match.slotHour === slot.hour);
        const matchNumber = own ? numbers.get(matchNumberKey(team.id, own.id)) : undefined;
        return {
          hour: slot.hour,
          phase: handupPhase(now, slot.hour, settings),
          handups: handups.filter((h) => h.slotHour === slot.hour),
          matched: matchSlots.some((matchSlot) => matchSlot.slotHour === slot.hour && matchSlot.status === "matched"),
          ...(matchNumber === undefined ? {} : { matchNumber }),
        };
      }),
    }),
  );
};
