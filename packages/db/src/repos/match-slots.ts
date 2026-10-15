import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "../client";
import { matchSlots } from "../schema";

export type MatchSlot = typeof matchSlots.$inferSelect;
export type MatchSlotKey = { guildId: string; slotDate: string; slotHour: number };

/** マッチング済み（挙手を受け付けない）の対戦枠に、挙手などをしようとしたとき */
export class MatchSlotMatchedError extends Error {
  constructor() {
    super("この対戦枠は、すでにマッチングが済んでいます");
    this.name = "MatchSlotMatchedError";
  }
}

const sameSlot = (key: MatchSlotKey) =>
  and(eq(matchSlots.guildId, key.guildId), eq(matchSlots.slotDate, key.slotDate), eq(matchSlots.slotHour, key.slotHour));

export async function findMatchSlot(db: Db, key: MatchSlotKey): Promise<MatchSlot | undefined> {
  const [row] = await db.select().from(matchSlots).where(sameSlot(key)).limit(1);
  return row;
}

/**
 * 日付 × 試合時刻の対戦枠を返す。なければ、未マッチング（open）で作る。
 * 同時に作られても、UNIQUE 制約で1件になる。
 */
export async function ensureMatchSlot(db: Db, input: MatchSlotKey & { createdAt: number }): Promise<MatchSlot> {
  await db
    .insert(matchSlots)
    .values({ guildId: input.guildId, slotDate: input.slotDate, slotHour: input.slotHour, createdAt: input.createdAt })
    .onConflictDoNothing();
  const row = await findMatchSlot(db, input);
  if (!row) throw new Error("対戦枠の作成に失敗しました");
  return row;
}

/**
 * 対戦枠を、マッチング済みにする（挙手を受け付けなくなる）。
 * すでに処理済みなら何もしない（やり直しても、処理した時刻は変わらない）。
 */
export async function markMatchSlotMatched(db: Db, input: { id: number; matchedAt: number }): Promise<void> {
  await db
    .update(matchSlots)
    .set({ status: "matched", matchedAt: input.matchedAt })
    .where(and(eq(matchSlots.id, input.id), eq(matchSlots.status, "open")));
}

/**
 * 継続募集を始める（「待機する」が押された）。組まれなかったチームがいる、マッチング済みの対戦枠だけ。
 * すでに待機中なら、何もしない（false）。始められたら true。
 */
export async function startWaiting(db: Db, input: { id: number; since: number }): Promise<boolean> {
  const updated = await db
    .update(matchSlots)
    .set({ waitingSince: input.since })
    .where(
      and(
        eq(matchSlots.id, input.id),
        eq(matchSlots.status, "matched"),
        isNotNull(matchSlots.excludedTeamId),
        isNull(matchSlots.waitingSince),
      ),
    )
    .returning({ id: matchSlots.id });
  return updated.length > 0;
}

/** 継続募集をやめる（待機のキャンセル、または、対戦相手が決まった）。待機中でなければ、何もしない（false） */
export async function stopWaiting(db: Db, id: number): Promise<boolean> {
  const updated = await db
    .update(matchSlots)
    .set({ waitingSince: null })
    .where(and(eq(matchSlots.id, id), isNotNull(matchSlots.waitingSince)))
    .returning({ id: matchSlots.id });
  return updated.length > 0;
}

/** 継続募集の案内を投稿した、メッセージの ID を保存する */
export async function setWaitingMessage(db: Db, input: { id: number; messageId: string }): Promise<void> {
  await db.update(matchSlots).set({ waitingMessageId: input.messageId }).where(eq(matchSlots.id, input.id));
}

/**
 * 継続募集のメッセージ（案内・募集）の ID を、空にする（メッセージを、削除・編集して、終わりにしたあと）。
 * 空にすれば、あとの定期実行は、もう、そのメッセージを探さない。
 */
export async function clearWaitingMessages(db: Db, input: { id: number; offer?: boolean; announce?: boolean }): Promise<void> {
  const set: { waitingMessageId?: null; waitingAnnounceMessageId?: null } = {};
  if (input.offer) set.waitingMessageId = null;
  if (input.announce) set.waitingAnnounceMessageId = null;
  if (Object.keys(set).length > 0) await db.update(matchSlots).set(set).where(eq(matchSlots.id, input.id));
}

/** 継続募集のメッセージ（案内・募集）が、まだ残っている対戦枠。終わりにする（削除・ボタンを外す）対象を探すのに使う */
export function listSlotsWithWaitingMessages(db: Db, guildId: string): Promise<MatchSlot[]> {
  return db
    .select()
    .from(matchSlots)
    .where(and(eq(matchSlots.guildId, guildId), or(isNotNull(matchSlots.waitingMessageId), isNotNull(matchSlots.waitingAnnounceMessageId))))
    .orderBy(asc(matchSlots.slotDate), asc(matchSlots.slotHour));
}

/** 継続募集の、募集のメッセージの ID を保存する */
export async function setWaitingAnnounceMessage(db: Db, input: { id: number; messageId: string }): Promise<void> {
  await db.update(matchSlots).set({ waitingAnnounceMessageId: input.messageId }).where(eq(matchSlots.id, input.id));
}

/** 対戦枠の一覧。slotDate を指定するとその日だけ。日付・時刻の順 */
export function listMatchSlots(db: Db, input: { guildId: string; slotDate?: string }): Promise<MatchSlot[]> {
  return db
    .select()
    .from(matchSlots)
    .where(
      input.slotDate === undefined
        ? eq(matchSlots.guildId, input.guildId)
        : and(eq(matchSlots.guildId, input.guildId), eq(matchSlots.slotDate, input.slotDate)),
    )
    .orderBy(asc(matchSlots.slotDate), asc(matchSlots.slotHour));
}
