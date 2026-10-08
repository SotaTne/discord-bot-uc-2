import { createTestDatabase } from "@uc/db/testing";
import { describe, expect, it } from "vitest";
import { defaultSeed } from "./seed";
import { buildSeedSql } from "./seed-sql";

const options = { slotHours: [21, 22, 23], now: 1_700_000_000_000 };

describe("buildSeedSql", () => {
  it("本物のマイグレーションを適用した DB に、チーム・試合枠・設定を投入できる", () => {
    const seed = defaultSeed();
    const db = createTestDatabase();

    db.exec(buildSeedSql(seed, options));

    const teams = db.prepare("SELECT role_id FROM teams ORDER BY id").all();
    expect(teams).toEqual(seed.roles.map((role) => ({ role_id: role.id })));
    expect(db.prepare("SELECT hour FROM slots ORDER BY hour").all()).toEqual([
      { hour: 21 },
      { hour: 22 },
      { hour: 23 },
    ]);
    expect(db.prepare("SELECT guild_id, channel_id FROM guild_settings").all()).toEqual([
      { guild_id: seed.guildId, channel_id: seed.channelId },
    ]);
  });

  it("何度実行しても、重複せず同じ結果になる", () => {
    const db = createTestDatabase();
    const sql = buildSeedSql(defaultSeed(), options);

    db.exec(sql);
    db.exec(sql);

    expect(db.prepare("SELECT COUNT(*) AS n FROM teams").get()).toEqual({ n: 4 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM slots").get()).toEqual({ n: 3 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM guild_settings").get()).toEqual({ n: 1 });
  });

  it("ロールの ID に引用符があっても、SQL が壊れない", () => {
    const seed = defaultSeed();
    const first = seed.roles[0];
    if (!first) throw new Error("test setup");
    const db = createTestDatabase();

    db.exec(buildSeedSql({ ...seed, roles: [{ ...first, id: "O'Brien" }] }, options));

    expect(db.prepare("SELECT role_id FROM teams").all()).toEqual([{ role_id: "O'Brien" }]);
  });
});
