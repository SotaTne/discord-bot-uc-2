import { fixedClock } from "@uc/core";
import { createHandup, defaultGuildSettings, saveGuildSettings, withdrawHandup } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { runScheduled } from "../scheduled/run";
import {
  ALICE,
  CAROL,
  GUILD_ID,
  KMU_ROLE,
  UT_ROLE,
  adminInteraction,
  commandContext,
  commandInteraction,
  channelNoops,
  contentOf,
  createSeededDb,
  jst,
} from "../test-helpers";
import { adminStatus } from "./admin-status";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
beforeEach(async () => {
  seeded = await createSeededDb();
  await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: "300000000000000001" }, 1);
});

const DATE = "2026-10-07";
const run = (at: string, interaction = adminInteraction({ name: "uc-admin-status" })) =>
  adminStatus(commandContext(seeded.db, interaction, jst(at)));
const raise = (teamId: number, slotHour: number, raisedBy: string, at: string) =>
  createHandup(seeded.db, { guildId: GUILD_ID, slotDate: DATE, slotHour, teamId, raisedBy, createdAt: jst(at).getTime() });

describe("/uc-admin-status", () => {
  it("管理者でなければ使えない", async () => {
    const response = await run("2026-10-07T15:00:00", commandInteraction({ name: "uc-admin-status" }));
    expect(contentOf(response)).toBe("管理者権限を持たないユーザーはこのコマンドを使えません");
  });

  it("サーバーの外では使えない", async () => {
    const response = await run("2026-10-07T15:00:00", adminInteraction({ name: "uc-admin-status", guildId: null }));
    expect(contentOf(response)).toBe("サーバー内で実行してください");
  });

  it("対戦枠ごとに、すべてのチームの挙手を、挙手した人と時刻つきで出す（本人にだけ見える）", async () => {
    await raise(seeded.kmuId, 21, ALICE, "2026-10-07T15:00:00");
    await raise(seeded.utId, 21, CAROL, "2026-10-07T15:05:00");

    const response = await run("2026-10-07T16:00:00");

    expect(contentOf(response)).toBe(
      [
        "# 挙手状況（2026-10-07）",
        "## 21時 ・受付中",
        `- <@&${KMU_ROLE}>（by <@${ALICE}>, 15:00）`,
        `- <@&${UT_ROLE}>（by <@${CAROL}>, 15:05）`,
        "## 22時 ・受付中",
        "挙手なし",
        "## 23時 ・受付中",
        "挙手なし",
      ].join("\n"),
    );
    expect(response.data?.flags).toBe(64);
    expect(response.data?.allowed_mentions).toEqual({ parse: [] });
  });

  it("取り消された挙手は出さない。受付の段階（受付前・締切）も出す", async () => {
    await raise(seeded.kmuId, 21, ALICE, "2026-10-07T15:00:00");
    await withdrawHandup(seeded.db, { guildId: GUILD_ID, slotDate: DATE, slotHour: 21, teamId: seeded.kmuId });

    const before = contentOf(await run("2026-10-07T11:00:00"));
    const closed = contentOf(await run("2026-10-07T20:55:00"));

    expect(before).toContain("## 21時 ・受付前\n挙手なし");
    expect(closed).toContain("## 21時 ・締切（マッチング待ち）\n挙手なし");
  });

  it("マッチング済みの対戦枠は、結果（組分け・組まれなかったチーム）を出す", async () => {
    await raise(seeded.kmuId, 21, ALICE, "2026-10-07T15:00:00");
    await raise(seeded.utId, 21, CAROL, "2026-10-07T15:05:00");
    await runScheduled({
      db: seeded.db,
      rest: { createMessage: async () => ({ id: "1" }), ...channelNoops },
      clock: fixedClock(jst("2026-10-07T20:53:00")),
    });

    const text = contentOf(await run("2026-10-07T15:00:00"));

    expect(text).toContain(`## 21時 ・マッチング済み\n- <@&${KMU_ROLE}> vs <@&${UT_ROLE}>`);
    expect(text).toContain("## 22時 ・受付中");
  });

  it("挙手が足りずに組めなかった対戦枠は、その旨を出す", async () => {
    await runScheduled({
      db: seeded.db,
      rest: { createMessage: async () => ({ id: "1" }), ...channelNoops },
      clock: fixedClock(jst("2026-10-07T20:53:00")),
    });

    expect(contentOf(await run("2026-10-07T21:00:00"))).toContain("## 21時 ・マッチング済み\n挙手がありませんでした");
  });

  it("試合時刻が登録されていなければ、その旨を出す", async () => {
    const { createTestDb } = await import("@uc/db/testing");
    const empty = createTestDb();
    const response = await adminStatus(commandContext(empty, adminInteraction({ name: "uc-admin-status" }), jst("2026-10-07T15:00:00")));

    expect(contentOf(response)).toBe("# 挙手状況（2026-10-07）\n試合時刻が登録されていません");
  });
});
