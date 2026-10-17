import { getGuildSettings, type Team } from "@uc/db";
import { ephemeralMessage } from "@uc/discord";
import { parseRoleSetId } from "../messages/roles";
import { teamMention } from "../messages/mention";
import { assignTeamRole, currentTeams, removeTeamRole, syncRoleMessage } from "../usecases/role-registration";
import { ADMIN_ONLY_MESSAGE, isAdmin } from "./admin";
import type { CommandHandler } from "./registry";

/**
 * ロール登録（メンバーが、自分でチームのロールを付ける・外す）の入口。Discord のスラッシュコマンドとボタン。
 * ここでやるのは、誰が押したかの確認と、usecase（`usecases/role-registration.ts`）の呼び出しと、本人にだけ見える返信の文面だけ。
 */

const NEED_ADMIN_CHECK = "ロールを変更できませんでした。運営に、ボットの「ロールの管理」の権限と、ボットのロールの位置（チームのロールより上）を、確認してもらってください";
const mentions = (teams: readonly Team[]) => teams.map(teamMention).join(" ");

/** /uc-admin-role: ロール登録のメッセージを、投稿する（すでにあれば、いまのチームの一覧に更新する）。管理者のみ */
export const adminRole: CommandHandler = async ({ interaction, db, rest }) => {
  if (!isAdmin(interaction)) return ephemeralMessage(ADMIN_ONLY_MESSAGE);
  const guildId = interaction.guild_id;
  if (!guildId) return ephemeralMessage("サーバー内で実行してください");

  const { roleChannelId } = await getGuildSettings(db, guildId);
  if (!roleChannelId) return ephemeralMessage("ロール登録の投稿先のチャンネルが、設定されていません。ダッシュボードの設定で、決めてください");

  try {
    const result = await syncRoleMessage({ db, rest }, guildId);
    return ephemeralMessage(
      result === "posted" ? `ロール登録のメッセージを、<#${roleChannelId}> に投稿しました` : `<#${roleChannelId}> のロール登録のメッセージを、更新しました`,
    );
  } catch (error) {
    console.error("ロール登録のメッセージの投稿に失敗しました", error);
    return ephemeralMessage("ロール登録のメッセージを投稿できませんでした。ボットが、そのチャンネルに投稿できる権限を持っているか、確認してください");
  }
};

/** 「チームのボタン」: そのチームのロールを付ける。すでにチームのロールを持っている人は、変えない */
export const roleSet: CommandHandler = async ({ interaction, db, rest }) => {
  const teamId = parseRoleSetId(interaction.data?.custom_id ?? "");
  const guildId = interaction.guild_id;
  const member = interaction.member;
  if (teamId === null) return ephemeralMessage("この操作は無効です");
  if (!guildId || !member) return ephemeralMessage("サーバー内で実行してください");

  const result = await assignTeamRole({ db, rest }, { guildId, userId: member.user.id, memberRoleIds: member.roles, teamId });
  switch (result.kind) {
    case "assigned":
      return ephemeralMessage(`${teamMention(result.team)} のロールを付けました`);
    case "already":
      return ephemeralMessage(`すでに ${teamMention(result.team)} のロールを持っています`);
    case "has-other":
      return ephemeralMessage(
        `すでに ${mentions(result.current)} のロールを持っているため、変えられません。変えるときは、先に「今のロールを外す」を押してください`,
      );
    case "team-gone":
      return ephemeralMessage("そのチームは、登録されていません（削除されました）");
    case "failed":
      return ephemeralMessage(NEED_ADMIN_CHECK);
  }
};

/** 「今のロールを外す」: 持っているチームのロールを外す */
export const roleRemove: CommandHandler = async ({ interaction, db, rest }) => {
  const guildId = interaction.guild_id;
  const member = interaction.member;
  if (!guildId || !member) return ephemeralMessage("サーバー内で実行してください");

  const result = await removeTeamRole({ db, rest }, { guildId, userId: member.user.id, memberRoleIds: member.roles });
  switch (result.kind) {
    case "removed":
      return ephemeralMessage(`${mentions(result.teams)} のロールを外しました`);
    case "none":
      return ephemeralMessage("チームのロールを持っていません");
    case "failed":
      return ephemeralMessage(NEED_ADMIN_CHECK);
  }
};

/** 「ロールを確認」: 持っているチームのロールを、本人にだけ見せる */
export const roleCheck: CommandHandler = async ({ interaction, db }) => {
  const guildId = interaction.guild_id;
  const member = interaction.member;
  if (!guildId || !member) return ephemeralMessage("サーバー内で実行してください");

  const teams = await currentTeams(db, guildId, member.roles);
  if (teams.length === 0) return ephemeralMessage("チームのロールを持っていません。自分のチームのボタンを押してください");
  if (teams.length > 1) return ephemeralMessage(`複数のチームのロールを持っています（${mentions(teams)}）。「今のロールを外す」で外してから、選び直してください`);
  return ephemeralMessage(`いまのチームは、${mentions(teams)} です`);
};
