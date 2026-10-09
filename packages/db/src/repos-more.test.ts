import { beforeEach, describe, expect, it } from "vitest";
import {
  claimJob,
  consumeDashboardLink,
  createDashboardLink,
  createHandup,
  createSession,
  createSlotHour,
  createTeam,
  deleteExpiredCredentials,
  deleteGuildActivity,
  deleteSlotHour,
  deleteTeam,
  findActiveSession,
  findWin,
  findTeamById,
  deleteAllWins,
  getGuildSettings,
  findMatchForTeam,
  insertWin,
  isUniqueViolation,
  findTeamsByRoleIds,
  listHandupsForSlot,
  listActiveSessions,
  listConfiguredGuilds,
  listDashboardLinks,
  listJobKeys,
  listJobRuns,
  listTeams,
  listHandupsOnDate,
  listMatchedSlots,
  findSlotHour,
  listSlotHours,
  listWins,
  releaseJob,
  saveMatchResult,
  setWinActive,
  revokeAllSessions,
  revokeSession,
  saveGuildSettings,
  defaultGuildSettings,
  withdrawHandupById,
  matches,
} from "./index";
import { createTestDb } from "./testing";

const GUILD = "100";
const OTHER = "200";
const DATE = "2026-10-07";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
});

/** チームを作る。第1引数は、テストの読みやすさのための呼び名（チームはロールだけで決まるので、保存しない） */
const team = (_label: string, roleId: string, guildId = GUILD) =>
  createTeam(db, { guildId, roleId, createdAt: 1 });

describe("ジョブの権利（cron の二重実行の防止）", () => {
  it("先に取った人だけが true。後からは false", async () => {
    expect(await claimJob(db, GUILD, "cutoff:2026-10-07:21", 1)).toBe(true);
    expect(await claimJob(db, GUILD, "cutoff:2026-10-07:21", 2)).toBe(false);
  });

  it("別のサーバー・別のジョブなら取れる", async () => {
    await claimJob(db, GUILD, "recruit:2026-10-07", 1);
    expect(await claimJob(db, OTHER, "recruit:2026-10-07", 1)).toBe(true);
    expect(await claimJob(db, GUILD, "recruit:2026-10-08", 1)).toBe(true);
  });

  it("返すと、もう一度取れる（失敗したジョブのやり直し）", async () => {
    await claimJob(db, GUILD, "recruit:2026-10-07", 1);
    await releaseJob(db, GUILD, "recruit:2026-10-07");
    expect(await claimJob(db, GUILD, "recruit:2026-10-07", 2)).toBe(true);
  });
});

const save = (input: { slotHour?: number; slotDate?: string; guildId?: string; excludedTeamId?: number | null; pairs?: [number, number][]; now?: number }) =>
  saveMatchResult(db, {
    guildId: input.guildId ?? GUILD,
    slotDate: input.slotDate ?? DATE,
    slotHour: input.slotHour ?? 21,
    excludedTeamId: input.excludedTeamId ?? null,
    pairs: input.pairs ?? [],
    now: input.now ?? 1,
  });

describe("マッチング結果", () => {
  it("ペアと除外チームを保存して、日付・時刻の順に読み出せる。組分けは、試合の ID を持つ", async () => {
    const [a, b, c] = [await team("A", "r1"), await team("B", "r2"), await team("C", "r3")];
    await save({ slotHour: 22, now: 2 });
    await save({ slotHour: 21, excludedTeamId: c, pairs: [[a, b]], now: 1 });

    const slots = await listMatchedSlots(db, { guildId: GUILD });

    expect(slots.map((r) => r.slotHour)).toEqual([21, 22]);
    expect(slots[0]).toMatchObject({ excludedTeamId: c, matchedAt: 1, pairs: [{ matchId: expect.any(Number), teamAId: a, teamBId: b }] });
    expect(slots[1]?.pairs).toEqual([]);
  });

  it("保存すると、対戦枠はマッチング済みになる。まだの対戦枠は、結果に出ない", async () => {
    await createHandup(db, { guildId: GUILD, slotDate: DATE, slotHour: 20, teamId: await team("A", "r1"), raisedBy: "u", createdAt: 1 });
    await save({ slotHour: 21 });

    expect((await listMatchedSlots(db, { guildId: GUILD })).map((r) => r.slotHour)).toEqual([21]);
  });

  it("同じ対戦枠をもう一度保存しても、試合は作り直さない（勝利が紐づくので、ID が変わらない）", async () => {
    const [a, b] = [await team("A", "r1"), await team("B", "r2")];
    await save({ pairs: [[a, b]], now: 1 });
    const before = (await listMatchedSlots(db, { guildId: GUILD }))[0]!.pairs;

    await save({ pairs: [[a, b]], now: 2 });
    const after = await listMatchedSlots(db, { guildId: GUILD });

    expect(after).toHaveLength(1);
    expect(after[0]?.pairs).toEqual(before);
    expect(after[0]?.matchedAt).toBe(1);
  });

  it("日付を指定すると、その日だけ。ほかのサーバーのものは含めない", async () => {
    await save({});
    await save({ slotDate: "2026-10-08" });
    await save({ guildId: OTHER });

    expect(await listMatchedSlots(db, { guildId: GUILD, slotDate: DATE })).toHaveLength(1);
    expect(await listMatchedSlots(db, { guildId: GUILD })).toHaveLength(2);
  });

  it("結果がなければ空", async () => {
    expect(await listMatchedSlots(db, { guildId: GUILD })).toEqual([]);
  });

  it("あるチームの試合を、日付・対戦枠・チームで探せる。対戦していないチーム・マッチングされていない対戦枠は、見つからない", async () => {
    const [a, b, c] = [await team("A", "r1"), await team("B", "r2"), await team("C", "r3")];
    await save({ pairs: [[a, b]], excludedTeamId: c });
    const key = { guildId: GUILD, slotDate: DATE, slotHour: 21 };

    expect(await findMatchForTeam(db, { ...key, teamId: b })).toMatchObject({ teamAId: a, teamBId: b });
    expect(await findMatchForTeam(db, { ...key, teamId: c })).toBeUndefined();
    expect(await findMatchForTeam(db, { ...key, slotHour: 22, teamId: a })).toBeUndefined();
  });
});

/** KMU と UT が、21時に対戦する試合 */
async function playedMatch() {
  const [kmu, ut] = [await team("KMU", "r1"), await team("UT", "r2")];
  await save({ pairs: [[kmu, ut]] });
  const matchId = (await listMatchedSlots(db, { guildId: GUILD }))[0]!.pairs[0]!.matchId;
  return { kmu, ut, matchId };
}

describe("勝利の記録", () => {
  const record = (over: { teamId: number; matchId: number; points?: number; key?: string | null; guildId?: string; createdAt?: number }) =>
    insertWin(db, {
      guildId: over.guildId ?? GUILD,
      teamId: over.teamId,
      matchId: over.matchId,
      points: over.points ?? 80,
      screenshotKey: over.key ?? null,
      recordedBy: "admin",
      createdAt: over.createdAt ?? 1,
    });

  it("記録した順に読み出せる。はじめは有効で、試合の日付・時刻も取れる", async () => {
    const { kmu, ut, matchId } = await playedMatch();
    const first = await record({ teamId: kmu, matchId, key: "shots/a.png" });
    const second = await record({ teamId: ut, matchId, points: 10, createdAt: 2 });

    const rows = await listWins(db, GUILD);

    expect(rows.map((r) => [r.id, r.teamId, r.active])).toEqual([[first, kmu, true], [second, ut, true]]);
    expect(rows[0]).toMatchObject({ points: 80, screenshotKey: "shots/a.png", matchId, slotDate: DATE, slotHour: 21, recordedBy: "admin" });
  });

  it("無効にしても、行は残る。有効に戻せる。見つからなければ false", async () => {
    const { kmu, matchId } = await playedMatch();
    const id = await record({ teamId: kmu, matchId });

    expect(await setWinActive(db, { guildId: GUILD, id, active: false })).toBe(true);
    expect((await findWin(db, GUILD, id))?.active).toBe(false);
    expect(await listWins(db, GUILD)).toHaveLength(1);

    expect(await setWinActive(db, { guildId: GUILD, id, active: true })).toBe(true);
    expect((await findWin(db, GUILD, id))?.active).toBe(true);

    expect(await setWinActive(db, { guildId: GUILD, id: 999, active: false })).toBe(false);
    expect(await setWinActive(db, { guildId: OTHER, id, active: false })).toBe(false);
    expect((await findWin(db, GUILD, id))?.active).toBe(true);
  });

  it("サーバーごとに分かれる。id とサーバーで1件を探せる", async () => {
    const { kmu, matchId } = await playedMatch();
    const id = await record({ teamId: kmu, matchId });

    expect(await listWins(db, OTHER)).toEqual([]);
    expect(await findWin(db, GUILD, id)).toMatchObject({ id });
    expect(await findWin(db, OTHER, id)).toBeUndefined();
  });

  it("得点のクリア: そのサーバーの記録をすべて削除して（無効なものも）、画像のキーを返す。別のサーバーには影響しない。試合は残る", async () => {
    const { kmu, matchId } = await playedMatch();
    const first = await record({ teamId: kmu, matchId, key: "shots/a.png" });
    await record({ teamId: kmu, matchId, points: 10, createdAt: 2 });
    await setWinActive(db, { guildId: GUILD, id: first, active: false });
    await save({ guildId: OTHER });
    const other = await createTeam(db, { guildId: OTHER, roleId: "x1", createdAt: 1 });
    const otherSlot = (await listMatchedSlots(db, { guildId: OTHER }))[0]!;
    await db.insert(matches).values({ matchSlotId: otherSlot.id, teamAId: other, teamBId: kmu });
    const otherMatchId = (await listMatchedSlots(db, { guildId: OTHER }))[0]!.pairs[0]!.matchId;
    await record({ teamId: other, matchId: otherMatchId, guildId: OTHER, key: "shots/other.png" });

    const keys = await deleteAllWins(db, GUILD);

    expect(keys).toEqual(["shots/a.png"]);
    expect(await listWins(db, GUILD)).toEqual([]);
    expect(await listWins(db, OTHER)).toHaveLength(1);
    expect((await listMatchedSlots(db, { guildId: GUILD }))[0]?.pairs).toHaveLength(1);
    expect(await deleteAllWins(db, GUILD)).toEqual([]);
  });
});

describe("ダッシュボードのログインリンク", () => {
  const issue = (tokenHash: string, expiresAt: number) =>
    createDashboardLink(db, { tokenHash, guildId: GUILD, issuedBy: "admin", expiresAt, createdAt: 0 });

  it("期限内なら、1回目だけ消費できて、発行者とサーバーが分かる", async () => {
    await issue("h1", 1000);

    expect(await consumeDashboardLink(db, "h1", 500)).toEqual({ guildId: GUILD, issuedBy: "admin" });
    expect(await consumeDashboardLink(db, "h1", 600)).toBeNull();
  });

  it("期限切れ・存在しないリンクは消費できない", async () => {
    await issue("h1", 1000);

    expect(await consumeDashboardLink(db, "h1", 1000)).toBeNull();
    expect(await consumeDashboardLink(db, "unknown", 0)).toBeNull();
  });
});

describe("セッション", () => {
  const open = (sessionHash: string, expiresAt: number, guildId = GUILD) =>
    createSession(db, { sessionHash, guildId, userId: "admin", userAgent: "UA", createdAt: 1, expiresAt });

  it("有効なセッションが見つかる。期限切れ・失効済みは見つからない", async () => {
    const id = await open("s1", 1000);
    await open("s2", 100);

    expect(await findActiveSession(db, "s1", 500)).toMatchObject({ id, userId: "admin" });
    expect(await findActiveSession(db, "s2", 500)).toBeUndefined();

    await revokeSession(db, GUILD, id, 600);
    expect(await findActiveSession(db, "s1", 700)).toBeUndefined();
  });

  it("有効なセッションの一覧に、期限切れ・失効済み・他のサーバーは含めない", async () => {
    await open("s1", 1000);
    await open("s2", 100);
    const revoked = await open("s3", 1000);
    await open("s4", 1000, OTHER);
    await revokeSession(db, GUILD, revoked, 5);

    const list = await listActiveSessions(db, GUILD, 500);

    expect(list.map((s) => s.sessionHash)).toEqual(["s1"]);
  });

  it("失効は、そのサーバーのセッションにだけ効く（false: 対象なし）", async () => {
    const id = await open("s1", 1000);

    expect(await revokeSession(db, OTHER, id, 5)).toBe(false);
    expect(await revokeSession(db, GUILD, id, 5)).toBe(true);
    expect(await revokeSession(db, GUILD, id, 6)).toBe(false);
  });

  it("全セッションを失効させ、失効させた件数を返す（他のサーバーは影響しない）", async () => {
    await open("s1", 1000);
    await open("s2", 1000);
    await open("s3", 1000, OTHER);

    expect(await revokeAllSessions(db, GUILD, 5)).toBe(2);
    expect(await findActiveSession(db, "s3", 6)).toBeDefined();
  });

  it("期限切れのリンクとセッションを掃除できる", async () => {
    await createDashboardLink(db, { tokenHash: "old", guildId: GUILD, issuedBy: "a", expiresAt: 10, createdAt: 0 });
    await open("expired", 10);
    await open("alive", 1000);

    await deleteExpiredCredentials(db, 500);

    expect(await findActiveSession(db, "alive", 500)).toBeDefined();
    expect(await consumeDashboardLink(db, "old", 5)).toBeNull();
  });
});

describe("チーム・試合時刻の削除", () => {
  it("チームを ID で探して、削除（論理削除）できる。削除済みは、探しても出ない。もう一度は false", async () => {
    const id = await team("KMU", "r1");

    expect(await findTeamById(db, GUILD, id)).toMatchObject({ roleId: "r1" });
    expect(await findTeamById(db, OTHER, id)).toBeUndefined();
    expect(await deleteTeam(db, OTHER, id, 5)).toBe(false);
    expect(await deleteTeam(db, GUILD, id, 5)).toBe(true);
    expect(await deleteTeam(db, GUILD, id, 6)).toBe(false);

    expect(await findTeamById(db, GUILD, id)).toBeUndefined();
    expect(await findTeamById(db, GUILD, id, { includeDeleted: true })).toMatchObject({ roleId: "r1", deletedAt: 5 });
  });

  it("削除したチームは、一覧・ロールからの検索に出ない。名前を出すときだけ、含められる", async () => {
    const [kmu, ut] = [await team("KMU", "r1"), await team("UT", "r2")];
    await deleteTeam(db, GUILD, kmu, 5);

    expect((await listTeams(db, GUILD)).map((t) => t.id)).toEqual([ut]);
    expect((await listTeams(db, GUILD, { includeDeleted: true })).map((t) => t.id)).toEqual([kmu, ut]);
    expect(await findTeamsByRoleIds(db, GUILD, ["r1", "r2"])).toHaveLength(1);
  });

  it("参照されているチームも削除できる。組分け・勝利・マッチング済みの挙手は残り、まだ組まれていない対戦枠の挙手は取り消される", async () => {
    const [kmu, ut] = [await team("KMU", "r1"), await team("UT", "r2")];
    await createHandup(db, { guildId: GUILD, slotDate: DATE, slotHour: 21, teamId: kmu, raisedBy: "u", createdAt: 1 });
    await createHandup(db, { guildId: GUILD, slotDate: DATE, slotHour: 22, teamId: kmu, raisedBy: "u", createdAt: 1 });
    await createHandup(db, { guildId: GUILD, slotDate: DATE, slotHour: 22, teamId: ut, raisedBy: "u", createdAt: 1 });
    await save({ slotHour: 21, pairs: [[kmu, ut]] });

    expect(await deleteTeam(db, GUILD, kmu, 5)).toBe(true);

    expect((await listMatchedSlots(db, { guildId: GUILD }))[0]?.pairs).toHaveLength(1);
    const handups = await listHandupsOnDate(db, { guildId: GUILD, slotDate: DATE });
    // 21時（マッチング済み）の KMU の挙手は残る。22時（まだ）の KMU の挙手だけが取り消される
    expect(handups.map((h) => [h.slotHour, h.teamId])).toEqual([[21, kmu], [22, ut]]);
  });

  it("同じロールを登録し直すと、削除したチームが元に戻る（ID が同じ。履歴がつながる）。使われているロールの二重登録は、一意制約の違反", async () => {
    const id = await team("KMU", "r1");
    await deleteTeam(db, GUILD, id, 5);

    expect(await team("KMU", "r1")).toBe(id);
    expect(await findTeamById(db, GUILD, id)).toMatchObject({ deletedAt: null });

    const error = await team("KMU", "r1").catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });

  it("試合時刻を削除できる（論理削除）。一覧と検索には出ないが、includeDeleted を付けると、削除した時刻つきで出る。二重の削除は、false", async () => {
    const id = await createSlotHour(db, { guildId: GUILD, hour: 21, createdAt: 1 });

    expect(await deleteSlotHour(db, OTHER, id, 5)).toBe(false);
    expect(await deleteSlotHour(db, GUILD, id, 5)).toBe(true);
    expect(await deleteSlotHour(db, GUILD, id, 6)).toBe(false);

    expect(await listSlotHours(db, GUILD)).toEqual([]);
    expect(await findSlotHour(db, GUILD, 21)).toBeUndefined();
    expect(await listSlotHours(db, GUILD, { includeDeleted: true })).toMatchObject([{ id, hour: 21, deletedAt: 5 }]);
  });

  it("同じ試合時刻を追加し直すと、削除した時刻が、元に戻る（ID が同じ）。使われている時刻の二重の追加は、一意制約の違反", async () => {
    const id = await createSlotHour(db, { guildId: GUILD, hour: 21, createdAt: 1 });
    await deleteSlotHour(db, GUILD, id, 5);

    expect(await createSlotHour(db, { guildId: GUILD, hour: 21, createdAt: 9 })).toBe(id);
    expect(await findSlotHour(db, GUILD, 21)).toMatchObject({ id, deletedAt: null });

    const error = await createSlotHour(db, { guildId: GUILD, hour: 21, createdAt: 9 }).catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });
});

describe("cron の対象のサーバー", () => {
  it("投稿先のチャンネルが設定されているサーバーだけを返す", async () => {
    await saveGuildSettings(db, GUILD, { ...defaultGuildSettings, channelId: "555555555555555555" }, 1);
    await saveGuildSettings(db, OTHER, { ...defaultGuildSettings, channelId: null }, 1);

    const guilds = await listConfiguredGuilds(db);

    expect(guilds).toMatchObject([{ guildId: GUILD, channelId: "555555555555555555", recruitHour: 12 }]);
  });
});

describe("管理者向けの挙手の参照・取り消し", () => {
  it("対戦枠の挙手を挙手順に返す。その日の全チームの挙手も返す。取り消した挙手は、どちらにも含まない", async () => {
    const [a, b] = [await team("A", "r1"), await team("B", "r2")];
    await createHandup(db, { guildId: GUILD, slotDate: DATE, slotHour: 21, teamId: b, raisedBy: "u2", createdAt: 20 });
    await createHandup(db, { guildId: GUILD, slotDate: DATE, slotHour: 21, teamId: a, raisedBy: "u1", createdAt: 10 });
    await createHandup(db, { guildId: GUILD, slotDate: DATE, slotHour: 22, teamId: a, raisedBy: "u1", createdAt: 30 });
    const [first] = await listHandupsForSlot(db, { guildId: GUILD, slotDate: DATE, slotHour: 22 });
    await withdrawHandupById(db, { guildId: GUILD, id: first!.id });

    const active = await listHandupsForSlot(db, { guildId: GUILD, slotDate: DATE, slotHour: 21 });
    const all = await listHandupsOnDate(db, { guildId: GUILD, slotDate: DATE });

    expect(active.map((h) => h.teamId)).toEqual([a, b]);
    expect(all).toHaveLength(2);
    expect(all.find((h) => h.slotHour === 22)).toBeUndefined();
  });

  it("ID での取り消しは、そのサーバーの挙手にだけ効く。取り消した挙手は、もう一度は取り消せない", async () => {
    const a = await team("A", "r1");
    const id = await createHandup(db, { guildId: GUILD, slotDate: DATE, slotHour: 21, teamId: a, raisedBy: "u", createdAt: 1 });

    expect(await withdrawHandupById(db, { guildId: OTHER, id })).toBe("not_found");
    expect(await withdrawHandupById(db, { guildId: GUILD, id })).toBe("withdrawn");
    expect(await withdrawHandupById(db, { guildId: GUILD, id })).toBe("not_found");
  });
});

describe("画面のための参照（cron の履歴・ログインリンク）", () => {
  it("実行済みのジョブを、新しい順に返す。キーの一覧も取れる", async () => {
    await claimJob(db, GUILD, "recruit:2026-10-07", 10);
    await claimJob(db, GUILD, "cutoff:2026-10-07:21", 20);
    await claimJob(db, OTHER, "recruit:2026-10-07", 30);

    expect(await listJobRuns(db, GUILD)).toEqual([
      { jobKey: "cutoff:2026-10-07:21", createdAt: 20 },
      { jobKey: "recruit:2026-10-07", createdAt: 10 },
    ]);
    expect(await listJobRuns(db, GUILD, 1)).toHaveLength(1);
    expect([...(await listJobKeys(db, GUILD))].sort()).toEqual(["cutoff:2026-10-07:21", "recruit:2026-10-07"]);
  });

  it("発行したログインリンクを、新しい順に返す（トークンのハッシュは含めない）", async () => {
    await createDashboardLink(db, { tokenHash: "secret-1", guildId: GUILD, issuedBy: "a", expiresAt: 100, createdAt: 1 });
    await createDashboardLink(db, { tokenHash: "secret-2", guildId: GUILD, issuedBy: "b", expiresAt: 200, createdAt: 2 });
    await consumeDashboardLink(db, "secret-2", 50);

    const links = await listDashboardLinks(db, GUILD);

    expect(links).toEqual([
      { issuedBy: "b", createdAt: 2, expiresAt: 200, usedAt: 50 },
      { issuedBy: "a", createdAt: 1, expiresAt: 100, usedAt: null },
    ]);
    expect(JSON.stringify(links)).not.toContain("secret");
  });
});

describe("開発用: 活動の記録の初期化", () => {
  it("挙手・マッチング・得点・ジョブ・ログインを消して、設定・対戦枠・チームは残す。別のサーバーには影響しない", async () => {
    const a = await team("A", "r1");
    const b = await team("B", "r2");
    const other = await team("X", "r9", OTHER);
    await saveGuildSettings(db, GUILD, { ...defaultGuildSettings, cutoffMinutes: 9 }, 1);
    await createSlotHour(db, { guildId: GUILD, hour: 21, createdAt: 1 });
    await createHandup(db, { guildId: GUILD, slotDate: DATE, slotHour: 21, teamId: a, raisedBy: "u", createdAt: 1 });
    await save({ pairs: [[a, b]] });
    const matchId = (await listMatchedSlots(db, { guildId: GUILD }))[0]!.pairs[0]!.matchId;
    await insertWin(db, { guildId: GUILD, teamId: a, matchId, points: 1, screenshotKey: null, recordedBy: "a", createdAt: 1 });
    await claimJob(db, GUILD, "recruit:x", 1);
    await createDashboardLink(db, { tokenHash: "h", guildId: GUILD, issuedBy: "a", expiresAt: 9, createdAt: 1 });
    await createSession(db, { sessionHash: "s", guildId: GUILD, userId: "a", userAgent: null, createdAt: 1, expiresAt: 9 });
    await createHandup(db, { guildId: OTHER, slotDate: DATE, slotHour: 21, teamId: other, raisedBy: "u", createdAt: 1 });

    await deleteGuildActivity(db, GUILD);

    expect(await listHandupsOnDate(db, { guildId: GUILD, slotDate: DATE })).toEqual([]);
    expect(await listMatchedSlots(db, { guildId: GUILD })).toEqual([]);
    expect(await listWins(db, GUILD)).toEqual([]);
    expect(await listJobRuns(db, GUILD)).toEqual([]);
    expect(await listDashboardLinks(db, GUILD)).toEqual([]);
    expect(await listActiveSessions(db, GUILD, 0)).toEqual([]);
    // 残るもの
    expect((await getGuildSettings(db, GUILD)).cutoffMinutes).toBe(9);
    expect(await listSlotHours(db, GUILD)).toHaveLength(1);
    expect(await listTeams(db, GUILD)).toHaveLength(2);
    expect(await listHandupsOnDate(db, { guildId: OTHER, slotDate: DATE })).toHaveLength(1);
  });

  it("何もないサーバーでも、エラーにならない", async () => {
    await expect(deleteGuildActivity(db, GUILD)).resolves.toBeUndefined();
  });
});
