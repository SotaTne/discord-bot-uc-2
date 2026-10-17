import { addMatch, createTeam, deleteTeam, saveMatchResult } from "@uc/db";
import { createTestDb } from "@uc/db/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { teamMatchCounts } from "./team-match-counts";

const GUILD = "g1";
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

const counts = async () => (await teamMatchCounts(db, GUILD)).map(({ team, count }) => [team.id, count]);

describe("teamMatchCounts（チームごとの試合数）", () => {
  it("組分けが 1 つもなければ、全チームが 0 試合。チームの登録順に並ぶ", async () => {
    expect(await counts()).toEqual([[a, 0], [b, 0], [c, 0], [d, 0]]);
  });

  it("そのチームが入った組分けの数を、数える（勝ち負けや、日付・時刻に関係なく）。組まれていないチームは 0", async () => {
    await saveMatchResult(db, { guildId: GUILD, slotDate: "2026-10-05", slotHour: 21, excludedTeamId: null, pairs: [[a, b]], now: 1 });
    await saveMatchResult(db, { guildId: GUILD, slotDate: "2026-10-06", slotHour: 22, excludedTeamId: null, pairs: [[a, c]], now: 1 });
    await saveMatchResult(db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 21, excludedTeamId: d, pairs: [[a, b]], now: 1 });

    // d は、組まれなかっただけ（組分けには、入っていない）
    expect(await counts()).toEqual([[a, 3], [b, 2], [c, 1], [d, 0]]);
  });

  it("並びは、試合数に関係なく、チームの登録順（試合数の多い順・少ない順にしない。順位に見せない）", async () => {
    // 登録順は a, b, c, d。試合数は、d が最も多く、a が最も少ない（a は 0）
    await saveMatchResult(db, { guildId: GUILD, slotDate: "2026-10-05", slotHour: 21, excludedTeamId: null, pairs: [[b, c], [d, c]], now: 1 });
    await saveMatchResult(db, { guildId: GUILD, slotDate: "2026-10-06", slotHour: 21, excludedTeamId: null, pairs: [[d, c]], now: 1 });
    await saveMatchResult(db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[d, b]], now: 1 });

    const rows = await counts();

    expect(rows.map(([id]) => id)).toEqual([a, b, c, d]);
    expect(rows.map(([, count]) => count)).toEqual([0, 2, 3, 3]);
  });

  it("管理者が追加した組分けも、数に入る", async () => {
    await addMatch(db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 21, teamAId: c, teamBId: d, createdAt: 1 });

    expect(await counts()).toEqual([[a, 0], [b, 0], [c, 1], [d, 1]]);
  });

  it("削除したチームは、出さない。ほかのサーバーのチーム・組分けは、数えない", async () => {
    await saveMatchResult(db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[a, b]], now: 1 });
    const other = await createTeam(db, { guildId: "g2", roleId: "x1", createdAt: 1 });
    const other2 = await createTeam(db, { guildId: "g2", roleId: "x2", createdAt: 1 });
    await saveMatchResult(db, { guildId: "g2", slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[other, other2]], now: 1 });
    await deleteTeam(db, GUILD, c, 5);

    expect(await counts()).toEqual([[a, 1], [b, 1], [d, 0]]);
  });
});
