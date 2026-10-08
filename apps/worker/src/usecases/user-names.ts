import { memberDisplayName, type DiscordRest } from "@uc/discord";

/** 1回で取りに行く人数の上限（Discord への問い合わせを、増やしすぎない） */
const MAX_LOOKUPS = 25;

/**
 * Discord での表示名（ニックネーム → 表示名 → ユーザー名）を、ユーザー ID から引く。
 * 取れなかった人（サーバーを抜けた人、上限を超えた人など）は、結果に含めない。呼び出し側は、ID で代わりに表す（nameOrId）。
 */
export async function userNames(
  rest: Pick<DiscordRest, "getGuildMember">,
  guildId: string,
  userIds: Iterable<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set([...userIds].filter((id): id is string => typeof id === "string" && id !== ""))].slice(0, MAX_LOOKUPS);
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        return [id, memberDisplayName(await rest.getGuildMember(guildId, id))] as const;
      } catch {
        return null;
      }
    }),
  );
  return new Map(entries.flatMap((entry) => (entry ? [entry] : [])));
}

/** 表示名。取れなかったときは、ID のまま */
export const nameOrId = (names: Map<string, string>, id: string | null): string | null => (id === null ? null : (names.get(id) ?? id));
