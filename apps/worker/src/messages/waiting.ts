import type { ActionRow } from "@uc/discord";
import type { Team } from "@uc/db";
import { teamMention } from "./mention";

/** 継続募集のボタンの custom_id。「操作名:日付:時」。DB を引くための情報は、これだけで足りる */
export type WaitingAction = "wait" | "wait-cancel" | "join";

export const waitingCustomId = (action: WaitingAction, slotDate: string, slotHour: number) => `${action}:${slotDate}:${slotHour}`;

/** custom_id から、対戦枠の日付と時刻を取り出す。形が違えば null */
export function parseWaitingCustomId(customId: string): { action: WaitingAction; slotDate: string; slotHour: number } | null {
  const [action, slotDate, hour] = customId.split(":");
  if (action !== "wait" && action !== "wait-cancel" && action !== "join") return null;
  if (!slotDate || !/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) return null;
  const slotHour = Number(hour);
  if (!Number.isInteger(slotHour) || slotHour < 0 || slotHour > 23) return null;
  return { action, slotDate, slotHour };
}

const row = (...buttons: ActionRow["components"]): ActionRow[] => [{ type: 1, components: buttons }];

/**
 * 奇数で組まれなかったチームへの案内。本文は、いつも同じ。「待機する」のボタンだけが、いつも表示される。
 * 待機中は、「対戦する」「待機をキャンセル」を、別の、募集のメッセージ（`waitingAnnounce`）に出す。
 */
export function waitingMessage(input: { hour: number; excluded: Team; slotDate: string }) {
  const mention = teamMention(input.excluded);
  return {
    content: [
      `${mention} 挙手が奇数だったため、${input.hour}時は組まれませんでした。`,
      `待機すると、${input.hour}:00 まで、${mention} と対戦したいチームを募集します。待機しなければ、この対戦枠は、このまま終わります。`,
    ].join("\n"),
    components: row({ type: 2, style: 3, label: "待機する", custom_id: waitingCustomId("wait", input.slotDate, input.hour) }),
  };
}

/**
 * 募集のメッセージ（待機が始まったとき、同じ対戦枠で、最初の 1 回だけ投稿し、あとは、編集する）。
 * 待機中は、「対戦する」「待機をキャンセル」を出す。キャンセルすると、ボタンが消え、待機し直すと、戻る。
 * mentionText は、投稿のときだけ、先頭に付ける（編集では、通知されない）。
 */
export function waitingAnnounce(input: { hour: number; excluded: Team; slotDate: string; waiting: boolean; mentionText?: string }) {
  const mention = teamMention(input.excluded);
  const body = input.waiting
    ? [`# ${input.hour}時の対戦相手を募集しています（${mention} が待機中）`, `${input.hour}:00 までに、「対戦する」を押してください（先着 1 チーム）。`]
    : [`# ${input.hour}時の対戦相手の募集は、取り消されました（${mention} が待機をキャンセル）`, "待機し直すと、また募集します。"];
  return {
    content: [...(input.mentionText ? [input.mentionText] : []), ...body].join("\n"),
    components: input.waiting
      ? row(
          { type: 2, style: 1, label: "対戦する", custom_id: waitingCustomId("join", input.slotDate, input.hour) },
          { type: 2, style: 2, label: "待機をキャンセル", custom_id: waitingCustomId("wait-cancel", input.slotDate, input.hour) },
        )
      : [],
  };
}

/** 対戦相手が決まったときの、案内の本文（ボタンなし） */
export const waitingJoinedMessage = (input: { hour: number; excluded: Team; joined: Team }) =>
  `${input.hour}時: ${teamMention(input.excluded)} と ${teamMention(input.joined)} の対戦が決まりました。`;
