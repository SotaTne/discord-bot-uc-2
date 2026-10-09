import { formatJstTime, handupPhase, jstDateOf, type HandupPhase } from "@uc/core";
import {
  getGuildSettings,
  listHandupsOnDate,
  listMatchedSlots,
  listSlotHours,
  listTeams,
  type Handup,
  type MatchedSlot,
  type Team,
} from "@uc/db";
import { ephemeralMessage } from "@uc/discord";
import { ADMIN_ONLY_MESSAGE, isAdmin } from "./admin";
import type { CommandHandler } from "./registry";

const PHASE_LABEL: Record<HandupPhase, string> = {
  "before-open": "受付前",
  open: "受付中",
  closed: "締切（マッチング待ち）",
};

export type AdminSlotStatus = {
  hour: number;
  phase: HandupPhase;
  /** 挙手 */
  handups: Handup[];
  /** マッチング済みなら、その結果 */
  matched: MatchedSlot | null;
};

/** 今日の、すべてのチームの挙手状況とマッチング結果の文面を作る（純粋な関数）。チームは、ロールのメンションで表す */
export function formatAdminStatus(input: { slotDate: string; teams: Team[]; slots: AdminSlotStatus[] }): string {
  const header = `# 挙手状況（${input.slotDate}）`;
  if (input.slots.length === 0) return `${header}\n試合時刻が登録されていません`;

  const mention = (teamId: number) => {
    const team = input.teams.find((t) => t.id === teamId);
    return team ? `<@&${team.roleId}>` : `チーム${teamId}`;
  };

  const sections = input.slots.map(({ hour, phase, handups, matched }) => {
    if (matched) {
      const lines = [`## ${hour}時 ・マッチング済み`];
      for (const pair of matched.pairs) lines.push(`- ${mention(pair.teamAId)} vs ${mention(pair.teamBId)}`);
      if (matched.excludedTeamId !== null) lines.push(`- ${mention(matched.excludedTeamId)} は組まれませんでした`);
      if (matched.pairs.length === 0 && matched.excludedTeamId === null) lines.push("挙手がありませんでした");
      return lines.join("\n");
    }

    const lines = [`## ${hour}時 ・${PHASE_LABEL[phase]}`];
    if (handups.length === 0) lines.push("挙手なし");
    for (const handup of handups) {
      lines.push(`- ${mention(handup.teamId)}（by <@${handup.raisedBy}>, ${formatJstTime(new Date(handup.createdAt))}）`);
    }
    return lines.join("\n");
  });

  return [header, ...sections].join("\n");
}

/** /uc-admin-status: 今日の、すべてのチームの挙手状況とマッチング結果を見る（管理者のみ。本人にだけ見える） */
export const adminStatus: CommandHandler = async ({ interaction, clock, db }) => {
  if (!isAdmin(interaction)) return ephemeralMessage(ADMIN_ONLY_MESSAGE);
  const guildId = interaction.guild_id;
  if (!guildId) return ephemeralMessage("サーバー内で実行してください");

  const now = clock.now();
  const slotDate = jstDateOf(now);
  const [settings, slots, teams, handups, matchedSlots] = await Promise.all([
    getGuildSettings(db, guildId),
    listSlotHours(db, guildId),
    listTeams(db, guildId, { includeDeleted: true }),
    listHandupsOnDate(db, { guildId, slotDate }),
    listMatchedSlots(db, { guildId, slotDate }),
  ]);

  return ephemeralMessage(
    formatAdminStatus({
      slotDate,
      teams,
      slots: slots.map((slot) => ({
        hour: slot.hour,
        phase: handupPhase(now, slot.hour, settings),
        handups: handups.filter((h) => h.slotHour === slot.hour),
        matched: matchedSlots.find((m) => m.slotHour === slot.hour) ?? null,
      })),
    }),
  );
};
