import { hostTeamOf, isContinuedRecruit, matchNumberKey, matchNumbers, slotStart } from "@uc/core";
import {
  addMatch,
  claimJob,
  ensureHandup,
  findMatchSlot,
  getGuildSettings,
  listGuildMatches,
  listMatchesOnDate,
  listTeams,
  releaseJob,
  setWaitingAnnounceMessage,
  startWaiting,
  stopWaiting,
  type MatchSlot,
  type Team,
} from "@uc/db";
import { ephemeralMessage, type InteractionResponse } from "@uc/discord";
import { postMatchingResult, postWaitingAnnounce, recruitMention } from "../messages";
import { parseWaitingCustomId, waitingJoinedMessage } from "../messages/waiting";
import { closeWaitingMessages, deleteWaitingAnnounce } from "../usecases/close-waiting-messages";
import { resolveCaller } from "./caller";
import type { CommandContext, CommandHandler } from "./registry";

/** 継続募集のボタン（待機する・待機をキャンセル・対戦する）の処理。押された時点の状態を、毎回、DB から確かめる */

type Target = { slot: MatchSlot; slotDate: string; slotHour: number; team: Team; excluded: Team; userId: string; guildId: string };

type Resolved = { ok: true; target: Target } | { ok: false; response: InteractionResponse };

const fail = (message: string): Resolved => ({ ok: false, response: ephemeralMessage(message) });

/** ボタンから、対戦枠・押した人のチーム・待機しているチームを決める（共通の確認） */
async function resolveTarget(context: CommandContext, expected: "wait" | "wait-cancel" | "join"): Promise<Resolved> {
  const parsed = parseWaitingCustomId(context.interaction.data?.custom_id ?? "");
  if (!parsed || parsed.action !== expected) return fail("この操作は無効です");

  const resolved = await resolveCaller(context.interaction, context.db, {
    noTeamMessage: "チームに所属していないため、操作できません",
    action: "操作",
  });
  if (!resolved.ok) return fail(resolved.message);
  const { guildId, userId, team } = resolved.caller;

  const now = context.clock.now();
  if (now.getTime() >= slotStart(parsed.slotDate, parsed.slotHour).getTime()) {
    return fail(`${parsed.slotHour}時の試合は、もう始まっています`);
  }

  const slot = await findMatchSlot(context.db, { guildId, slotDate: parsed.slotDate, slotHour: parsed.slotHour });
  if (!slot || slot.status !== "matched" || slot.excludedTeamId === null) {
    return fail(`${parsed.slotHour}時は、いま、対戦相手を募集していません`);
  }
  const teams = await listTeams(context.db, guildId, { includeDeleted: true });
  const excluded = teams.find((candidate) => candidate.id === slot.excludedTeamId);
  if (!excluded) return fail("待機しているチームが見つかりません");

  return { ok: true, target: { slot, slotDate: parsed.slotDate, slotHour: parsed.slotHour, team, excluded, userId, guildId } };
}

/** 「待機する」: 組まれなかったチームだけが押せる。押すと、継続募集が始まる（00 分まで、先着 1 チーム） */
export const wait: CommandHandler = async (context) => {
  const resolved = await resolveTarget(context, "wait");
  if (!resolved.ok) return resolved.response;
  const { slot, slotDate, slotHour, team, excluded, guildId } = resolved.target;

  if (team.id !== excluded.id) return ephemeralMessage("待機できるのは、組まれなかったチームだけです");
  if (!(await startWaiting(context.db, { id: slot.id, since: context.clock.now().getTime() }))) {
    return ephemeralMessage("すでに待機中です");
  }

  // 募集のメッセージ（「対戦する」「待機をキャンセル」つき）を、新しいメッセージとして投稿する（上に戻らなくても、押せるように）。
  // 案内のメッセージへの返信にする。通知先への通知は、同じ対戦枠の最初の 1 回だけ（待機し直すたびに、通知を重ねない）。
  // 失敗しても、待機は、そのまま（通知の権利は、返す。次の待機で、もう一度、試す）
  const settings = await getGuildSettings(context.db, guildId);
  if (settings.channelId) {
    // 前の募集のメッセージが、削除できずに残っていれば、先に削除する（古い募集が、残らない）
    await deleteWaitingAnnounce({ db: context.db, rest: context.rest }, { slot, channelId: settings.channelId });
    const noticeKey = `wait-notice:${slotDate}:${slotHour}`;
    const notify = await claimJob(context.db, guildId, noticeKey, context.clock.now().getTime());
    try {
      const teams = notify && settings.recruitMentionMode === "teams" ? await listTeams(context.db, guildId) : [];
      const messageId = await postWaitingAnnounce(context.rest, {
        channelId: settings.channelId,
        slotDate,
        hour: slotHour,
        excluded,
        replyToMessageId: slot.waitingMessageId,
        ...(notify ? { mention: recruitMention(settings, teams) } : {}),
      });
      await setWaitingAnnounceMessage(context.db, { id: slot.id, messageId });
    } catch (error) {
      if (notify) await releaseJob(context.db, guildId, noticeKey);
      console.error("募集のメッセージの投稿に失敗しました", error);
    }
  }

  // 押した人にだけ見える返信（案内のメッセージは、そのまま。「待機する」のボタンも、残る）
  return ephemeralMessage(
    `待機を始めました。${slotHour}:00 までに、ほかのチームが、募集のメッセージの「対戦する」を押すと、対戦が決まります（先着 1 チーム）。`,
  );
};

/** 「待機をキャンセル」: 待機しているチームだけが押せる */
export const waitCancel: CommandHandler = async (context) => {
  const resolved = await resolveTarget(context, "wait-cancel");
  if (!resolved.ok) return resolved.response;
  const { slot, slotHour, team, excluded, guildId } = resolved.target;

  if (team.id !== excluded.id) return ephemeralMessage("待機をキャンセルできるのは、待機しているチームだけです");
  if (!(await stopWaiting(context.db, slot.id))) return ephemeralMessage("待機していません（すでに、対戦相手が決まったか、取り消されています）");

  // 募集のメッセージ（このボタンがあるメッセージ）を、削除する（古い募集が、残らない）。案内の「待機する」は、そのまま残る（待機し直せる）。
  // 押されたメッセージを削除したので、編集ではなく、押した人にだけ見える返信を返す
  const settings = await getGuildSettings(context.db, guildId);
  if (settings.channelId) {
    await deleteWaitingAnnounce({ db: context.db, rest: context.rest }, { slot, channelId: settings.channelId });
  }
  return ephemeralMessage(`待機をキャンセルしました（${slotHour}時）。${slotHour}:00 までは、案内の「待機する」から、待機し直せます。`);
};

/** 「対戦する」: 待機しているチーム以外の、組まれていないチームが押せる。先着 1 チームだけが、組分けになる */
export const join: CommandHandler = async (context) => {
  const resolved = await resolveTarget(context, "join");
  if (!resolved.ok) return resolved.response;
  const { slot, slotDate, slotHour, team, excluded, userId, guildId } = resolved.target;

  const now = context.clock.now();
  if (!isContinuedRecruit({ ...slot, slotDate, slotHour }, now)) {
    return ephemeralMessage("待機しているチームがいません（待機が取り消されたか、終わっています）");
  }
  if (team.id === excluded.id) return ephemeralMessage("待機しているのは、自チームです");

  const inSlot = (await listMatchesOnDate(context.db, { guildId, slotDate })).filter((match) => match.slotHour === slotHour);
  if (inSlot.some((match) => match.teamAId === team.id || match.teamBId === team.id)) {
    return ephemeralMessage(`${slotHour}時は、すでに組まれています`);
  }

  // 先着 1 チームだけを通す（すでにある、ジョブの「実行する権利」の仕組みを使う）
  const key = `join:${slotDate}:${slotHour}`;
  if (!(await claimJob(context.db, guildId, key, now.getTime()))) {
    return ephemeralMessage("すでに、ほかのチームが対戦を決めています");
  }

  try {
    const matchId = await addMatch(context.db, {
      guildId,
      slotDate,
      slotHour,
      teamAId: excluded.id,
      teamBId: team.id,
      createdAt: now.getTime(),
    });
    // 待機をやめる（addMatch が、組まれなかったチームの印も、外す）
    await stopWaiting(context.db, slot.id);
    await ensureHandup(context.db, { guildId, slotDate, slotHour, teamId: team.id, raisedBy: userId, createdAt: now.getTime() });

    // 結果を、通常のマッチング結果と同じ形で投稿する（何試合目か・主催つき）
    const settings = await getGuildSettings(context.db, guildId);
    if (settings.channelId) {
      try {
        const teams = await listTeams(context.db, guildId, { includeDeleted: true });
        const created = (await listGuildMatches(context.db, guildId)).find((match) => match.id === matchId);
        const numbers = matchNumbers(await listGuildMatches(context.db, guildId));
        await postMatchingResult(context.rest, {
          channelId: settings.channelId,
          hour: slotHour,
          result: { kind: "matched", pairs: [[excluded.id, team.id]], excluded: null },
          hostOf: () =>
            created?.hostTeamId ?? hostTeamOf({ slotDate, slotHour, teamAId: excluded.id, teamBId: team.id }),
          numberOf: (teamId) => numbers.get(matchNumberKey(teamId, matchId)),
          teams,
        });
      } catch (error) {
        console.error("対戦の決定の投稿に失敗しました", error);
      }
    }
  } catch (error) {
    // 組分けを作れなかったときは、権利を返す（ほかのチームが、押し直せる）
    await releaseJob(context.db, guildId, key);
    throw error;
  }

  // フック: 「対戦が決まったら」、継続募集のメッセージを、終わりにする（募集のメッセージは削除、案内は、ボタンを外す）。
  // 失敗しても、対戦は、決まっている（ID が残るので、00 分の定期実行が、やり直す）
  const ended = waitingJoinedMessage({ hour: slotHour, excluded, joined: team });
  const settings = await getGuildSettings(context.db, guildId);
  if (settings.channelId) {
    await closeWaitingMessages(
      { db: context.db, rest: context.rest },
      { slot, channelId: settings.channelId, offerContent: ended },
    );
  }

  // 押されたメッセージ（募集のメッセージ）は、いま削除したので、編集ではなく、押した人にだけ見える返信を返す。
  // 全員には、結果の投稿（マッチング結果）が、見える
  return ephemeralMessage(ended);
};
