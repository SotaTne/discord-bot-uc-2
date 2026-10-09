import { pairTeams, type MatchingResult } from "@uc/core";
import {
  ensureMatchSlot,
  listHandupsForSlot,
  listMatchesOnDate,
  listTeams,
  markMatchSlotMatched,
  saveMatchResult,
  type Db,
} from "@uc/db";
import type { DiscordRest } from "@uc/discord";
import { postMatchingResult } from "../messages";

/**
 * その対戦枠の挙手を打ち切って（マッチング済みにして）、マッチングを確定し、結果を保存して投稿する。
 * cron の締切と、管理者の手動の確定の、どちらからも使う。管理者が先に追加した組分けがあれば、そのチームは自動のマッチングから外し、組分けは残して、投稿にも含める。
 */
export async function confirmMatching(
  deps: { db: Db; rest: Pick<DiscordRest, "createMessage"> },
  input: { guildId: string; channelId: string | null; slotDate: string; slotHour: number; now: Date },
) {
  const { db } = deps;

  // まず対戦枠を「マッチング済み」にして、挙手を受け付けなくする。そのあとで、挙手を読む。
  // （投稿に失敗してやり直しても、挙手はもう変わらないので、同じ結果になる）
  const slot = await ensureMatchSlot(db, { ...input, createdAt: input.now.getTime() });
  await markMatchSlotMatched(db, { id: slot.id, matchedAt: input.now.getTime() });

  const inThisSlot = async () =>
    (await listMatchesOnDate(db, { guildId: input.guildId, slotDate: input.slotDate })).filter((m) => m.slotHour === input.slotHour);

  // すでに組分けに入っているチーム（管理者が追加した組分け）は、自動のマッチングに使わない
  const taken = new Set((await inThisSlot()).flatMap((m) => [m.teamAId, m.teamBId]));
  const remaining = (await listHandupsForSlot(db, input)).filter((h) => !taken.has(h.teamId));
  const result = pairTeams(remaining);

  const pairs: [number, number][] = result.kind === "matched" ? result.pairs.map(([a, b]) => [Number(a), Number(b)]) : [];
  const onlyRemaining = remaining.length === 1 ? remaining[0] : undefined;
  const excludedTeamId =
    result.kind === "matched" ? (result.excluded ? Number(result.excluded) : null) : (onlyRemaining?.teamId ?? null);

  // 結果（組分けと除外チーム）を保存してから投稿する。投稿に失敗してやり直しても、結果は重複しない
  await saveMatchResult(db, {
    guildId: input.guildId,
    slotDate: input.slotDate,
    slotHour: input.slotHour,
    excludedTeamId,
    pairs,
    now: input.now.getTime(),
  });

  // 投稿するのは、この対戦枠の、すべての組分け（管理者が追加した分も含む）
  const all = await inThisSlot();
  const announced: MatchingResult =
    all.length === 0
      ? { kind: "insufficient" }
      : {
          kind: "matched",
          pairs: all.map((m): [number, number] => [m.teamAId, m.teamBId]),
          excluded: excludedTeamId,
        };

  // 投稿先のチャンネルが設定されていなければ、結果の保存だけを行う
  if (input.channelId === null) return;
  const teams = await listTeams(db, input.guildId, { includeDeleted: true });
  await postMatchingResult(deps.rest, { channelId: input.channelId, hour: input.slotHour, result: announced, teams });
}

