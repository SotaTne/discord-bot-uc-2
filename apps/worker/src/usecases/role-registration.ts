import { findTeamsByRoleIds, getGuildSettings, getRoleMessageIds, listTeams, setRoleMessageIds, type Db, type Team } from "@uc/db";
import { DiscordApiError, type DiscordRest } from "@uc/discord";
import { roleRegistrationMessages } from "../messages/roles";
import { teamNames } from "./team-names";

/**
 * ロール登録（メンバーが、自分でチームのロールを付ける・外す）と、そのメッセージ（永続）の更新。
 * 入口（Discord のボタン・スラッシュコマンド・ダッシュボードの API）は、これらを呼ぶだけ。
 */
export type RoleDeps = {
  db: Db;
  rest: Pick<DiscordRest, "createMessage" | "editMessage" | "deleteMessage" | "getGuildRoles" | "addGuildMemberRole" | "removeGuildMemberRole">;
};

/**
 * ロール登録のメッセージを、いまのチームの一覧に合わせる。
 * チームは 20 ごとにメッセージを分ける。保存してある ID は、同じ順で編集する。
 * 消されていた（404）ときや、まだないときは、新しく投稿する。チームが減って余ったメッセージは、削除する
 * （削除が 404 以外で失敗したら、ID を残して、次の更新でやり直す）。
 * 投稿先のチャンネルが設定されていなければ、何もしない（no-channel）。
 * 既存のメッセージを 1 つでも編集できたら updated。全部を新しく投稿したときは posted。
 */
export async function syncRoleMessage(deps: RoleDeps, guildId: string): Promise<"no-channel" | "updated" | "posted"> {
  const { db, rest } = deps;
  const { roleChannelId } = await getGuildSettings(db, guildId);
  if (!roleChannelId) return "no-channel";

  const teams = await listTeams(db, guildId);
  const names = await teamNames(rest, guildId, teams);
  const pages = roleRegistrationMessages({ teams: teams.map((team) => ({ id: team.id, name: names.get(team.id) ?? team.roleId })) });
  // 投稿の途中で失敗しても、すでに作った ID は残す（次の更新で、同じメッセージを二重に投稿しない）
  const ids = [...(await getRoleMessageIds(db, guildId))];
  let edited = false;
  for (let i = 0; i < pages.length; i++) {
    const payload = { ...pages[i]!, allowed_mentions: { parse: [] as string[] } };
    const existing = ids[i];
    if (existing) {
      try {
        await rest.editMessage(roleChannelId, existing, payload);
        edited = true;
        continue;
      } catch (error) {
        // メッセージが消されている（投稿先を変えた場合も、同じ）: 新しく投稿する。それ以外の失敗は、そのまま伝える
        if (!(error instanceof DiscordApiError && error.status === 404)) throw error;
      }
    }
    const created = await rest.createMessage(roleChannelId, payload);
    ids[i] = created.id;
    await setRoleMessageIds(db, guildId, ids);
  }

  // チームが減って余ったメッセージ。404 は、すでにない。ほかの失敗は、ID を残して、次に消す
  const retained: string[] = [];
  for (const extra of ids.slice(pages.length)) {
    try {
      await rest.deleteMessage(roleChannelId, extra);
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) continue;
      console.error("ロール登録の余ったメッセージを削除できませんでした", error);
      retained.push(extra);
    }
  }
  await setRoleMessageIds(db, guildId, [...ids.slice(0, pages.length), ...retained]);
  return edited ? "updated" : "posted";
}

/** ロールを変えられなかった（Bot の権限・ロールの位置・Discord の障害）。ログに残して、本人には、運営に伝えるよう返す */
const logFailure = (error: unknown) => console.error("チームのロールの付け外しに失敗しました", error);

export type AssignResult =
  | { kind: "assigned"; team: Team }
  | { kind: "already"; team: Team }
  | { kind: "has-other"; current: Team[] }
  | { kind: "team-gone" }
  | { kind: "failed" };

/**
 * 「チームのボタン」: そのチームのロールを付ける。すでに、チームのロールを持っている人は、変えない
 * （同じチームなら already、ほかのチームなら has-other）。
 */
export async function assignTeamRole(
  deps: RoleDeps,
  input: { guildId: string; userId: string; memberRoleIds: string[]; teamId: number },
): Promise<AssignResult> {
  const { db, rest } = deps;
  const { guildId, userId, memberRoleIds, teamId } = input;

  const team = (await listTeams(db, guildId)).find((candidate) => candidate.id === teamId);
  if (!team) return { kind: "team-gone" };

  const current = await findTeamsByRoleIds(db, guildId, memberRoleIds);
  if (current.some((held) => held.id === team.id)) return { kind: "already", team };
  if (current.length > 0) return { kind: "has-other", current };

  try {
    await rest.addGuildMemberRole(guildId, userId, team.roleId);
  } catch (error) {
    logFailure(error);
    return { kind: "failed" };
  }
  return { kind: "assigned", team };
}

export type RemoveResult = { kind: "removed"; teams: Team[] } | { kind: "none" } | { kind: "failed" };

/** 「今のロールを外す」: 持っているチームのロールを、すべて外す（チームのロールだけ。ほかのロールは、そのまま） */
export async function removeTeamRole(
  deps: RoleDeps,
  input: { guildId: string; userId: string; memberRoleIds: string[] },
): Promise<RemoveResult> {
  const { db, rest } = deps;
  const current = await findTeamsByRoleIds(db, input.guildId, input.memberRoleIds);
  if (current.length === 0) return { kind: "none" };

  try {
    for (const team of current) await rest.removeGuildMemberRole(input.guildId, input.userId, team.roleId);
  } catch (error) {
    logFailure(error);
    return { kind: "failed" };
  }
  return { kind: "removed", teams: current };
}

/** 「ロールを確認」: 持っているチームのロール（登録されているチームのものだけ） */
export const currentTeams = (db: Db, guildId: string, memberRoleIds: string[]) => findTeamsByRoleIds(db, guildId, memberRoleIds);
