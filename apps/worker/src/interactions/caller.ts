import { findTeamsByRoleIds, type Db, type Team } from "@uc/db";
import type { Interaction } from "@uc/discord";

export type Caller = { guildId: string; userId: string; team: Team };

export type CallerResult = { ok: true; caller: Caller } | { ok: false; message: string };

/**
 * コマンドを実行した人の所属チームを決める。
 * チームとして登録されているロールを、ちょうど1つ持っている人だけが対象。
 */
export async function resolveCaller(
  interaction: Interaction,
  db: Db,
  options: {
    /** チームのロールを1つも持っていないときのメッセージ */
    noTeamMessage: string;
    /** 「複数のチームロールを持っているため、◯◯できません」の ◯◯ */
    action: string;
  },
): Promise<CallerResult> {
  const guildId = interaction.guild_id;
  const member = interaction.member;
  if (!guildId || !member) {
    return { ok: false, message: "サーバー内で実行してください" };
  }

  const teams = await findTeamsByRoleIds(db, guildId, member.roles);
  const [team, ...others] = teams;
  if (!team) {
    return { ok: false, message: options.noTeamMessage };
  }
  if (others.length > 0) {
    return { ok: false, message: `複数のチームロールを持っているため、${options.action}できません` };
  }

  return { ok: true, caller: { guildId, userId: member.user.id, team } };
}

