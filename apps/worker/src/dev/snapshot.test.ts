import { fixedClock } from "@uc/core";
import {
  claimJob,
  createDashboardLink,
  createHandup,
  createSession,
  createTeam,
  defaultGuildSettings,
  saveMatchResult,
  saveGuildSettings,
  withdrawHandup,
} from "@uc/db";
import { createTestDb } from "@uc/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { GUILD_ID, createSeededDb, fakeRoleRest, jst } from "../test-helpers";
import { buildDevSnapshot } from "./snapshot";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
beforeEach(async () => {
  seeded = await createSeededDb();
  await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: "300000000000000001" }, 1);
});

const NOW = jst("2026-10-07T21:30:00");
const snapshot = (at = NOW) => buildDevSnapshot({ db: seeded.db, guildId: GUILD_ID, clock: fixedClock(at), rest: fakeRoleRest });

describe("buildDevSnapshot", () => {
  it("何もなければ、設定・対戦枠・チームだけが入った、空の状態を返す", async () => {
    const result = await snapshot();

    expect(result).toMatchObject({
      now: NOW.toISOString(),
      today: "2026-10-07",
      settings: { channelId: "300000000000000001", recruitHour: 12, cutoffMinutes: 7 },
      slotHours: [21, 22, 23],
      handups: [],
      rounds: [],
      jobs: [],
      dashboard: { links: [], sessions: 0 },
    });
    expect(result.teams.map((t) => t.name)).toEqual(["KMU", "UT"]);
    expect(result.teamStats.map((t) => [t.name, t.activeHandups, t.matches])).toEqual([
      ["KMU", [], 0],
      ["UT", [], 0],
    ]);
  });

  describe("挙手", () => {
    it("今日の挙手を、対戦枠・挙手の順に、チーム名つきで返す。取り消した挙手・別の日の挙手は含めない", async () => {
      const { db, kmuId, utId } = seeded;
      await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 22, teamId: kmuId, raisedBy: "alice", createdAt: 10 });
      await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: utId, raisedBy: "carol", createdAt: 20 });
      await withdrawHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: utId });
      await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-06", slotHour: 21, teamId: kmuId, raisedBy: "old", createdAt: 1 });

      const { handups, teamStats } = await snapshot();

      expect(handups.map((h) => [h.slotHour, h.teamName, h.raisedBy])).toEqual([[22, "KMU", "alice"]]);
      // 挙手中（取り消されていない）の対戦枠だけが、チームごとに数えられる
      expect(teamStats.find((t) => t.name === "KMU")?.activeHandups).toEqual([22]);
      expect(teamStats.find((t) => t.name === "UT")?.activeHandups).toEqual([]);
    });

    it("「今日」は、疑似時計の日付で決まる", async () => {
      await createHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-08", slotHour: 21, teamId: seeded.kmuId, raisedBy: "alice", createdAt: 1 });

      expect((await snapshot()).handups).toEqual([]);
      const tomorrow = await snapshot(jst("2026-10-08T10:00:00"));
      expect(tomorrow.today).toBe("2026-10-08");
      expect(tomorrow.handups).toHaveLength(1);
    });
  });

  describe("マッチングと対戦数", () => {
    it("結果を新しい順に、チーム名つきで返す。対戦数と、奇数での除外回数を数える", async () => {
      const { db, kmuId, utId } = seeded;
      const ngt = await createTeam(db, { guildId: GUILD_ID, roleId: "r3", createdAt: 1 });
      await saveMatchResult(db, { guildId: GUILD_ID, slotDate: "2026-10-06", slotHour: 21, excludedTeamId: ngt, pairs: [[kmuId, utId]], now: 1 });
      await saveMatchResult(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[kmuId, ngt]], now: 2 });
      // 挙手が1チームだけで、組めなかった対戦枠（除外には数えない）
      await saveMatchResult(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 22, excludedTeamId: utId, pairs: [], now: 3 });

      const { rounds, teamStats } = await snapshot();

      expect(rounds.map((r) => [r.slotDate, r.slotHour])).toEqual([["2026-10-07", 22], ["2026-10-07", 21], ["2026-10-06", 21]]);
      expect(rounds[1]).toEqual({ slotDate: "2026-10-07", slotHour: 21, createdAt: 2, pairs: [{ a: "KMU", b: "NGT" }], excluded: null });
      expect(rounds[2]?.excluded).toBe("NGT");
      const stat = (name: string) => teamStats.find((t) => t.name === name);
      expect([stat("KMU")?.matches, stat("UT")?.matches, stat("NGT")?.matches]).toEqual([2, 1, 1]);
      expect([stat("KMU")?.excluded, stat("UT")?.excluded, stat("NGT")?.excluded]).toEqual([0, 0, 1]);
    });
  });

  describe("cron の予定と履歴", () => {
    it("今日の予定を、時刻順に、状態（済・実行できる・待ち・期限切れ）つきで返す", async () => {
      await claimJob(seeded.db, GUILD_ID, "recruit:2026-10-07:12", 1);

      // 21時の締切は、締切の時刻（20:53）から 30 分後（21:23）の直前まで、実行できる
      const { schedule } = await snapshot(jst("2026-10-07T21:22:00"));

      expect(schedule.map((s) => [s.key, s.state])).toEqual([
        ["recruit:2026-10-07:12", "done"],
        ["cutoff:2026-10-07:21", "ready"],
        ["cutoff:2026-10-07:22", "waiting"],
        ["cutoff:2026-10-07:23", "waiting"],
      ]);
      expect(schedule[0]?.label).toBe("12:00 募集開始の投稿");
      expect(schedule[1]?.label).toBe("21時の試合の締切（7分前）: マッチングの確定と投稿");
      expect(schedule[1]?.from).toBe(jst("2026-10-07T20:53:00").toISOString());
    });

    it("実行されないまま猶予を過ぎたものは、期限切れ", async () => {
      const { schedule } = await snapshot(jst("2026-10-07T22:22:00"));
      expect(schedule.map((s) => s.state)).toEqual(["expired", "expired", "ready", "waiting"]);
      // 22:23（22 時の締切 21:53 から 30 分）になると、22時の締切も期限切れ
      expect((await snapshot(jst("2026-10-07T22:23:00"))).schedule.map((s) => s.state)).toEqual(["expired", "expired", "expired", "waiting"]);
    });

    it("実行済みのジョブの履歴を、新しい順に返す", async () => {
      await claimJob(seeded.db, GUILD_ID, "recruit:2026-10-07:12", 100);
      await claimJob(seeded.db, GUILD_ID, "cutoff:2026-10-07:21", 200);

      expect((await snapshot()).jobs).toEqual([
        { key: "cutoff:2026-10-07:21", createdAt: 200 },
        { key: "recruit:2026-10-07:12", createdAt: 100 },
      ]);
    });
  });

  describe("ダッシュボード", () => {
    it("発行したログインリンク（トークンは含まない）と、有効なセッションの数を返す。セッションの期限は、worker の時計（疑似時計）で判定する", async () => {
      await createDashboardLink(seeded.db, { tokenHash: "secret", guildId: GUILD_ID, issuedBy: "admin", expiresAt: NOW.getTime() + 3_600_000, createdAt: NOW.getTime() });
      await createSession(seeded.db, { sessionHash: "s1", guildId: GUILD_ID, userId: "admin", userAgent: null, createdAt: 0, expiresAt: NOW.getTime() + 1000 });
      await createSession(seeded.db, { sessionHash: "s2", guildId: GUILD_ID, userId: "admin", userAgent: null, createdAt: 0, expiresAt: NOW.getTime() - 1 });

      const result = await snapshot();

      expect(result.dashboard.sessions).toBe(1);
      expect(result.dashboard.links).toEqual([{ issuedBy: "admin", createdAt: NOW.getTime(), expiresAt: NOW.getTime() + 3_600_000, usedAt: null }]);
      expect(JSON.stringify(result)).not.toContain("secret");

      // 疑似時計を進めると、セッションの有効期限も、その時計で判定する（API・Discord・cron と、同じ時計）
      const later = await snapshot(jst("2030-01-01T00:00:00"));
      expect(later.dashboard.sessions).toBe(0);
    });
  });

  it("サーバーが違えば、別のデータになる", async () => {
    const other = createTestDb();
    const result = await buildDevSnapshot({ db: other, guildId: "999", clock: fixedClock(NOW), rest: fakeRoleRest });
    expect(result).toMatchObject({ slotHours: [], teams: [], handups: [], settings: { channelId: null } });
  });
});
