import { beforeEach, describe, expect, it } from "vitest";
import {
  createHandup,
  createTeam,
  deleteGuildActivity,
  ensureMatchSlot,
  findMatchSlot,
  MatchSlotMatchedError,
  insertWin,
  listHandupsForSlot,
  listMatchSlots,
  listMatchedSlots,
  listWins,
  markMatchSlotMatched,
  saveMatchResult,
  withdrawHandup,
  withdrawHandupById,
} from "./index";
import { createTestDb } from "./testing";

const GUILD = "100";
const DATE = "2026-10-07";
const slot = { guildId: GUILD, slotDate: DATE, slotHour: 21 };

let db: ReturnType<typeof createTestDb>;
let kmu: number;
let ut: number;

beforeEach(async () => {
  db = createTestDb();
  kmu = await createTeam(db, { guildId: GUILD, roleId: "r1", createdAt: 1 });
  ut = await createTeam(db, { guildId: GUILD, roleId: "r2", createdAt: 1 });
});

describe("対戦枠（fixtures）", () => {
  it("なければ、未マッチング（open）で作る。同じ日・対戦枠なら、同じものを返す", async () => {
    const first = await ensureMatchSlot(db, { ...slot, createdAt: 10 });
    const second = await ensureMatchSlot(db, { ...slot, createdAt: 99 });

    expect(first).toMatchObject({ status: "open", matchedAt: null, createdAt: 10 });
    expect(second.id).toBe(first.id);
    expect(await findMatchSlot(db, { ...slot, slotHour: 22 })).toBeUndefined();
  });

  it("マッチング済みにすると、時刻が入る。やり直しても、最初の時刻のまま", async () => {
    const fixture = await ensureMatchSlot(db, { ...slot, createdAt: 10 });

    await markMatchSlotMatched(db, { id: fixture.id, matchedAt: 100 });
    await markMatchSlotMatched(db, { id: fixture.id, matchedAt: 200 });

    expect(await findMatchSlot(db, slot)).toMatchObject({ status: "matched", matchedAt: 100 });
  });

  it("日付で絞って、時刻順に返す", async () => {
    await ensureMatchSlot(db, { ...slot, slotHour: 22, createdAt: 1 });
    await ensureMatchSlot(db, { ...slot, createdAt: 1 });
    await ensureMatchSlot(db, { ...slot, slotDate: "2026-10-08", createdAt: 1 });

    expect((await listMatchSlots(db, { guildId: GUILD, slotDate: DATE })).map((f) => f.slotHour)).toEqual([21, 22]);
    expect(await listMatchSlots(db, { guildId: GUILD })).toHaveLength(3);
  });
});

describe("マッチング済みの対戦枠は、挙手を受け付けない（時刻には、関係しない）", () => {
  const raise = (teamId: number) => createHandup(db, { ...slot, teamId, raisedBy: "u", createdAt: 1 });

  it("挙手すると、対戦枠が作られて、紐づく。ほかの対戦枠・日には、影響しない", async () => {
    await raise(kmu);

    expect(await findMatchSlot(db, slot)).toMatchObject({ status: "open" });
    expect(await listHandupsForSlot(db, slot)).toMatchObject([{ teamId: kmu, slotDate: DATE, slotHour: 21 }]);
  });

  it("処理済みの対戦枠には、挙手できない。別の対戦枠・別の日には、できる", async () => {
    await raise(kmu);
    const fixture = (await findMatchSlot(db, slot))!;
    await markMatchSlotMatched(db, { id: fixture.id, matchedAt: 100 });

    await expect(raise(ut)).rejects.toBeInstanceOf(MatchSlotMatchedError);
    await expect(createHandup(db, { ...slot, slotHour: 22, teamId: ut, raisedBy: "u", createdAt: 1 })).resolves.toBeTypeOf("number");
    await expect(createHandup(db, { ...slot, slotDate: "2026-10-08", teamId: ut, raisedBy: "u", createdAt: 1 })).resolves.toBeTypeOf("number");
  });

  it("処理済みの対戦枠の挙手は、取り消せない（結果が変わってしまうので）", async () => {
    const id = await raise(kmu);
    await markMatchSlotMatched(db, { id: (await findMatchSlot(db, slot))!.id, matchedAt: 100 });

    expect(await withdrawHandup(db, { ...slot, teamId: kmu })).toBe("matched");
    expect(await withdrawHandupById(db, { guildId: GUILD, id })).toBe("matched");
    expect(await listHandupsForSlot(db, slot)).toHaveLength(1);
  });
});

describe("組分けと勝利は、対戦枠・試合に紐づく", () => {
  const save = (over: { slotHour?: number; pairs?: [number, number][] } = {}) =>
    saveMatchResult(db, { ...slot, slotHour: 21, excludedTeamId: null, pairs: [], now: 10, ...over });

  it("マッチング結果を保存すると、対戦枠が処理済みになり、挙手を受け付けなくなる", async () => {
    await createHandup(db, { ...slot, teamId: kmu, raisedBy: "u", createdAt: 1 });

    await save({ pairs: [[kmu, ut]] });

    expect(await findMatchSlot(db, slot)).toMatchObject({ status: "matched", matchedAt: 10 });
    await expect(createHandup(db, { ...slot, teamId: ut, raisedBy: "u", createdAt: 11 })).rejects.toBeInstanceOf(MatchSlotMatchedError);
  });

  it("勝利は、試合に紐づく。日付と時刻は、その試合の対戦枠から取れる", async () => {
    await save({ pairs: [[kmu, ut]] });
    await save({ slotHour: 22, pairs: [[ut, kmu]] });
    const [first, second] = await listMatchedSlots(db, { guildId: GUILD });
    await insertWin(db, { guildId: GUILD, matchId: first!.pairs[0]!.matchId, teamId: kmu, points: 80, screenshotKey: null, recordedBy: "a", createdAt: 2 });
    await insertWin(db, { guildId: GUILD, matchId: second!.pairs[0]!.matchId, teamId: kmu, points: 50, screenshotKey: null, recordedBy: "a", createdAt: 3 });

    const events = await listWins(db, GUILD);

    expect(events.map((e) => [e.slotDate, e.slotHour, e.matchId])).toEqual([
      [DATE, 21, first!.pairs[0]!.matchId],
      [DATE, 22, second!.pairs[0]!.matchId],
    ]);
  });

  it("存在しない試合には、勝利を追加できない", async () => {
    await expect(
      insertWin(db, { guildId: GUILD, matchId: 999, teamId: kmu, points: 1, screenshotKey: null, recordedBy: "a", createdAt: 1 }),
    ).rejects.toThrow();
  });

  it("活動の記録を消すと、対戦枠も試合も消える", async () => {
    await createHandup(db, { ...slot, teamId: kmu, raisedBy: "u", createdAt: 1 });
    await save({ pairs: [[kmu, ut]] });
    const matchId = (await listMatchedSlots(db, { guildId: GUILD }))[0]!.pairs[0]!.matchId;
    await insertWin(db, { guildId: GUILD, matchId, teamId: kmu, points: 80, screenshotKey: null, recordedBy: "a", createdAt: 2 });

    await deleteGuildActivity(db, GUILD);

    expect(await listMatchSlots(db, { guildId: GUILD })).toEqual([]);
    expect(await listMatchedSlots(db, { guildId: GUILD })).toEqual([]);
    expect(await listWins(db, GUILD)).toEqual([]);
  });
});
