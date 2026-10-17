import { defaultGuildSettings, listTeamHandupsOnDate, saveGuildSettings } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CAROL,
  GUILD_ID,
  KMU_ROLE,
  UT_ROLE,
  commandContext,
  commandInteraction,
  contentOf,
  createSeededDb,
  jst,
  timeOption,
} from "../test-helpers";
import { handup } from "./handup";

type Seeded = Awaited<ReturnType<typeof createSeededDb>>;
let seeded: Seeded;

beforeEach(async () => {
  seeded = await createSeededDb();
});

/** 受付時間内（募集開始 12:00 〜 21時の試合の7分前 20:53）の時刻 */
const OPEN = jst("2026-10-07T15:00:00");

const run = (
  input: Parameters<typeof commandInteraction>[0],
  now = OPEN,
) => handup(commandContext(seeded.db, commandInteraction(input), now));

describe("/uc-handup", () => {
  it("受付時間内なら挙手でき、チームのメンションつきで返す（本人にだけ見える）", async () => {
    const response = await run({ name: "uc-handup", options: [timeOption(21)] });

    expect(contentOf(response)).toBe(`<@&${KMU_ROLE}> 21時の試合に挙手しました`);
    expect(response.data?.flags).toBe(64);
    expect(response.data?.allowed_mentions).toEqual({ parse: [] });
  });

  it("挙手はチーム単位で保存される（日付・対戦枠・チーム・挙手した人・時刻）", async () => {
    await run({ name: "uc-handup", userId: ALICE, options: [timeOption(21)] });

    const rows = await listTeamHandupsOnDate(seeded.db, {
      guildId: GUILD_ID,
      slotDate: "2026-10-07",
      teamId: seeded.kmuId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slotHour: 21,
      raisedBy: ALICE,
      createdAt: OPEN.getTime(),
    });
  });

  it("同じチームの別の人が、同じ対戦枠にもう一度挙手しようとすると「すでに挙手」", async () => {
    await run({ name: "uc-handup", userId: ALICE, options: [timeOption(21)] });
    const response = await run({ name: "uc-handup", userId: BOB, options: [timeOption(21)] });

    expect(contentOf(response)).toBe("すでに挙手しています");
    const rows = await listTeamHandupsOnDate(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", teamId: seeded.kmuId });
    expect(rows).toHaveLength(1);
  });

  it("別の対戦枠や、別のチームなら挙手できる", async () => {
    await run({ name: "uc-handup", options: [timeOption(21)] });

    const otherSlot = await run({ name: "uc-handup", options: [timeOption(22)] });
    const otherTeam = await run({
      name: "uc-handup",
      userId: CAROL,
      roleIds: [UT_ROLE],
      options: [timeOption(21)],
    });

    expect(contentOf(otherSlot)).toContain("22時の試合に挙手しました");
    expect(contentOf(otherTeam)).toContain("21時の試合に挙手しました");
  });

  describe("挙手できないとき", () => {
    it("チームのロールを持っていない", async () => {
      const response = await run({ name: "uc-handup", roleIds: ["999"], options: [timeOption(21)] });
      expect(contentOf(response)).toBe("挙手が許可されていません");
    });

    it("チームのロールを複数持っている", async () => {
      const response = await run({
        name: "uc-handup",
        roleIds: [KMU_ROLE, UT_ROLE],
        options: [timeOption(21)],
      });
      expect(contentOf(response)).toBe("複数のチームロールを持っているため、挙手できません");
    });

    it("登録されていない時刻", async () => {
      const response = await run({ name: "uc-handup", options: [timeOption(20)] });
      expect(contentOf(response)).toBe("20時の試合時刻は登録されていません");
    });

    it("大会の期間の外では、挙手できない。期間の当日は、できる", async () => {
      await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, seasonStart: "2026-10-08", seasonEnd: "2026-10-09" }, 1);
      const outside = await run({ name: "uc-handup", options: [timeOption(21)] });
      expect(contentOf(outside)).toBe("いまは大会の期間外です（2026-10-08〜2026-10-09）");
      expect(await listTeamHandupsOnDate(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", teamId: seeded.kmuId })).toHaveLength(0);

      await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, seasonStart: "2026-10-07", seasonEnd: "2026-10-07" }, 2);
      const inside = await run({ name: "uc-handup", options: [timeOption(21)] });
      expect(contentOf(inside)).toContain("21時の試合に挙手しました");
    });

    it("募集開始前", async () => {
      const response = await run(
        { name: "uc-handup", options: [timeOption(21)] },
        jst("2026-10-07T11:59:59"),
      );
      expect(contentOf(response)).toBe("受付は12時からです");
    });

    it("試合開始の7分前を過ぎた後", async () => {
      const response = await run(
        { name: "uc-handup", options: [timeOption(21)] },
        jst("2026-10-07T20:53:00"),
      );
      expect(contentOf(response)).toBe("受付は終了しました（試合開始の7分前までです）");
    });

    it("時刻を指定していない", async () => {
      const response = await run({ name: "uc-handup" });
      expect(contentOf(response)).toBe("時刻を指定してください");
    });

    it("サーバーの外（DM など）で実行した", async () => {
      const response = await run({ name: "uc-handup", guildId: null, options: [timeOption(21)] });
      expect(contentOf(response)).toBe("サーバー内で実行してください");
    });

    it("失敗したときは、挙手を保存しない", async () => {
      await run({ name: "uc-handup", roleIds: ["999"], options: [timeOption(21)] });
      await run({ name: "uc-handup", options: [timeOption(20)] });

      const rows = await listTeamHandupsOnDate(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", teamId: seeded.kmuId });
      expect(rows).toHaveLength(0);
    });
  });
});
