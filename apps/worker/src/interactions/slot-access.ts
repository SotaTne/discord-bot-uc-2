import { handupPhase, jstDateOf, seasonAccess, seasonClosedMessage } from "@uc/core";
import { findMatchSlot, findSlotHour, getGuildSettings, type Db } from "@uc/db";

/**
 * 挙手・取り消しができる対戦枠かを確かめる。
 * 試合時刻が登録されていて、今日のその対戦枠がマッチング済みでなく、受付時間内（募集開始〜試合開始の K 分前）であること。
 * 処理済みかどうかは、時刻ではなく、対戦枠の状態で決める（時計を戻しても、処理済みの対戦枠は開かない）。
 * できないときは、ユーザーに見せるメッセージを返す。
 */
export async function checkAcceptingSlot(
  db: Db,
  input: { guildId: string; hour: number; now: Date },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const settings = await getGuildSettings(db, input.guildId);
  const today = jstDateOf(input.now);
  const season = { start: settings.seasonStart, end: settings.seasonEnd };
  // 今日が開催日でないときは、受付時間より先に断る（挙手も、取り消しもしない）
  if (seasonAccess(today, today, season) !== "play") {
    return { ok: false, message: seasonClosedMessage(season) };
  }

  if (!(await findSlotHour(db, input.guildId, input.hour))) {
    return { ok: false, message: `${input.hour}時の試合時刻は登録されていません` };
  }

  const matchSlot = await findMatchSlot(db, { guildId: input.guildId, slotDate: jstDateOf(input.now), slotHour: input.hour });
  if (matchSlot?.status === "matched") {
    return { ok: false, message: `${input.hour}時の試合は、すでにマッチングが済んでいます` };
  }

  const phase = handupPhase(input.now, input.hour, settings);
  if (phase === "before-open") {
    return { ok: false, message: `受付は${settings.recruitHour}時からです` };
  }
  if (phase === "closed") {
    return { ok: false, message: `受付は終了しました（試合開始の${settings.cutoffMinutes}分前までです）` };
  }
  return { ok: true };
}
