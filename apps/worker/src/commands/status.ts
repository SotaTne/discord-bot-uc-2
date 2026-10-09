import { handupPhase, jstDateOf } from "@uc/core";
import { getGuildSettings, listMatchSlots, listSlotHours, listTeamHandupsOnDate, listTeams } from "@uc/db";
import { ephemeralMessage } from "@uc/discord";
import { formatStatus, type SlotStatus } from "../messages/status";
import { loadScores } from "../usecases/scores";
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
  const [slots, matchSlots, handups, { scores, matchCounts }, teamList] = await Promise.all([
    listSlotHours(db, guildId),
    listMatchSlots(db, { guildId, slotDate }),
    listTeamHandupsOnDate(db, { guildId, slotDate, teamId: team.id }),
    loadScores(db, guildId),
    listTeams(db, guildId),
  ]);

  // 順位は、/uc-teams と同じ（得点が同じなら、同じ順位）
  const totalOf = (teamId: number) => scores.get(teamId)?.total ?? 0;
  const total = totalOf(team.id);

  return ephemeralMessage(
    formatStatus({
      team,
      slotDate,
      score: {
        total,
        rank: 1 + teamList.filter((other) => totalOf(other.id) > total).length,
        matches: matchCounts.get(team.id) ?? 0,
        wins: scores.get(team.id)?.wins.length ?? 0,
        fixedAfterMatches: settings.fixedAfterMatches,
        fixedPoints: settings.fixedPoints,
      },
      slots: slots.map((slot) => ({
        hour: slot.hour,
        phase: handupPhase(now, slot.hour, settings),
        handups: handups.filter((h) => h.slotHour === slot.hour),
        matched: matchSlots.some((matchSlot) => matchSlot.slotHour === slot.hour && matchSlot.status === "matched"),
      })),
    }),
  );
};
