import { formatJstTime, handupPhase, jstDateOf, type HandupPhase } from "@uc/core";
import { getGuildSettings, listMatchSlots, listSlots, listTeamHandupsOnDate, type Handup, type Team } from "@uc/db";
import { ephemeralMessage } from "@uc/discord";
import { resolveCaller, teamMention } from "./caller";
import type { CommandHandler } from "./registry";

const PHASE_LABEL: Record<HandupPhase, string> = {
  "before-open": "受付前",
  open: "受付中",
  closed: "締切",
};

/** matched: その日の対戦枠が、マッチング処理済み（時刻に関係なく、挙手を受け付けない） */
export type SlotStatus = { hour: number; phase: HandupPhase; handups: Handup[]; matched?: boolean };

/** 自チームの挙手状況の文面を作る（純粋な関数） */
export function formatStatus(input: { team: Team; slotDate: string; slots: SlotStatus[] }): string {
  const header = `${teamMention(input.team)} の挙手状況（${input.slotDate}）`;
  if (input.slots.length === 0) {
    return `${header}\n試合枠が登録されていません`;
  }

  const lines = input.slots.map(({ hour, phase, handups, matched }) => {
    const active = handups[0];

    const state = active ? `挙手済み（by <@${active.raisedBy}>, ${formatJstTime(new Date(active.createdAt))}）` : "未挙手";
    return `- ${hour}時: ${state}・${matched ? "マッチング済み" : PHASE_LABEL[phase]}`;
  });

  return [header, ...lines].join("\n");
}

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
    listSlots(db, guildId),
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
