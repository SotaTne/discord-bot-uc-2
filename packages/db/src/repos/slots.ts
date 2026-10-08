import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { slots } from "../schema";

export type Slot = typeof slots.$inferSelect;

export async function createSlot(
  db: Db,
  input: { guildId: string; hour: number; createdAt: number },
): Promise<number> {
  const [row] = await db.insert(slots).values(input).returning({ id: slots.id });
  if (!row) throw new Error("試合時刻の作成に失敗しました");
  return row.id;
}

/** 開始時刻の早い順 */
export function listSlots(db: Db, guildId: string): Promise<Slot[]> {
  return db.select().from(slots).where(eq(slots.guildId, guildId)).orderBy(asc(slots.hour));
}

export async function findSlot(db: Db, guildId: string, hour: number): Promise<Slot | undefined> {
  const [row] = await db
    .select()
    .from(slots)
    .where(and(eq(slots.guildId, guildId), eq(slots.hour, hour)))
    .limit(1);
  return row;
}

export async function deleteSlot(db: Db, guildId: string, id: number): Promise<boolean> {
  const rows = await db
    .delete(slots)
    .where(and(eq(slots.guildId, guildId), eq(slots.id, id)))
    .returning({ id: slots.id });
  return rows.length > 0;
}
