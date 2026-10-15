import { beforeEach, describe, expect, it } from "vitest";
import {
  MatchTeamTakenError,
  addMatch,
  createHandup,
  createTeam,
  deleteMatch,
  ensureHandup,
  findHandup,
  findMatch,
  findMatchForTeam,
  findMatchSlot,
  listHandupsForSlot,
  listMatchesOnDate,
  saveMatchResult,
} from "./index";
import { createTestDb } from "./testing";

const GUILD = "100";
const DATE = "2026-10-07";
const slot = { guildId: GUILD, slotDate: DATE, slotHour: 21 };

let db: ReturnType<typeof createTestDb>;
let a: number;
let b: number;
let c: number;
let d: number;

beforeEach(async () => {
  db = createTestDb();
  [a, b, c, d] = [
    await createTeam(db, { guildId: GUILD, roleId: "r1", createdAt: 1 }),
    await createTeam(db, { guildId: GUILD, roleId: "r2", createdAt: 1 }),
    await createTeam(db, { guildId: GUILD, roleId: "r3", createdAt: 1 }),
    await createTeam(db, { guildId: GUILD, roleId: "r4", createdAt: 1 }),
  ] as [number, number, number, number];
});

const add = (teamAId: number, teamBId: number, over: Partial<typeof slot> = {}) =>
  addMatch(db, { ...slot, ...over, teamAId, teamBId, createdAt: 10 });

describe("ensureHandup（自動挙手）", () => {
  it("なければ作る。あれば、そのまま（二重にならない）", async () => {
    const first = await ensureHandup(db, { ...slot, teamId: a, raisedBy: "admin", createdAt: 1 });
    const second = await ensureHandup(db, { ...slot, teamId: a, raisedBy: "other", createdAt: 2 });

    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await listHandupsForSlot(db, slot)).toMatchObject([{ teamId: a, raisedBy: "admin" }]);
  });

  it("マッチング済みの対戦枠にも、付けられる（通常の挙手と違って）", async () => {
    await saveMatchResult(db, { ...slot, excludedTeamId: null, pairs: [], now: 5 });
    await expect(createHandup(db, { ...slot, teamId: a, raisedBy: "u", createdAt: 6 })).rejects.toThrow();

    const result = await ensureHandup(db, { ...slot, teamId: a, raisedBy: "admin", createdAt: 7 });

    expect(result.created).toBe(true);
    expect(await findHandup(db, { ...slot, teamId: a })).toBeDefined();
  });
});

describe("addMatch（管理者による、組分けの追加）", () => {
  it("組分けを追加できる。対戦枠は、未マッチングのまま（自動のマッチングが、あとで残りを組める）", async () => {
    const id = await add(a, b);

    expect(await listMatchesOnDate(db, { guildId: GUILD, slotDate: DATE })).toEqual([{ id, slotHour: 21, teamAId: a, teamBId: b }]);
    expect(await findMatchSlot(db, slot)).toMatchObject({ status: "open" });
    expect(await findMatchForTeam(db, { ...slot, teamId: b })).toMatchObject({ matchId: id });
  });

  it("同じ対戦枠で、すでに組分けに入っているチームは、入れない。別の対戦枠・別の日なら、入れる", async () => {
    await add(a, b);

    await expect(add(a, c)).rejects.toBeInstanceOf(MatchTeamTakenError);
    await expect(add(c, b)).rejects.toBeInstanceOf(MatchTeamTakenError);
    await expect(add(a, b, { slotHour: 22 })).resolves.toBeTypeOf("number");
    await expect(add(a, b, { slotDate: "2026-10-08" })).resolves.toBeTypeOf("number");
    expect(await listMatchesOnDate(db, { guildId: GUILD, slotDate: DATE })).toHaveLength(2);
  });

  it("除外されていたチームが入ると、除外は外れる", async () => {
    await saveMatchResult(db, { ...slot, excludedTeamId: c, pairs: [[a, b]], now: 5 });

    await add(c, d);

    expect((await findMatchSlot(db, slot))?.excludedTeamId).toBeNull();
  });

  it("日付ごとに、対戦枠の時刻・追加した順に返す。ほかのサーバーは含まない", async () => {
    const late = await add(c, d, { slotHour: 22 });
    const early = await add(a, b);
    await addMatch(db, { guildId: "999", slotDate: DATE, slotHour: 21, teamAId: a, teamBId: b, createdAt: 1 }).catch(() => undefined);

    const rows = await listMatchesOnDate(db, { guildId: GUILD, slotDate: DATE });

    expect(rows.map((r) => r.id)).toEqual([early, late]);
  });

  it("ID で探せる。ほかのサーバーのものは見つからない", async () => {
    const id = await add(a, b);

    expect(await findMatch(db, { guildId: GUILD, id })).toMatchObject({ id, slotDate: DATE, slotHour: 21, teamAId: a, teamBId: b });
    expect(await findMatch(db, { guildId: "999", id })).toBeUndefined();
  });
});

describe("自動のマッチングと、管理者が追加した組分け", () => {
  it("管理者の組分けは残り、自動の分が足される。同じ2チームの組は、作り直されない", async () => {
    const manual = await add(a, b);

    await saveMatchResult(db, { ...slot, excludedTeamId: null, pairs: [[c, d], [b, a]], now: 30 });
    await saveMatchResult(db, { ...slot, excludedTeamId: null, pairs: [[c, d]], now: 31 });

    const rows = await listMatchesOnDate(db, { guildId: GUILD, slotDate: DATE });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: manual, teamAId: a, teamBId: b });
    expect(await findMatchSlot(db, slot)).toMatchObject({ status: "matched", matchedAt: 30 });
  });
});

describe("deleteMatch（組分けの削除）", () => {
  it("組分けを削除する。ほかの組分けには影響しない", async () => {
    const target = await add(a, b);
    const other = await add(c, d);

    expect(await deleteMatch(db, { guildId: GUILD, id: target })).toBe(true);

    expect((await listMatchesOnDate(db, { guildId: GUILD, slotDate: DATE })).map((m) => m.id)).toEqual([other]);
  });

  it("見つからない・ほかのサーバーのものは false。削除したあとは、同じチームで、組み直せる", async () => {
    const id = await add(a, b);

    expect(await deleteMatch(db, { guildId: "999", id })).toBe(false);
    expect(await deleteMatch(db, { guildId: GUILD, id: 9999 })).toBe(false);
    expect(await deleteMatch(db, { guildId: GUILD, id })).toBe(true);
    await expect(add(a, c)).resolves.toBeTypeOf("number");
  });
});
