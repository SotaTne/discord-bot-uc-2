import type { Team } from "@uc/db";
import type { DiscordRest } from "@uc/discord";

/**
 * チームの表示名。チームは Discord のロールだけで決まるので、名前は、ロールの名前を Discord から取る。
 * Discord から取れないとき、またはロールが消されたときは、ロールの ID で代わりに表す。
 */
export async function teamNames(
  rest: Pick<DiscordRest, "getGuildRoles">,
  guildId: string,
  teams: Team[],
): Promise<Map<number, string>> {
  let roleNames = new Map<string, string>();
  try {
    roleNames = new Map((await rest.getGuildRoles(guildId)).map((role) => [role.id, role.name]));
  } catch (error) {
    console.error("ロール名の取得に失敗しました", error);
  }
  return new Map(teams.map((team) => [team.id, roleNames.get(team.roleId) ?? `ロール ${team.roleId}`]));
}
