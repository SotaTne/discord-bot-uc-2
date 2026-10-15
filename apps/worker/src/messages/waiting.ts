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

/** 奇数で組まれなかったチームへの案内（「待機する」のボタンつき） */
export function waitingOfferMessage(input: { hour: number; excluded: Team; slotDate: string }) {
  return {
    content: [
      `${teamMention(input.excluded)} 挙手が奇数だったため、${input.hour}時は組まれませんでした。`,
      `待機すると、${input.hour}:00 まで、対戦したいチームを募集します。待機しなければ、この対戦枠は、このまま終わります。`,
    ].join("\n"),
    components: row({ type: 2, style: 3, label: "待機する", custom_id: waitingCustomId("wait", input.slotDate, input.hour) }),
  };
}

/** 待機が始まったときの、案内の本文（「対戦する」「待機をキャンセル」のボタンつき） */
export function waitingStartedMessage(input: { hour: number; excluded: Team; slotDate: string }) {
  return {
    content: [
      `${teamMention(input.excluded)} が待機中です（${input.hour}時）。`,
      `対戦したいチームは、${input.hour}:00 までに「対戦する」を押してください（先着 1 チーム）。`,
    ].join("\n"),
    components: row(
      { type: 2, style: 1, label: "対戦する", custom_id: waitingCustomId("join", input.slotDate, input.hour) },
      { type: 2, style: 2, label: "待機をキャンセル", custom_id: waitingCustomId("wait-cancel", input.slotDate, input.hour) },
    ),
  };
}

/**
 * 待機が取り消されたときの、案内の本文。最初の案内（「待機する」ボタンつき）に戻す。
 * 試合の開始までは、何度でも、待機し直せるように、ボタンを残す。
 */
export function waitingCancelledMessage(input: { hour: number; excluded: Team; slotDate: string }) {
  const offer = waitingOfferMessage(input);
  return {
    content: [`${teamMention(input.excluded)} の待機は取り消されました（${input.hour}時）。`, offer.content].join("\n"),
    components: offer.components,
  };
}

/** 対戦相手が決まったときの、案内の本文（ボタンなし） */
export const waitingJoinedMessage = (input: { hour: number; excluded: Team; joined: Team }) =>
  `${input.hour}時: ${teamMention(input.excluded)} と ${teamMention(input.joined)} の対戦が決まりました。`;

/** 待機が始まったことを、募集開始と同じ通知先に知らせる投稿の本文 */
export const waitingAnnounceMessage = (input: { hour: number; excluded: Team; mentionText: string }) =>
  [input.mentionText, `# ${input.hour}時の対戦相手を募集しています（${teamMention(input.excluded)} が待機中）`, `${input.hour}:00 までに、先ほどの案内の「対戦する」を押してください（先着 1 チーム）。`]
    .filter((line) => line !== "")
    .join("\n");
