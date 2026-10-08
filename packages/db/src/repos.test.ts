import { beforeEach, describe, expect, it } from "vitest";
import {
  createHandup,
  createSlot,
  createTeam,
  defaultGuildSettings,
  findHandup,
  findSlot,
  findTeamsByRoleIds,
  getGuildSettings,
  guildSettings,
  isUniqueViolation,
  listSlots,
  listTeamHandupsOnDate,
  listTeams,
  saveGuildSettings,
  withdrawHandup,
} from "./index";
import { createTestDb } from "./testing";

const GUILD = "100";
const OTHER_GUILD = "200";
const DATE = "2026-10-07";

let db: ReturnType<typeof createTestDb>;

beforeEach(() => {
  db = createTestDb();
});

/** チームを作る。第1引数は、テストの読みやすさのための呼び名（チームはロールだけで決まるので、保存しない） */
const team = (_label: string, roleId: string, guildId = GUILD) =>
  createTeam(db, { guildId, roleId, createdAt: 1 });

describe("isUniqueViolation", () => {
  it("UNIQUE 制約のエラーなら、包まれていても true", async () => {
    await team("KMU", "r1");
    const error = await team("UT", "r1").catch((e: unknown) => e);
    expect(isUniqueViolation(error)).toBe(true);
  });

  it("別の種類のエラーや、エラーでない値は false", () => {
    expect(isUniqueViolation(new Error("something else"))).toBe(false);
    expect(isUniqueViolation("UNIQUE constraint failed")).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("cause の中の UNIQUE エラーも見つける", () => {
    const inner = new Error("UNIQUE constraint failed: teams.role_id");
    expect(isUniqueViolation(new Error("Failed query", { cause: inner }))).toBe(true);
  });
});

describe("サーバーの設定", () => {
  it("未設定なら既定値を返す", async () => {
    expect(await getGuildSettings(db, GUILD)).toEqual(defaultGuildSettings);
  });

  it("保存した設定を読み出せる。もう一度保存すると上書きされる", async () => {
    const values = { ...defaultGuildSettings, channelId: "555555555555555555", cutoffMinutes: 10 };
    await saveGuildSettings(db, GUILD, values, 1);
    expect(await getGuildSettings(db, GUILD)).toEqual(values);

    await saveGuildSettings(db, GUILD, { ...values, recruitHour: 9, revokeSessionsOnReissue: true }, 2);
    expect(await getGuildSettings(db, GUILD)).toMatchObject({ recruitHour: 9, revokeSessionsOnReissue: true });
  });

  it("サーバーごとに別々に保存される", async () => {
    await saveGuildSettings(db, GUILD, { ...defaultGuildSettings, cutoffMinutes: 10 }, 1);
    expect((await getGuildSettings(db, OTHER_GUILD)).cutoffMinutes).toBe(defaultGuildSettings.cutoffMinutes);
  });

  it("コード上の既定値は、DB の列の既定値と一致している", async () => {
    await db.insert(guildSettings).values({ guildId: GUILD, createdAt: 1, updatedAt: 1 });
    expect(await getGuildSettings(db, GUILD)).toEqual(defaultGuildSettings);
  });
});

describe("チーム", () => {
  it("作成したチームを、サーバーごとに一覧できる", async () => {
    await team("KMU", "r1");
    await team("UT", "r2");
    await team("他サーバーのチーム", "r3", OTHER_GUILD);

    expect((await listTeams(db, GUILD)).map((t) => t.roleId)).toEqual(["r1", "r2"]);
  });

  it("持っているロールのうち、チームとして登録されているものを返す", async () => {
    await team("KMU", "r1");
    await team("UT", "r2");

    const found = await findTeamsByRoleIds(db, GUILD, ["r2", "unrelated-role"]);

    expect(found.map((t) => t.roleId)).toEqual(["r2"]);
  });

  it("ロールがなければ空。別サーバーのチームは見つからない", async () => {
    await team("KMU", "r1", OTHER_GUILD);

    expect(await findTeamsByRoleIds(db, GUILD, [])).toEqual([]);
    expect(await findTeamsByRoleIds(db, GUILD, ["r1"])).toEqual([]);
  });
});

describe("試合枠", () => {
  it("開始時刻の早い順に一覧できる", async () => {
    for (const hour of [23, 21, 22]) await createSlot(db, { guildId: GUILD, hour, createdAt: 1 });

    expect((await listSlots(db, GUILD)).map((s) => s.hour)).toEqual([21, 22, 23]);
  });

  it("時刻で探せる。登録されていなければ undefined", async () => {
    await createSlot(db, { guildId: GUILD, hour: 21, createdAt: 1 });

    expect(await findSlot(db, GUILD, 21)).toMatchObject({ hour: 21 });
    expect(await findSlot(db, GUILD, 22)).toBeUndefined();
    expect(await findSlot(db, OTHER_GUILD, 21)).toBeUndefined();
  });
});

describe("挙手", () => {
  const key = (teamId: number, slotHour = 21) => ({ guildId: GUILD, slotDate: DATE, slotHour, teamId });
  const raise = (teamId: number, createdAt: number, slotHour = 21, raisedBy = "u1") =>
    createHandup(db, { ...key(teamId, slotHour), raisedBy, createdAt });

  it("挙手すると、取り消されていない挙手として見つかる", async () => {
    const kmu = await team("KMU", "r1");
    await raise(kmu, 100, 21, "alice");

    expect(await findHandup(db, key(kmu))).toMatchObject({ raisedBy: "alice", createdAt: 100 });
    expect(await findHandup(db, key(kmu, 22))).toBeUndefined();
  });

  it("同じ日・枠・チームに、取り消されていない挙手が2つ作れない", async () => {
    const kmu = await team("KMU", "r1");
    await raise(kmu, 100);

    const error = await raise(kmu, 200).catch((e: unknown) => e);

    expect(isUniqueViolation(error)).toBe(true);
  });

  it("取り消すと、行ごと削除される（履歴は残らない）。見つからなくなり、同じ枠にもう一度挙手できる", async () => {
    const kmu = await team("KMU", "r1");
    await raise(kmu, 100);

    expect(await withdrawHandup(db, { ...key(kmu) })).toBe("withdrawn");
    expect(await findHandup(db, key(kmu))).toBeUndefined();
    expect(await listTeamHandupsOnDate(db, { guildId: GUILD, slotDate: DATE, teamId: kmu })).toEqual([]);
    await expect(raise(kmu, 200)).resolves.toBeTypeOf("number");
    expect(await listTeamHandupsOnDate(db, { guildId: GUILD, slotDate: DATE, teamId: kmu })).toHaveLength(1);
  });

  it("取り消す対象がなければ not_found", async () => {
    const kmu = await team("KMU", "r1");
    expect(await withdrawHandup(db, { ...key(kmu) })).toBe("not_found");
  });

  it("その日のチームの挙手を、挙手した順に返す。取り消した挙手は、含まない", async () => {
    const kmu = await team("KMU", "r1");
    const ut = await team("UT", "r2");
    await raise(kmu, 100, 21, "alice");
    await withdrawHandup(db, { ...key(kmu) });
    await raise(kmu, 200, 21, "carol");
    await raise(kmu, 120, 22, "alice");
    await raise(ut, 130, 21, "dave");

    const rows = await listTeamHandupsOnDate(db, { guildId: GUILD, slotDate: DATE, teamId: kmu });

    expect(rows.map((r) => [r.slotHour, r.raisedBy])).toEqual([
      [22, "alice"],
      [21, "carol"],
    ]);
  });

  it("別の日の挙手は含めない", async () => {
    const kmu = await team("KMU", "r1");
    await createHandup(db, { guildId: GUILD, slotDate: "2026-10-06", slotHour: 21, teamId: kmu, raisedBy: "u", createdAt: 1 });

    expect(await listTeamHandupsOnDate(db, { guildId: GUILD, slotDate: DATE, teamId: kmu })).toEqual([]);
  });
});
