import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "../client";
import { matches, matchSlots, wins } from "../schema";
import { ensureMatchSlot, findMatchSlot, markMatchSlotMatched } from "./match-slots";

/** マッチング済みの対戦枠と、組まれた試合（組分け） */
export type MatchedSlot = {
  id: number;
  guildId: string;
  slotDate: string;
  slotHour: number;
  /** 組まれなかったチーム */
  excludedTeamId: number | null;
  /** マッチングを処理した時刻 */
  matchedAt: number;
  pairs: { matchId: number; teamAId: number; teamBId: number }[];
};

/** 組分けに入れようとしたチームが、その対戦枠で、すでに別の組分けに入っているとき */
export class MatchTeamTakenError extends Error {
  constructor() {
    super("そのチームは、この対戦枠で、すでに組分けに入っています");
    this.name = "MatchTeamTakenError";
  }
}

const inSlot = (matchSlotId: number, teamId: number) =>
  and(eq(matches.matchSlotId, matchSlotId), or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)));

/**
 * マッチング結果を保存する。対戦枠をマッチング済みにして、除外チームと、組分けを保存する。
 * 組分けは、すでにある組（同じ2チーム）は、作り直さない（勝利が紐づくので、ID を変えない）。
 * 管理者が先に追加した組分けは、残る（自動のマッチングは、その分を、足すだけ）。
 * （処理済みの対戦枠は、挙手が変わらないので、やり直しても同じ結果になる）
 */
export async function saveMatchResult(
  db: Db,
  input: {
    guildId: string;
    slotDate: string;
    slotHour: number;
    excludedTeamId: number | null;
    pairs: [teamAId: number, teamBId: number][];
    now: number;
  },
): Promise<number> {
  const slot = await ensureMatchSlot(db, { ...input, createdAt: input.now });
  await markMatchSlotMatched(db, { id: slot.id, matchedAt: input.now });
  await db.update(matchSlots).set({ excludedTeamId: input.excludedTeamId }).where(eq(matchSlots.id, slot.id));

  for (const [teamAId, teamBId] of input.pairs) {
    const existing = await db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.matchSlotId, slot.id), inSlot(slot.id, teamAId), inSlot(slot.id, teamBId)))
      .limit(1);
    if (existing.length === 0) await db.insert(matches).values({ matchSlotId: slot.id, teamAId, teamBId });
  }
  return slot.id;
}

/**
 * 管理者が、組分けを追加する。対戦枠がなければ、未マッチングで作る（処理済みには、しない）。
 * どちらかのチームが、その対戦枠で、すでに別の組分けに入っていれば、MatchTeamTakenError。
 * 除外されていたチームが入れば、除外は外す。
 */
export async function addMatch(
  db: Db,
  input: { guildId: string; slotDate: string; slotHour: number; teamAId: number; teamBId: number; createdAt: number },
): Promise<number> {
  const slot = await ensureMatchSlot(db, input);
  for (const teamId of [input.teamAId, input.teamBId]) {
    const taken = await db.select({ id: matches.id }).from(matches).where(inSlot(slot.id, teamId)).limit(1);
    if (taken.length > 0) throw new MatchTeamTakenError();
  }

  const [row] = await db
    .insert(matches)
    .values({ matchSlotId: slot.id, teamAId: input.teamAId, teamBId: input.teamBId })
    .returning({ id: matches.id });
  if (!row) throw new Error("組分けの追加に失敗しました");

  if (slot.excludedTeamId === input.teamAId || slot.excludedTeamId === input.teamBId) {
    await db.update(matchSlots).set({ excludedTeamId: null }).where(eq(matchSlots.id, slot.id));
  }
  return row.id;
}

/**
 * 組分けを削除する。その組分けの勝利の記録（無効なものも）も、あわせて削除する。
 * 削除した勝利が持っていた画像の R2 キーを返す（呼び出し側が、R2 からも消す）。見つからなければ null。
 */
export async function deleteMatch(db: Db, input: { guildId: string; id: number }): Promise<{ screenshotKeys: string[] } | null> {
  const [found] = await db
    .select({ id: matches.id })
    .from(matches)
    .innerJoin(matchSlots, eq(matches.matchSlotId, matchSlots.id))
    .where(and(eq(matches.id, input.id), eq(matchSlots.guildId, input.guildId)))
    .limit(1);
  if (!found) return null;

  const removed = await db.delete(wins).where(eq(wins.matchId, input.id)).returning({ key: wins.screenshotKey });
  await db.delete(matches).where(eq(matches.id, input.id));
  return { screenshotKeys: removed.flatMap((row) => (row.key === null ? [] : [row.key])) };
}

/** その日の、すべての組分け（マッチング済みかどうかに関係なく）。対戦枠の時刻・追加した順 */
export async function listMatchesOnDate(
  db: Db,
  input: { guildId: string; slotDate: string },
): Promise<{ id: number; slotHour: number; teamAId: number; teamBId: number }[]> {
  return db
    .select({ id: matches.id, slotHour: matchSlots.slotHour, teamAId: matches.teamAId, teamBId: matches.teamBId })
    .from(matches)
    .innerJoin(matchSlots, eq(matches.matchSlotId, matchSlots.id))
    .where(and(eq(matchSlots.guildId, input.guildId), eq(matchSlots.slotDate, input.slotDate)))
    .orderBy(asc(matchSlots.slotHour), asc(matches.id));
}

/** ID で組分けを探す（そのサーバーのものだけ）。対戦枠の日付・時刻つき */
export async function findMatch(
  db: Db,
  input: { guildId: string; id: number },
): Promise<{ id: number; slotDate: string; slotHour: number; teamAId: number; teamBId: number } | undefined> {
  const [row] = await db
    .select({ id: matches.id, slotDate: matchSlots.slotDate, slotHour: matchSlots.slotHour, teamAId: matches.teamAId, teamBId: matches.teamBId })
    .from(matches)
    .innerJoin(matchSlots, eq(matches.matchSlotId, matchSlots.id))
    .where(and(eq(matches.id, input.id), eq(matchSlots.guildId, input.guildId)))
    .limit(1);
  return row;
}

/** マッチング済みの対戦枠を、組分けつきで返す。slotDate を指定するとその日だけ。日付・時刻の順 */
export async function listMatchedSlots(db: Db, input: { guildId: string; slotDate?: string }): Promise<MatchedSlot[]> {
  const where = and(
    eq(matchSlots.guildId, input.guildId),
    eq(matchSlots.status, "matched"),
    ...(input.slotDate === undefined ? [] : [eq(matchSlots.slotDate, input.slotDate)]),
  );
  const slots = await db.select().from(matchSlots).where(where).orderBy(asc(matchSlots.slotDate), asc(matchSlots.slotHour));
  if (slots.length === 0) return [];

  const rows = await db
    .select()
    .from(matches)
    .where(inArray(matches.matchSlotId, slots.map((slot) => slot.id)))
    .orderBy(asc(matches.id));

  return slots.map((slot) => ({
    id: slot.id,
    guildId: slot.guildId,
    slotDate: slot.slotDate,
    slotHour: slot.slotHour,
    excludedTeamId: slot.excludedTeamId,
    matchedAt: slot.matchedAt ?? 0,
    pairs: rows
      .filter((row) => row.matchSlotId === slot.id)
      .map((row) => ({ matchId: row.id, teamAId: row.teamAId, teamBId: row.teamBId })),
  }));
}

/** その対戦枠（日付 × 対戦枠）で、そのチームが出る試合。なければ undefined（マッチングされていない・対戦していない） */
export async function findMatchForTeam(
  db: Db,
  input: { guildId: string; slotDate: string; slotHour: number; teamId: number },
): Promise<{ matchId: number; teamAId: number; teamBId: number } | undefined> {
  const rows = await db
    .select({ matchId: matches.id, teamAId: matches.teamAId, teamBId: matches.teamBId })
    .from(matches)
    .innerJoin(matchSlots, eq(matches.matchSlotId, matchSlots.id))
    .where(
      and(
        eq(matchSlots.guildId, input.guildId),
        eq(matchSlots.slotDate, input.slotDate),
        eq(matchSlots.slotHour, input.slotHour),
      ),
    );
  return rows.find((row) => row.teamAId === input.teamId || row.teamBId === input.teamId);
}

/** サーバーの、すべての組分け（対戦枠の日付・時刻つき）。試合数と、固定点の判定（何試合目か）に使う。日付・時刻・ID の順 */
export function listGuildMatches(
  db: Db,
  guildId: string,
): Promise<{ id: number; slotDate: string; slotHour: number; teamAId: number; teamBId: number }[]> {
  return db
    .select({ id: matches.id, slotDate: matchSlots.slotDate, slotHour: matchSlots.slotHour, teamAId: matches.teamAId, teamBId: matches.teamBId })
    .from(matches)
    .innerJoin(matchSlots, eq(matches.matchSlotId, matchSlots.id))
    .where(eq(matchSlots.guildId, guildId))
    .orderBy(asc(matchSlots.slotDate), asc(matchSlots.slotHour), asc(matches.id));
}

/** チームごとの、対戦した組分けの数（サーバー全体。勝ち負けに関係なく）。組分けのないチームは、含まれない */
export async function countMatchesByTeam(db: Db, guildId: string): Promise<Map<number, number>> {
  const rows = await db
    .select({ teamAId: matches.teamAId, teamBId: matches.teamBId })
    .from(matches)
    .innerJoin(matchSlots, eq(matches.matchSlotId, matchSlots.id))
    .where(eq(matchSlots.guildId, guildId));

  const counts = new Map<number, number>();
  for (const row of rows) {
    for (const teamId of [row.teamAId, row.teamBId]) counts.set(teamId, (counts.get(teamId) ?? 0) + 1);
  }
  return counts;
}

/**
 * サーバーの、すべての組分けを削除する（試合数を 0 に戻す。得点のクリアで、勝利の記録と一緒に使う）。
 * 先に、その組分けの勝利の記録を、削除しておくこと（外部キー）。対戦枠の「組まれなかったチーム」も、外す。
 */
export async function deleteAllMatches(db: Db, guildId: string): Promise<void> {
  const slots = await db.select({ id: matchSlots.id }).from(matchSlots).where(eq(matchSlots.guildId, guildId));
  if (slots.length === 0) return;

  const slotIds = slots.map((slot) => slot.id);
  await db.delete(matches).where(inArray(matches.matchSlotId, slotIds));
  await db.update(matchSlots).set({ excludedTeamId: null }).where(inArray(matchSlots.id, slotIds));
}

/**
 * マッチング済みの対戦枠を、未マッチングに戻す（挙手は、そのまま残す）。
 * その対戦枠の組分けと、その勝利の記録（無効なものも）を、すべて削除する。除外チームも外す。
 * 削除した勝利の画像の R2 キーと、削除した件数を返す（呼び出し側が、R2 からも消す）。処理済みの対戦枠がなければ null。
 */
export async function reopenMatchSlot(
  db: Db,
  input: { guildId: string; slotDate: string; slotHour: number },
): Promise<{ screenshotKeys: string[]; deletedMatches: number; deletedWins: number } | null> {
  const slot = await findMatchSlot(db, input);
  if (!slot || slot.status !== "matched") return null;

  const matchIds = (await db.select({ id: matches.id }).from(matches).where(eq(matches.matchSlotId, slot.id))).map((row) => row.id);
  const removed =
    matchIds.length === 0 ? [] : await db.delete(wins).where(inArray(wins.matchId, matchIds)).returning({ key: wins.screenshotKey });
  await db.delete(matches).where(eq(matches.matchSlotId, slot.id));
  await db.update(matchSlots).set({ status: "open", matchedAt: null, excludedTeamId: null }).where(eq(matchSlots.id, slot.id));

  return {
    screenshotKeys: removed.flatMap((row) => (row.key === null ? [] : [row.key])),
    deletedMatches: matchIds.length,
    deletedWins: removed.length,
  };
}
