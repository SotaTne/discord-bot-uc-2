import { beforeEach, describe, expect, it } from "vitest";
import {
  MatchTeamTakenError,
  addMatch,
  countMatchesByTeam,
  createHandup,
  createTeam,
  deleteAllMatches,
  deleteAllWins,
  deleteMatch,
  ensureHandup,
  findHandup,
  findMatch,
  findMatchForTeam,
  findMatchSlot,
  hasActiveWin,
  insertWin,
  listHandupsForSlot,
  listMatchesOnDate,
  listWins,
  saveMatchResult,
  setWinActive,
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
const win = (matchId: number, teamId: number, key: string | null = null) =>
  insertWin(db, { guildId: GUILD, matchId, teamId, points: 50, screenshotKey: key, recordedBy: "admin", createdAt: 20 });

describe("ensureHandup（自動挙手）", () => {
  it("なければ作る。あれば、そのまま（二重にならない）", async () => {
    const first = await ensureHandup(db, { ...slot, teamId: a, raisedBy: "admin", createdAt: 1 });
    const second = await ensureHandup(db, { ...slot, teamId: a, raisedBy: "other", createdAt: 2 });

    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect(await listHandupsForSlot(db, slot)).toMatchObject([{ teamId: a, raisedBy: "admin" }]);
  });

  it("マッチング処理済みの枠にも、付けられる（通常の挙手と違って）", async () => {
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

  it("同じ枠で、すでに組分けに入っているチームは、入れない。別の枠・別の日なら、入れる", async () => {
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

  it("日付ごとに、枠の時刻・追加した順に返す。ほかのサーバーは含まない", async () => {
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
  it("組分けと、その勝利の記録（無効なものも）を削除して、画像のキーを返す。ほかの組分けには影響しない", async () => {
    const target = await add(a, b);
    const other = await add(c, d);
    const first = await win(target, a, "shots/1.png");
    await win(target, b, "shots/2.png");
    await setWinActive(db, { guildId: GUILD, id: first, active: false });
    await win(other, c, "shots/other.png");

    const result = await deleteMatch(db, { guildId: GUILD, id: target });

    expect(result?.screenshotKeys.sort()).toEqual(["shots/1.png", "shots/2.png"]);
    expect((await listMatchesOnDate(db, { guildId: GUILD, slotDate: DATE })).map((m) => m.id)).toEqual([other]);
    expect((await listWins(db, GUILD)).map((w) => w.matchId)).toEqual([other]);
  });

  it("見つからない・ほかのサーバーのものは null。削除したあとは、同じチームで、組み直せる", async () => {
    const id = await add(a, b);

    expect(await deleteMatch(db, { guildId: "999", id })).toBeNull();
    expect(await deleteMatch(db, { guildId: GUILD, id: 9999 })).toBeNull();
    expect(await deleteMatch(db, { guildId: GUILD, id })).toEqual({ screenshotKeys: [] });
    await expect(add(a, c)).resolves.toBeTypeOf("number");
  });
});

describe("hasActiveWin", () => {
  it("有効な勝利があるときだけ true。無効にすると false、有効に戻すと true", async () => {
    const matchId = await add(a, b);
    expect(await hasActiveWin(db, matchId)).toBe(false);

    const id = await win(matchId, a);
    expect(await hasActiveWin(db, matchId)).toBe(true);

    await setWinActive(db, { guildId: GUILD, id, active: false });
    expect(await hasActiveWin(db, matchId)).toBe(false);

    await setWinActive(db, { guildId: GUILD, id, active: true });
    expect(await hasActiveWin(db, matchId)).toBe(true);
  });
});

describe("countMatchesByTeam（チームごとの試合数）", () => {
  it("組分けに入った数を、チームごとに数える（勝ち負けに関係なく）。入っていないチームは含まれない", async () => {
    const first = await add(a, b);
    await add(a, c, { slotHour: 22 });
    await win(first, b);

    const counts = await countMatchesByTeam(db, GUILD);

    expect([...counts]).toEqual([[a, 2], [b, 1], [c, 1]]);
    expect(counts.has(d)).toBe(false);
  });

  it("別のサーバーの組分けは、数えない。削除した組分けも、数えない", async () => {
    const id = await add(a, b);
    await addMatch(db, { guildId: "999", slotDate: DATE, slotHour: 21, teamAId: a, teamBId: b, createdAt: 1 });

    await deleteMatch(db, { guildId: GUILD, id });

    expect((await countMatchesByTeam(db, GUILD)).size).toBe(0);
    expect((await countMatchesByTeam(db, "999")).get(a)).toBe(1);
  });
});

describe("deleteAllMatches（試合数を 0 に戻す）", () => {
  it("そのサーバーの組分けを、すべて削除する。組まれなかったチームも外れる。別のサーバーと、挙手は、残る", async () => {
    await saveMatchResult(db, { ...slot, excludedTeamId: c, pairs: [[a, b]], now: 5 });
    await ensureHandup(db, { ...slot, teamId: a, raisedBy: "u", createdAt: 1 });
    await addMatch(db, { guildId: "999", slotDate: DATE, slotHour: 21, teamAId: a, teamBId: b, createdAt: 1 });

    await deleteAllMatches(db, GUILD);

    expect(await listMatchesOnDate(db, { guildId: GUILD, slotDate: DATE })).toEqual([]);
    expect((await findMatchSlot(db, slot))?.excludedTeamId).toBeNull();
    expect((await countMatchesByTeam(db, GUILD)).size).toBe(0);
    expect((await countMatchesByTeam(db, "999")).get(a)).toBe(1);
    expect(await findHandup(db, { ...slot, teamId: a })).toBeDefined();
  });

  it("勝利の記録を先に削除すれば、外部キーに引っかからない。何もなければ、何もしない", async () => {
    const matchId = await add(a, b);
    await win(matchId, a);

    await deleteAllWins(db, GUILD);
    await deleteAllMatches(db, GUILD);
    await deleteAllMatches(db, GUILD);

    expect(await listWins(db, GUILD)).toEqual([]);
    expect(await listMatchesOnDate(db, { guildId: GUILD, slotDate: DATE })).toEqual([]);
  });
});
