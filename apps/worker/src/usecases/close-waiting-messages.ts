import { clearWaitingMessages, type Db, type MatchSlot } from "@uc/db";
import { DiscordApiError, type DiscordRest } from "@uc/discord";

/**
 * 継続募集のメッセージを、終わりにする。
 * - 募集のメッセージ（「対戦する」「待機をキャンセル」）: 削除する（チャンネルに、積み重ならない）
 * - 案内のメッセージ（「待機する」）: 本文を書き換えて、ボタンを外す（案内そのものは、残る）
 *
 * 「対戦が決まったとき」と「試合開始の時刻になったとき」の、2 つのフックが、同じ処理を呼ぶ。
 * すでにメッセージがない（404）ときは、終わっているものとして扱う。そのほかの失敗は、ID を残して、次の定期実行で、やり直す。
 */
export async function closeWaitingMessages(
  deps: { db: Db; rest: Pick<DiscordRest, "editMessage" | "deleteMessage"> },
  input: { slot: Pick<MatchSlot, "id" | "waitingMessageId" | "waitingAnnounceMessageId">; channelId: string; offerContent: string },
): Promise<void> {
  const { db, rest } = deps;
  const { slot, channelId } = input;
  const finished = { offer: false, announce: false };

  /** 失敗の扱い: 404（すでにない）は、終わり。そのほかは、ID を残す */
  const attempt = async (run: () => Promise<unknown>, label: string): Promise<boolean> => {
    try {
      await run();
      return true;
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) return true;
      console.error(`${label}に失敗しました`, error);
      return false;
    }
  };

  if (slot.waitingAnnounceMessageId) {
    const id = slot.waitingAnnounceMessageId;
    finished.announce = await attempt(() => rest.deleteMessage(channelId, id), "募集のメッセージの削除");
  }
  if (slot.waitingMessageId) {
    const id = slot.waitingMessageId;
    finished.offer = await attempt(
      () => rest.editMessage(channelId, id, { content: input.offerContent, components: [] }),
      "案内のメッセージの編集",
    );
  }

  await clearWaitingMessages(db, { id: slot.id, offer: finished.offer, announce: finished.announce });
}
