import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { slots } from "../schema";

export type Slot = typeof slots.$inferSelect;

/** 既定は、削除していない試合時刻だけ。includeDeleted を付けると、削除済みも含める */
type SlotLookup = { includeDeleted?: boolean };
const live = (lookup: SlotLookup | undefined) => (lookup?.includeDeleted ? undefined : isNull(slots.deletedAt));

/** 試合時刻を追加する。削除済みの同じ時刻があれば、新しく作らず、元に戻す（その日までの記録は、そのまま使える） */
export async function createSlot(
  db: Db,
  input: { guildId: string; hour: number; createdAt: number },
): Promise<number> {
  const [deleted] = await db
    .select({ id: slots.id })
    .from(slots)
    .where(and(eq(slots.guildId, input.guildId), eq(slots.hour, input.hour), isNotNull(slots.deletedAt)))
    .limit(1);
  if (deleted) {
    await db.update(slots).set({ deletedAt: null }).where(eq(slots.id, deleted.id));
    return deleted.id;
  }
  const [row] = await db.insert(slots).values(input).returning({ id: slots.id });
  if (!row) throw new Error("試合時刻の作成に失敗しました");
  return row.id;
}

/** 開始時刻の早い順 */
export function listSlots(db: Db, guildId: string, lookup?: SlotLookup): Promise<Slot[]> {
  return db
    .select()
    .from(slots)
    .where(and(eq(slots.guildId, guildId), live(lookup)))
    .orderBy(asc(slots.hour));
}

export async function findSlot(db: Db, guildId: string, hour: number, lookup?: SlotLookup): Promise<Slot | undefined> {
  const [row] = await db
    .select()
    .from(slots)
    .where(and(eq(slots.guildId, guildId), eq(slots.hour, hour), live(lookup)))
    .limit(1);
  return row;
}

/** 試合時刻を削除する（論理削除。その日までの対戦枠と記録は、残る） */
export async function deleteSlot(db: Db, guildId: string, id: number, now: number): Promise<boolean> {
  const rows = await db
    .update(slots)
    .set({ deletedAt: now })
    .where(and(eq(slots.guildId, guildId), eq(slots.id, id), isNull(slots.deletedAt)))
    .returning({ id: slots.id });
  return rows.length > 0;
}
