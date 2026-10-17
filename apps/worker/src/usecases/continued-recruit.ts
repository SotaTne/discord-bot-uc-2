import {
  addMatch,
  claimJob,
  ensureHandup,
  getGuildSettings,
  listGuildMatches,
  listMatchesOnDate,
  listTeams,
  releaseJob,
  setWaitingAnnounceMessage,
  startWaiting,
  stopWaiting,
  type Db,
  type MatchSlot,
  type Team,
} from "@uc/db";
import { hostTeamOf, isContinuedRecruit, matchNumberKey, matchNumbers } from "@uc/core";
import type { DiscordRest } from "@uc/discord";
import { postMatchingResult, postWaitingAnnounce, recruitMention } from "../messages";
import { waitingJoinedMessage } from "../messages/waiting";
import { closeWaitingMessages, deleteWaitingAnnounce } from "./close-waiting-messages";

/**
 * 継続募集（奇数で組まれなかったチームが待機して、試合開始まで、別のチームを 1 チームだけ募集する）の、意図。
 * 入口（Discord のボタン・ダッシュボードの API）は、これらを呼んで、結果を、それぞれの返事の形に直すだけ。
 * 状態の変更と、あとの片付け（メッセージの投稿・削除）は、ここが持つ。入口ごとに、片付けを書き直さない。
 *
 * 結果は、文字（"started" など）で返す。入口が、メッセージを決める。
 * Discord の失敗は、操作そのものを失敗させない（メッセージの ID を残し、試合開始の定期実行が、やり直す）。
 */
export type ContinuedRecruitDeps = {
  db: Db;
  rest: Pick<DiscordRest, "createMessage" | "editMessage" | "deleteMessage">;
  now: Date;
};

type SlotRef = { guildId: string; slot: MatchSlot; slotDate: string; slotHour: number };

export type StartWaitingResult = "started" | "not-excluded" | "already-waiting";
export type CancelWaitingResult = "cancelled" | "not-excluded" | "not-waiting";
export type JoinWaitingResult = "joined" | "not-waiting" | "self" | "already-matched" | "taken";

/**
 * 「待機する」: 組まれなかったチームが、継続募集を始める。
 * 募集のメッセージを、新しいメッセージとして、案内への返信で投稿する。通知先への通知は、同じ対戦枠の最初の 1 回だけ。
 */
export async function startWaitingByTeam(
  deps: ContinuedRecruitDeps,
  input: SlotRef & { team: Team; excluded: Team },
): Promise<StartWaitingResult> {
  const { db, rest, now } = deps;
  const { guildId, slot, slotDate, slotHour, excluded } = input;

  if (input.team.id !== excluded.id) return "not-excluded";
  if (!(await startWaiting(db, { id: slot.id, since: now.getTime() }))) return "already-waiting";

  const settings = await getGuildSettings(db, guildId);
  if (!settings.channelId) return "started";

  // 前の募集のメッセージが、削除できずに残っていれば、先に削除する（古い募集が、残らない）
  await deleteWaitingAnnounce({ db, rest }, { slot, channelId: settings.channelId });

  const noticeKey = `wait-notice:${slotDate}:${slotHour}`;
  const notify = await claimJob(db, guildId, noticeKey, now.getTime());
  try {
    const teams = notify && settings.recruitMentionMode === "teams" ? await listTeams(db, guildId) : [];
    const messageId = await postWaitingAnnounce(rest, {
      channelId: settings.channelId,
      slotDate,
      hour: slotHour,
      excluded,
      replyToMessageId: slot.waitingMessageId,
      ...(notify ? { mention: recruitMention(settings, teams) } : {}),
    });
    await setWaitingAnnounceMessage(db, { id: slot.id, messageId });
  } catch (error) {
    // 失敗しても、待機は、そのまま。通知の権利は、返す（次の待機で、もう一度、試す）
    if (notify) await releaseJob(db, guildId, noticeKey);
    console.error("募集のメッセージの投稿に失敗しました", error);
  }
  return "started";
}

/**
 * 「待機をキャンセル」: 待機を外し、募集のメッセージを削除する（案内の「待機する」は、残る。待機し直せる）。
 * byTeamId を渡すと、そのチームが、待機しているチームのときだけ、できる（チームの操作）。渡さなければ、管理者の操作。
 */
export async function cancelWaiting(deps: ContinuedRecruitDeps, input: SlotRef & { byTeamId?: number }): Promise<CancelWaitingResult> {
  const { db, rest, now } = deps;
  const { guildId, slot, slotDate, slotHour } = input;

  if (input.byTeamId !== undefined && input.byTeamId !== slot.excludedTeamId) return "not-excluded";
  if (!isContinuedRecruit({ ...slot, slotDate, slotHour }, now)) return "not-waiting";
  if (!(await stopWaiting(db, slot.id))) return "not-waiting";

  const { channelId } = await getGuildSettings(db, guildId);
  if (channelId) await deleteWaitingAnnounce({ db, rest }, { slot, channelId });
  return "cancelled";
}

/**
 * 「対戦する」: 待機しているチーム以外の、まだ組まれていないチームが、待機しているチームと組分けになる。先着 1 チームだけ。
 * 結果を、通常のマッチング結果と同じ形（何試合目か・主催つき）で投稿し、継続募集のメッセージを終わりにする。
 */
export async function joinWaiting(
  deps: ContinuedRecruitDeps,
  input: SlotRef & { team: Team; excluded: Team; userId: string },
): Promise<JoinWaitingResult> {
  const { db, rest, now } = deps;
  const { guildId, slot, slotDate, slotHour, team, excluded, userId } = input;

  if (!isContinuedRecruit({ ...slot, slotDate, slotHour }, now)) return "not-waiting";
  if (team.id === excluded.id) return "self";

  const inSlot = (await listMatchesOnDate(db, { guildId, slotDate })).filter((match) => match.slotHour === slotHour);
  if (inSlot.some((match) => match.teamAId === team.id || match.teamBId === team.id)) return "already-matched";

  // 先着 1 チームだけを通す（ジョブの「実行する権利」の仕組みを使う）
  const key = `join:${slotDate}:${slotHour}`;
  if (!(await claimJob(db, guildId, key, now.getTime()))) return "taken";

  const settings = await getGuildSettings(db, guildId);
  try {
    const matchId = await addMatch(db, { guildId, slotDate, slotHour, teamAId: excluded.id, teamBId: team.id, createdAt: now.getTime() });
    // 待機をやめる（addMatch が、組まれなかったチームの印も、外す）
    await stopWaiting(db, slot.id);
    await ensureHandup(db, { guildId, slotDate, slotHour, teamId: team.id, raisedBy: userId, createdAt: now.getTime() });

    if (settings.channelId) {
      try {
        const teams = await listTeams(db, guildId, { includeDeleted: true });
        const guildMatches = await listGuildMatches(db, guildId);
        const created = guildMatches.find((match) => match.id === matchId);
        const numbers = matchNumbers(guildMatches);
        await postMatchingResult(rest, {
          channelId: settings.channelId,
          hour: slotHour,
          result: { kind: "matched", pairs: [[excluded.id, team.id]], excluded: null },
          hostOf: () => created?.hostTeamId ?? hostTeamOf({ slotDate, slotHour, teamAId: excluded.id, teamBId: team.id }),
          numberOf: (teamId) => numbers.get(matchNumberKey(teamId, matchId)),
          matchLimit: settings.matchLimit,
          teams,
        });
      } catch (error) {
        console.error("対戦の決定の投稿に失敗しました", error);
      }
    }
  } catch (error) {
    // 組分けを作れなかったときは、権利を返す（ほかのチームが、押し直せる）
    await releaseJob(db, guildId, key);
    throw error;
  }

  // 継続募集のメッセージを、終わりにする（募集は削除、案内は、ボタンを外す）。失敗しても、対戦は、決まっている
  if (settings.channelId) {
    await closeWaitingMessages(
      { db, rest },
      { slot, channelId: settings.channelId, offerContent: waitingJoinedMessage({ hour: slotHour, excluded, joined: team }) },
    );
  }
  return "joined";
}
