import { deleteAllMatches, deleteAllWins, type Db } from "@uc/db";

/** R2 の delete は、1回に 1000 件まで */
const R2_DELETE_LIMIT = 1000;

/** 画像を R2 から消す。失敗しても、呼び出し側の処理は、取り消さない（ログに残す） */
export async function deleteScreenshots(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let start = 0; start < keys.length; start += R2_DELETE_LIMIT) {
    await bucket.delete(keys.slice(start, start + R2_DELETE_LIMIT)).catch((error) => {
      console.error("画像の削除に失敗しました", error);
    });
  }
}

/**
 * 得点のクリア（コマンドとダッシュボードで共通）: すべての勝利の記録と、組分け（試合数）を削除する（履歴も 0 になる）。
 * 組分けも消すのは、試合数が、固定点（N 試合を超えた試合）の判定に使われるため（残すと、クリアしても、超過が続く）。
 * 挙手と、対戦枠は、残る。
 * 記録に使った画像も、R2 から消す。画像の削除に失敗しても、記録の削除は取り消さない（ログに残す）。
 */
export async function clearScores(deps: { db: Db; bucket: R2Bucket }, guildId: string): Promise<{ screenshots: number }> {
  const keys = await deleteAllWins(deps.db, guildId);
  await deleteAllMatches(deps.db, guildId);
  await deleteScreenshots(deps.bucket, keys);
  return { screenshots: keys.length };
}
