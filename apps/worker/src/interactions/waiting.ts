import { slotStart } from "@uc/core";
import { findMatchSlot, listTeams, type MatchSlot, type Team } from "@uc/db";
import { ephemeralMessage, type InteractionResponse } from "@uc/discord";
import { parseWaitingCustomId, waitingJoinedMessage } from "../messages/waiting";
import { cancelWaiting, joinWaiting, startWaitingByTeam } from "../usecases/continued-recruit";
import { resolveCaller } from "./caller";
import type { CommandContext, CommandHandler } from "./registry";

/**
 * 継続募集のボタン（待機する・待機をキャンセル・対戦する）。Discord の入口。
 * ここでやるのは、「誰が、どの対戦枠のボタンを押したか」の確認と、usecase（`usecases/continued-recruit.ts`）の呼び出しと、
 * 結果を、本人にだけ見える返信の形に直すことだけ。状態の変更と、メッセージの投稿・削除は、usecase が持つ。
 * 押された時点の状態を、毎回、DB から確かめる（古いボタンが押されても、安全）。
 */

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

const deps = (context: CommandContext) => ({ db: context.db, rest: context.rest, now: context.clock.now() });

/** 「待機する」: 組まれなかったチームだけが押せる */
export const wait: CommandHandler = async (context) => {
  const resolved = await resolveTarget(context, "wait");
  if (!resolved.ok) return resolved.response;
  const { slot, slotDate, slotHour, team, excluded, guildId } = resolved.target;

  const result = await startWaitingByTeam(deps(context), { guildId, slot, slotDate, slotHour, team, excluded });
  switch (result) {
    case "not-excluded":
      return ephemeralMessage("待機できるのは、組まれなかったチームだけです");
    case "already-waiting":
      return ephemeralMessage("すでに待機中です");
    case "started":
      // 押した人にだけ見える返信（案内のメッセージは、そのまま。「待機する」のボタンも、残る）
      return ephemeralMessage(
        `待機を始めました。${slotHour}:00 までに、ほかのチームが、募集のメッセージの「対戦する」を押すと、対戦が決まります（先着 1 チーム）。`,
      );
  }
};

/** 「待機をキャンセル」: 待機しているチームだけが押せる */
export const waitCancel: CommandHandler = async (context) => {
  const resolved = await resolveTarget(context, "wait-cancel");
  if (!resolved.ok) return resolved.response;
  const { slot, slotDate, slotHour, team, guildId } = resolved.target;

  const result = await cancelWaiting(deps(context), { guildId, slot, slotDate, slotHour, byTeamId: team.id });
  switch (result) {
    case "not-excluded":
      return ephemeralMessage("待機をキャンセルできるのは、待機しているチームだけです");
    case "not-waiting":
      return ephemeralMessage("待機していません（すでに、対戦相手が決まったか、取り消されています）");
    case "cancelled":
      // 押されたメッセージ（募集のメッセージ）は、削除したので、編集ではなく、押した人にだけ見える返信を返す
      return ephemeralMessage(`待機をキャンセルしました（${slotHour}時）。${slotHour}:00 までは、案内の「待機する」から、待機し直せます。`);
  }
};

/** 「対戦する」: 待機しているチーム以外の、組まれていないチームが押せる。先着 1 チームだけが、組分けになる */
export const join: CommandHandler = async (context) => {
  const resolved = await resolveTarget(context, "join");
  if (!resolved.ok) return resolved.response;
  const { slot, slotDate, slotHour, team, excluded, userId, guildId } = resolved.target;

  const result = await joinWaiting(deps(context), { guildId, slot, slotDate, slotHour, team, excluded, userId });
  switch (result) {
    case "not-waiting":
      return ephemeralMessage("待機しているチームがいません（待機が取り消されたか、終わっています）");
    case "self":
      return ephemeralMessage("待機しているのは、自チームです");
    case "already-matched":
      return ephemeralMessage(`${slotHour}時は、すでに組まれています`);
    case "taken":
      return ephemeralMessage("すでに、ほかのチームが対戦を決めています");
    case "joined":
      // 押されたメッセージ（募集のメッセージ）は、削除したので、編集ではなく、押した人にだけ見える返信を返す。
      // 全員には、結果の投稿（マッチング結果）が、見える
      return ephemeralMessage(waitingJoinedMessage({ hour: slotHour, excluded, joined: team }));
  }
};
