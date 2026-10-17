import { handupPhase, hostTeamOf, isContinuedRecruit, jstDateOf, matchNumberKey, matchNumbers } from "@uc/core";
import { getGuildSettings, listGuildMatches, listMatchSlots, listSlotHours, listTeamHandupsOnDate, listTeams } from "@uc/db";
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
  const [slots, matchSlots, handups, guildMatches, teams] = await Promise.all([
    listSlotHours(db, guildId),
    listMatchSlots(db, { guildId, slotDate }),
    listTeamHandupsOnDate(db, { guildId, slotDate, teamId: team.id }),
    listGuildMatches(db, guildId),
    listTeams(db, guildId, { includeDeleted: true }),
  ]);
  const teamOf = (id: number) => teams.find((t) => t.id === id);
  // 何試合目か: 自チームが入った組分けを、日付・時刻の順に数える（保存せず、毎回、数える）
  const numbers = matchNumbers(guildMatches);
  const mine = guildMatches.filter((match) => match.teamAId === team.id || match.teamBId === team.id);

  return ephemeralMessage(
    formatStatus({
      team,
      slotDate,
      matchCount: mine.length,
      matchLimit: settings.matchLimit,
      slots: slots.map((slot) => {
        const own = mine.find((match) => match.slotDate === slotDate && match.slotHour === slot.hour);
        const matchSlot = matchSlots.find((m) => m.slotHour === slot.hour);
        const opponent = own ? teamOf(own.teamAId === team.id ? own.teamBId : own.teamAId) : undefined;
        // 主催は、組分けを作るときに決めて保存した値。古い行（空）だけ、計算で補う
        const host = own ? teamOf(own.hostTeamId ?? hostTeamOf({ slotDate, slotHour: slot.hour, teamAId: own.teamAId, teamBId: own.teamBId })) : undefined;
        const number = own ? (numbers.get(matchNumberKey(team.id, own.id)) ?? 0) : 0;
        return {
          hour: slot.hour,
          phase: handupPhase(now, slot.hour, settings),
          handups: handups.filter((h) => h.slotHour === slot.hour),
          matched: matchSlot?.status === "matched",
          ...(own && opponent && host ? { match: { opponent, number, host, over: settings.matchLimit !== null && number > settings.matchLimit } } : {}),
          ...(matchSlot?.excludedTeamId === team.id ? { excluded: true } : {}),
          ...(matchSlot && isContinuedRecruit({ ...matchSlot, slotDate, slotHour: slot.hour }, now)
            ? (() => {
                const waiting = teamOf(matchSlot.excludedTeamId!);
                return waiting ? { continued: { waiting, self: waiting.id === team.id } } : {};
              })()
            : {}),
        };
      }),
    }),
  );
};
