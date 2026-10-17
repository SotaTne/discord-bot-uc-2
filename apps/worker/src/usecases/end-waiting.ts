import { findMatchSlot, getGuildSettings, stopWaiting, type Db } from "@uc/db";
import type { DiscordRest } from "@uc/discord";
import { closeWaitingMessages } from "./close-waiting-messages";

/**
 * 継続募集を、終わらせる（待機を外し、募集のメッセージを削除し、案内のボタンを外す）。
 * 管理者が、ダッシュボードから、組分けを変えたとき（追加・やり直し）に呼ぶ。チームが「対戦する」を押したときと、試合開始のときは、
 * それぞれの処理が、同じ `closeWaitingMessages` を呼んでいる。
 *
 * 待機の状態も、メッセージの ID も、残っていなければ、何もしない。投稿先のチャンネルが、設定されていなければ、DB の状態だけ、外す。
 * Discord の失敗は、呼び出し元の操作（組分けの追加など）を、失敗させない（ID を残すので、試合開始の定期実行が、やり直す）。
 */
export async function endContinuedRecruit(
  deps: { db: Db; rest: Pick<DiscordRest, "editMessage" | "deleteMessage"> },
  input: { guildId: string; slotDate: string; slotHour: number; offerContent: string },
): Promise<void> {
  const slot = await findMatchSlot(deps.db, input);
  if (!slot) return;
  if (slot.waitingSince === null && !slot.waitingMessageId && !slot.waitingAnnounceMessageId) return;

  if (slot.waitingSince !== null) await stopWaiting(deps.db, slot.id);

  const { channelId } = await getGuildSettings(deps.db, input.guildId);
  if (!channelId) return;
  await closeWaitingMessages(deps, { slot, channelId, offerContent: input.offerContent });
}
