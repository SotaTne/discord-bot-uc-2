import { and, asc, eq } from "drizzle-orm";
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
