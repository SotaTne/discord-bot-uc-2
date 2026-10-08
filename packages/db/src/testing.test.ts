import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { teams } from "./schema";
import { createTestD1 } from "./testing";

// 本番と同じ drizzle-orm/d1 で、テスト用アダプターを通してクエリを実行できることを確かめる。
type Db = ReturnType<typeof drizzle>;
let db: Db;

beforeEach(() => {
  db = drizzle(createTestD1() as unknown as Parameters<typeof drizzle>[0]);
});

const insertTeam = (_label: string, roleId: string) => db.insert(teams).values({ guildId: "100", roleId, createdAt: 1 });

describe("createTestD1 と Drizzle", () => {
  it("insert した行を select で読み出せる", async () => {
    await insertTeam("KMU", "r1");
    await insertTeam("UT", "r2");

    const rows = await db.select().from(teams).orderBy(teams.id);

    expect(rows.map((row) => row.roleId)).toEqual(["r1", "r2"]);
    expect(rows[0]).toMatchObject({ guildId: "100", roleId: "r1", createdAt: 1 });
  });

  it("条件で絞り込み、必要な列だけを取り出せる", async () => {
    await insertTeam("KMU", "r1");
    await insertTeam("UT", "r2");

    const rows = await db.select({ roleId: teams.roleId }).from(teams).where(eq(teams.guildId, "100")).orderBy(teams.id);

    expect(rows).toEqual([{ roleId: "r1" }, { roleId: "r2" }]);
  });

  it("集計できる", async () => {
    await insertTeam("KMU", "r1");
    await insertTeam("UT", "r2");

    const [row] = await db.select({ total: count() }).from(teams);

    expect(row?.total).toBe(2);
  });

  it("update と delete ができる", async () => {
    await insertTeam("KMU", "r1");

    await db.update(teams).set({ guildId: "200" }).where(eq(teams.roleId, "r1"));
    expect((await db.select().from(teams))[0]?.guildId).toBe("200");

    await db.delete(teams).where(eq(teams.roleId, "r1"));
    expect(await db.select().from(teams)).toHaveLength(0);
  });

  it("制約違反（UNIQUE）はエラーになる", async () => {
    await insertTeam("KMU", "r1");

    await expect(insertTeam("UT", "r1")).rejects.toThrow();
  });
});
