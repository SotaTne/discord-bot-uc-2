import { cutoffJobKey, hostTeamOf, matchNumberKey, matchNumbers, slotOperations, slotPhase } from "@uc/core";
import {
  addMatch,
  clearExcludedTeam,
  deleteMatch,
  ensureHandup,
  findHandupById,
  findMatch,
  findMatchSlot,
  getGuildSettings,
  listGuildMatches,
  listMatchesOnDate,
  listTeams,
  releaseJob,
  reopenMatchSlot,
  withdrawHandupById,
  type Db,
} from "@uc/db";
import type { DiscordRest } from "@uc/discord";
import { postMatchingCancelled, postMatchingChanged } from "../messages";
import type { MatchingChange } from "../messages/matching";
import { endContinuedRecruit } from "./end-waiting";

/**
 * 管理者が、ダッシュボードから行う、組分けの変更。
 * 入口（API）は、これらを呼んで、結果を、返事の形に直すだけ。状態の変更と、あとの片付け（継続募集を終わらせる・キャンセルの投稿）は、ここが持つ。
 * 片付けの失敗は、操作そのものを失敗させない（継続募集のメッセージは、ID を残し、試合開始の定期実行が、やり直す）。
 */
export type AdminMatchDeps = {
  db: Db;
  rest: Pick<DiscordRest, "createMessage" | "editMessage" | "deleteMessage">;
  now: Date;
};

type GuildMatch = Awaited<ReturnType<typeof listGuildMatches>>[number];

/** 組分けの追加・削除の結果。notified: Discord に知らせた / notifyFailed: 知らせようとして、失敗した */
export type EditResult = { notified: boolean; notifyFailed: boolean };

/**
 * 組分けの変更を、Discord に知らせる。知らせられるのは、マッチング済みで、試合開始前だけ（`slotOperations` の canNotifyEdit）。
 * それ以外のときは、notify が true でも、知らせない（画面が、古いときの安全のため）。投稿に失敗しても、操作は、取り消さない。
 */
async function notifyChange(
  deps: AdminMatchDeps,
  input: { guildId: string; slotDate: string; slotHour: number; wasMatched: boolean; notify: boolean; change: (context: { numbers: Map<string, number>; matches: GuildMatch[] }) => MatchingChange },
): Promise<EditResult> {
  const { db, rest, now } = deps;
  const allowed = slotOperations({ now, slotDate: input.slotDate, slotHour: input.slotHour, matched: input.wasMatched }).canNotifyEdit;
  if (!input.notify || !allowed) return { notified: false, notifyFailed: false };

  const settings = await getGuildSettings(db, input.guildId);
  if (!settings.channelId) return { notified: false, notifyFailed: false };
  try {
    const teams = await listTeams(db, input.guildId, { includeDeleted: true });
    const matches = await listGuildMatches(db, input.guildId);
    await postMatchingChanged(rest, {
      channelId: settings.channelId,
      hour: input.slotHour,
      change: input.change({ numbers: matchNumbers(matches), matches }),
      matchLimit: settings.matchLimit,
      teams,
    });
    return { notified: true, notifyFailed: false };
  } catch (error) {
    console.error("組分けの変更の投稿に失敗しました", error);
    return { notified: false, notifyFailed: true };
  }
}

const logCleanupFailure = (error: unknown) => console.error("継続募集の終了に失敗しました", error);

/**
 * 組分けを追加する。2 チームの挙手は、自動で付く（すでにあれば、そのまま）。追加した組分けの ID を返す。
 * 同じ対戦枠で、すでに別の組分けに入っているチームがいれば、MatchTeamTakenError を投げる。
 * 待機中のチームが、組まれたなら、継続募集を終わらせる（待機していないチーム同士を組んでも、継続募集は、続く）。
 */
export async function addMatchByAdmin(
  deps: AdminMatchDeps,
  input: { guildId: string; userId: string; slotDate: string; slotHour: number; teamAId: number; teamBId: number; notify?: boolean },
): Promise<{ id: number } & EditResult> {
  const { db, rest, now } = deps;
  const { guildId, userId, slotDate, slotHour, teamAId, teamBId } = input;

  const wasMatched = (await findMatchSlot(db, { guildId, slotDate, slotHour }))?.status === "matched";
  const id = await addMatch(db, { guildId, slotDate, slotHour, teamAId, teamBId, createdAt: now.getTime() });
  for (const teamId of [teamAId, teamBId]) {
    await ensureHandup(db, { guildId, slotDate, slotHour, teamId, raisedBy: userId, createdAt: now.getTime() });
  }

  // 組まれなかったチームが、いなくなったなら（待機中のチームを組んだ）、継続募集を終わらせる
  const slot = await findMatchSlot(db, { guildId, slotDate, slotHour });
  if (slot && slot.excludedTeamId === null) {
    await endContinuedRecruit(
      { db, rest },
      { guildId, slotDate, slotHour, offerContent: `${slotHour}時: 管理者が組分けを決めたため、待機は終わりました。` },
    ).catch(logCleanupFailure);
  }

  // マッチング済みの対戦枠（補正）では、確認で選んだとき、変更を Discord に知らせる
  const result = await notifyChange(deps, {
    guildId,
    slotDate,
    slotHour,
    wasMatched,
    notify: input.notify ?? false,
    change: ({ numbers, matches }) => ({
      kind: "added",
      teamAId,
      teamBId,
      // 主催は、組分けを作るときに決めて保存した値
      hostId: matches.find((match) => match.id === id)?.hostTeamId ?? hostTeamOf({ slotDate, slotHour, teamAId, teamBId }),
      numberA: numbers.get(matchNumberKey(teamAId, id)),
      numberB: numbers.get(matchNumberKey(teamBId, id)),
    }),
  });
  return { id, ...result };
}

/**
 * 組分けを削除する。見つからなければ null。
 * マッチング済みの対戦枠（補正）では、確認で選んだとき、変更を Discord に知らせる（組まれなかったチームの扱いは、変えない）。
 */
export async function deleteMatchByAdmin(
  deps: AdminMatchDeps,
  input: { guildId: string; id: number; notify?: boolean },
): Promise<EditResult | null> {
  const { db } = deps;
  const found = await findMatch(db, { guildId: input.guildId, id: input.id });
  if (!found) return null;

  const wasMatched = (await findMatchSlot(db, { guildId: input.guildId, slotDate: found.slotDate, slotHour: found.slotHour }))?.status === "matched";
  if (!(await deleteMatch(db, { guildId: input.guildId, id: input.id }))) return null;

  return notifyChange(deps, {
    guildId: input.guildId,
    slotDate: found.slotDate,
    slotHour: found.slotHour,
    wasMatched,
    notify: input.notify ?? false,
    change: () => ({ kind: "removed", teamAId: found.teamAId, teamBId: found.teamBId }),
  });
}

/**
 * 管理者の代理の挙手（補正でも、運営でも）。マッチング済みの対戦枠にも、記録として付けられる（マッチングは、しない）。
 * すでに挙手していれば、already。
 */
export async function addHandupByAdmin(
  deps: Pick<AdminMatchDeps, "db" | "now">,
  input: { guildId: string; userId: string; slotDate: string; slotHour: number; teamId: number },
): Promise<{ id: number } | "already"> {
  const { id, created } = await ensureHandup(deps.db, { ...input, raisedBy: input.userId, createdAt: deps.now.getTime() });
  return created ? { id } : "already";
}

/**
 * 管理者の代理の取り消し。マッチング済みの対戦枠でも、記録として取り消せる。
 * ただし、そのチームが、その対戦枠の組分けに入っているときは、取り消せない（先に、組分けを削除する）: in_match。
 * 組まれなかったチームの挙手を取り消したときは、その印を外し、継続募集を終わらせる。
 */
export async function withdrawHandupByAdmin(
  deps: AdminMatchDeps,
  input: { guildId: string; id: number },
): Promise<"withdrawn" | "not_found" | "in_match"> {
  const { db, rest } = deps;
  const found = await findHandupById(db, input);
  if (!found) return "not_found";

  const inMatch = (await listMatchesOnDate(db, { guildId: input.guildId, slotDate: found.slotDate })).some(
    (match) => match.slotHour === found.slotHour && (match.teamAId === found.teamId || match.teamBId === found.teamId),
  );
  if (inMatch) return "in_match";

  const result = await withdrawHandupById(db, { ...input, force: true });
  if (result !== "withdrawn") return "not_found";

  const slot = await findMatchSlot(db, { guildId: input.guildId, slotDate: found.slotDate, slotHour: found.slotHour });
  if (slot && slot.excludedTeamId === found.teamId) {
    await clearExcludedTeam(db, slot.id);
    await endContinuedRecruit(
      { db, rest },
      { guildId: input.guildId, slotDate: found.slotDate, slotHour: found.slotHour, offerContent: `${found.slotHour}時: 挙手が取り消されたため、待機は終わりました。` },
    ).catch(logCleanupFailure);
  }
  return "withdrawn";
}

/**
 * マッチング済みの対戦枠を、未マッチングに戻す（組分けを削除する。挙手は残る）。
 * マッチング済みでなければ null。戻したら、継続募集を終わらせ、（締切の前なら）cron の自動の確定を戻し、
 * 投稿済みの組分けが取り消されたことを、Discord に知らせる（notify が false なら、知らせない。失敗しても、やり直しは、取り消さない）。
 */
export async function reopenSlotByAdmin(
  deps: AdminMatchDeps,
  input: { guildId: string; slotDate: string; slotHour: number; notify: boolean },
): Promise<{ deletedMatches: number; notified: boolean; notifyFailed: boolean } | null> {
  const { db, rest, now } = deps;
  const { guildId, slotDate, slotHour } = input;

  // キャンセルの投稿に使うので、消す前の、組分けと、組まれなかったチームを、控えておく
  const before = {
    slot: await findMatchSlot(db, { guildId, slotDate, slotHour }),
    matches: (await listMatchesOnDate(db, { guildId, slotDate })).filter((match) => match.slotHour === slotHour),
  };

  const reopened = await reopenMatchSlot(db, { guildId, slotDate, slotHour });
  if (!reopened) return null;

  await endContinuedRecruit(
    { db, rest },
    { guildId, slotDate, slotHour, offerContent: `${slotHour}時: マッチングがやり直されたため、待機は終わりました。` },
  ).catch(logCleanupFailure);

  // 締切の時刻の前なら、cron が、あらためて自動で確定できるように、権利を返す。過ぎていれば、管理者が確定するまで、そのまま
  const settings = await getGuildSettings(db, guildId);
  if (slotPhase(now, slotDate, slotHour, settings) !== "closed") {
    await releaseJob(db, guildId, cutoffJobKey(slotDate, slotHour));
  }

  // 投稿済みの組分けが、取り消されたことを、Discord に知らせる（組分けの個別の編集では、知らせない）
  const excludedTeamId = before.slot?.excludedTeamId ?? null;
  const announced = before.matches.length > 0 || excludedTeamId !== null;
  let notified = false;
  let notifyFailed = false;
  if (input.notify && announced && settings.channelId) {
    try {
      const teams = await listTeams(db, guildId, { includeDeleted: true });
      await postMatchingCancelled(rest, {
        channelId: settings.channelId,
        hour: slotHour,
        pairs: before.matches.map((match): [number, number] => [match.teamAId, match.teamBId]),
        excluded: excludedTeamId,
        teams,
      });
      notified = true;
    } catch (error) {
      console.error("マッチングのキャンセルの投稿に失敗しました", error);
      notifyFailed = true;
    }
  }
  return { deletedMatches: reopened.deletedMatches, notified, notifyFailed };
}
