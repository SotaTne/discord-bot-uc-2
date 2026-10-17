import { cutoffJobKey, slotPhase } from "@uc/core";
import {
  addMatch,
  ensureHandup,
  findMatchSlot,
  getGuildSettings,
  listMatchesOnDate,
  listTeams,
  releaseJob,
  reopenMatchSlot,
  type Db,
} from "@uc/db";
import type { DiscordRest } from "@uc/discord";
import { postMatchingCancelled } from "../messages";
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

const logCleanupFailure = (error: unknown) => console.error("継続募集の終了に失敗しました", error);

/**
 * 組分けを追加する。2 チームの挙手は、自動で付く（すでにあれば、そのまま）。追加した組分けの ID を返す。
 * 同じ対戦枠で、すでに別の組分けに入っているチームがいれば、MatchTeamTakenError を投げる。
 * 待機中のチームが、組まれたなら、継続募集を終わらせる（待機していないチーム同士を組んでも、継続募集は、続く）。
 */
export async function addMatchByAdmin(
  deps: AdminMatchDeps,
  input: { guildId: string; userId: string; slotDate: string; slotHour: number; teamAId: number; teamBId: number },
): Promise<number> {
  const { db, rest, now } = deps;
  const { guildId, userId, slotDate, slotHour, teamAId, teamBId } = input;

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
  return id;
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
