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
 * 奇数で組まれなかったチームへの案内（1 つのメッセージを、状態に合わせて、編集し続ける）。
 * 本文は、いつも同じ。「待機する」のボタンも、いつも表示する。
 * 待機中のときだけ、その下に、「対戦する」「待機をキャンセル」を出す（キャンセルすると、消える）。
 */
export function waitingMessage(input: { hour: number; excluded: Team; slotDate: string; waiting: boolean }) {
  const mention = teamMention(input.excluded);
  const rows: ActionRow[] = [
    ...row({ type: 2, style: 3, label: "待機する", custom_id: waitingCustomId("wait", input.slotDate, input.hour) }),
    ...(input.waiting
      ? row(
          { type: 2, style: 1, label: "対戦する", custom_id: waitingCustomId("join", input.slotDate, input.hour) },
          { type: 2, style: 2, label: "待機をキャンセル", custom_id: waitingCustomId("wait-cancel", input.slotDate, input.hour) },
        )
      : []),
  ];
  return {
    content: [
      `${mention} 挙手が奇数だったため、${input.hour}時は組まれませんでした。`,
      `待機すると、${input.hour}:00 まで、${mention} と対戦したいチームを募集します。待機しなければ、この対戦枠は、このまま終わります。`,
    ].join("\n"),
    components: rows,
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
