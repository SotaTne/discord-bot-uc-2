import { formatJstTime, handupPhase, jstDateOf, type HandupPhase } from "@uc/core";
import { getGuildSettings, listMatchSlots, listSlots, listTeamHandupsOnDate, listTeams, type Handup, type Team } from "@uc/db";
import { ephemeralMessage } from "@uc/discord";
import { loadScores } from "../usecases/scores";
import { resolveCaller, teamMention } from "./caller";
import type { CommandHandler } from "./registry";

const PHASE_LABEL: Record<HandupPhase, string> = {
  "before-open": "受付前",
  open: "受付中",
  closed: "締切",
};

/** matched: その日の対戦枠が、マッチング済み（時刻に関係なく、挙手を受け付けない） */
export type SlotStatus = { hour: number; phase: HandupPhase; handups: Handup[]; matched?: boolean };

/** 自チームの挙手状況の文面を作る（純粋な関数） */
export function formatStatus(input: {
  team: Team;
  slotDate: string;
  slots: SlotStatus[];
  /** 自チームの得点（順位・試合数・勝利数）。あれば、見出しの下に出す */
  score?: { total: number; rank: number; matches: number; wins: number; fixedAfterMatches: number; fixedPoints: number };
}): string {
  // 得点は、数字を太字にして、順位・試合数・勝利数を、短く並べる。N を超えたときは、別の行（小さな字）で、その意味を伝える
  const scoreLine = input.score
    ? `\n**${input.score.total}pt**（${input.score.rank}位）・${input.score.matches}試合・${input.score.wins}勝` +
      (input.score.matches > input.score.fixedAfterMatches
        ? `\n-# 試合数${input.score.fixedAfterMatches}を超えました。以降の試合は、勝つと${input.score.fixedPoints}pt固定です`
        : "")
    : "";
  const header = `${teamMention(input.team)} の挙手状況（${input.slotDate}）${scoreLine}`;
  if (input.slots.length === 0) {
    return `${header}\n試合時刻が登録されていません`;
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
  const [slots, matchSlots, handups, { scores, matchCounts }, teamList] = await Promise.all([
    listSlots(db, guildId),
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
