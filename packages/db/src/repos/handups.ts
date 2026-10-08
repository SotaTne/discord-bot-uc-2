import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { handups, matchSlots } from "../schema";
import { ensureMatchSlot, findMatchSlot, MatchSlotMatchedError } from "./match-slots";

/** 挙手。どの対戦枠かは、日付と時刻でも持つ（対戦枠との結合で取る） */
export type Handup = {
  id: number;
  guildId: string;
  matchSlotId: number;
  slotDate: string;
  slotHour: number;
  teamId: number;
  raisedBy: string;
  createdAt: number;
};

type SlotKey = { guildId: string; slotDate: string; slotHour: number; teamId: number };

const columns = {
  id: handups.id,
  guildId: handups.guildId,
  matchSlotId: handups.matchSlotId,
  slotDate: matchSlots.slotDate,
  slotHour: matchSlots.slotHour,
  teamId: handups.teamId,
  raisedBy: handups.raisedBy,
  createdAt: handups.createdAt,
};

const selectHandups = (db: Db) => db.select(columns).from(handups).innerJoin(matchSlots, eq(handups.matchSlotId, matchSlots.id));

/**
 * 挙手を作る。対戦枠がなければ、未マッチングで作る。
 * - 対戦枠がマッチング処理済みなら、MatchSlotMatchedError（時刻に関係なく、受け付けない）
 * - 同じ対戦枠・チームに、挙手がすでにあると、UNIQUE 制約で失敗する（isUniqueViolation で判定できる）
 */
export async function createHandup(
  db: Db,
  input: SlotKey & { raisedBy: string; createdAt: number },
): Promise<number> {
  const slot = await ensureMatchSlot(db, input);
  if (slot.status !== "open") throw new MatchSlotMatchedError();

  const [row] = await db
    .insert(handups)
    .values({
      guildId: input.guildId,
      matchSlotId: slot.id,
      teamId: input.teamId,
      raisedBy: input.raisedBy,
      createdAt: input.createdAt,
    })
    .returning({ id: handups.id });
  if (!row) throw new Error("挙手の作成に失敗しました");
  return row.id;
}

/**
 * 挙手を付ける（なければ作る。あれば、そのまま）。管理者が組分けを追加したときの「自動挙手」に使う。
 * 通常の挙手（createHandup）と違って、対戦枠がマッチング処理済みでも、付けられる。
 */
export async function ensureHandup(
  db: Db,
  input: SlotKey & { raisedBy: string; createdAt: number },
): Promise<{ id: number; created: boolean }> {
  const found = await findHandup(db, input);
  if (found) return { id: found.id, created: false };

  const slot = await ensureMatchSlot(db, input);
  const [row] = await db
    .insert(handups)
    .values({ guildId: input.guildId, matchSlotId: slot.id, teamId: input.teamId, raisedBy: input.raisedBy, createdAt: input.createdAt })
    .onConflictDoNothing()
    .returning({ id: handups.id });
  if (row) return { id: row.id, created: true };

  // 同時に作られたとき
  const again = await findHandup(db, input);
  if (!again) throw new Error("挙手の作成に失敗しました");
  return { id: again.id, created: false };
}

/** 挙手 */
export async function findHandup(db: Db, key: SlotKey): Promise<Handup | undefined> {
  const [row] = await selectHandups(db)
    .where(
      and(
        eq(matchSlots.guildId, key.guildId),
        eq(matchSlots.slotDate, key.slotDate),
        eq(matchSlots.slotHour, key.slotHour),
        eq(handups.teamId, key.teamId),
      ),
    )
    .limit(1);
  return row;
}

/** 取り消しの結果。matched は、対戦枠がマッチング処理済みで、取り消せなかった */
export type WithdrawResult = "withdrawn" | "not_found" | "matched";

/** 挙手を取り消す（行を削除する。取り消した履歴は、残さない）。対戦枠がマッチング処理済みなら、取り消せない */
export async function withdrawHandup(db: Db, key: SlotKey): Promise<WithdrawResult> {
  const found = await findHandup(db, key);
  if (!found) return "not_found";
  return withdrawHandupById(db, { guildId: key.guildId, id: found.id });
}

/** あるチームのその日の挙手を、挙手した順に返す */
export function listTeamHandupsOnDate(
  db: Db,
  input: { guildId: string; slotDate: string; teamId: number },
): Promise<Handup[]> {
  return selectHandups(db)
    .where(and(eq(matchSlots.guildId, input.guildId), eq(matchSlots.slotDate, input.slotDate), eq(handups.teamId, input.teamId)))
    .orderBy(asc(handups.createdAt), asc(handups.id));
}

/** その対戦枠の挙手を、挙手した順に返す（マッチングの入力） */
export function listHandupsForSlot(
  db: Db,
  input: { guildId: string; slotDate: string; slotHour: number },
): Promise<Handup[]> {
  return selectHandups(db)
    .where(
      and(
        eq(matchSlots.guildId, input.guildId),
        eq(matchSlots.slotDate, input.slotDate),
        eq(matchSlots.slotHour, input.slotHour),
      ),
    )
    .orderBy(asc(handups.createdAt), asc(handups.id));
}

/** その日の、全チームの挙手。管理者向け */
export function listHandupsOnDate(db: Db, input: { guildId: string; slotDate: string }): Promise<Handup[]> {
  return selectHandups(db)
    .where(and(eq(matchSlots.guildId, input.guildId), eq(matchSlots.slotDate, input.slotDate)))
    .orderBy(asc(matchSlots.slotHour), asc(handups.createdAt), asc(handups.id));
}

/** ID で挙手を取り消す（管理者による代理の取り消し。行を削除する）。対戦枠がマッチング処理済みなら、取り消せない */
export async function withdrawHandupById(db: Db, input: { guildId: string; id: number }): Promise<WithdrawResult> {
  const [row] = await selectHandups(db)
    .where(and(eq(handups.guildId, input.guildId), eq(handups.id, input.id)))
    .limit(1);
  if (!row) return "not_found";

  const slot = await findMatchSlot(db, row);
  if (slot?.status === "matched") return "matched";

  const rows = await db.delete(handups).where(eq(handups.id, input.id)).returning({ id: handups.id });
  return rows.length > 0 ? "withdrawn" : "not_found";
}
