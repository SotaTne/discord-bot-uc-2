import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { slotHours } from "../schema";

export type SlotHour = typeof slotHours.$inferSelect;

/** 既定は、削除していない試合時刻だけ。includeDeleted を付けると、削除済みも含める */
type SlotHourLookup = { includeDeleted?: boolean };
const live = (lookup: SlotHourLookup | undefined) => (lookup?.includeDeleted ? undefined : isNull(slotHours.deletedAt));

/** 試合時刻を追加する。削除済みの同じ時刻があれば、新しく作らず、元に戻す（その日までの記録は、そのまま使える） */
export async function createSlotHour(
  db: Db,
  input: { guildId: string; hour: number; createdAt: number },
): Promise<number> {
  const [deleted] = await db
    .select({ id: slotHours.id })
    .from(slotHours)
    .where(and(eq(slotHours.guildId, input.guildId), eq(slotHours.hour, input.hour), isNotNull(slotHours.deletedAt)))
    .limit(1);
  if (deleted) {
    await db.update(slotHours).set({ deletedAt: null }).where(eq(slotHours.id, deleted.id));
    return deleted.id;
  }
  const [row] = await db.insert(slotHours).values(input).returning({ id: slotHours.id });
  if (!row) throw new Error("試合時刻の作成に失敗しました");
  return row.id;
}

/** 開始時刻の早い順 */
export function listSlotHours(db: Db, guildId: string, lookup?: SlotHourLookup): Promise<SlotHour[]> {
  return db
    .select()
    .from(slotHours)
    .where(and(eq(slotHours.guildId, guildId), live(lookup)))
    .orderBy(asc(slotHours.hour));
}

export async function findSlotHour(db: Db, guildId: string, hour: number, lookup?: SlotHourLookup): Promise<SlotHour | undefined> {
  const [row] = await db
    .select()
    .from(slotHours)
    .where(and(eq(slotHours.guildId, guildId), eq(slotHours.hour, hour), live(lookup)))
    .limit(1);
  return row;
}

/** 試合時刻を削除する（論理削除。その日までの対戦枠と記録は、残る） */
export async function deleteSlotHour(db: Db, guildId: string, id: number, now: number): Promise<boolean> {
  const rows = await db
    .update(slotHours)
    .set({ deletedAt: now })
    .where(and(eq(slotHours.guildId, guildId), eq(slotHours.id, id), isNull(slotHours.deletedAt)))
    .returning({ id: slotHours.id });
  return rows.length > 0;
}
