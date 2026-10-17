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
import { formatAdminStatus, type AdminSlotStatus } from "../messages/status";
import { ADMIN_ONLY_MESSAGE, isAdmin } from "./admin";
import type { CommandHandler } from "./registry";

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
