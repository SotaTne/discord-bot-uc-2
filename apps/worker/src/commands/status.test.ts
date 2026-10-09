import { createHandup, defaultGuildSettings, saveGuildSettings, type Handup, type Team } from "@uc/db";
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
  insertWinInSlot,
  jst,
  timeOption,
} from "../test-helpers";
import { handdown } from "./handdown";
import { handup } from "./handup";
import { status } from "./status";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;

beforeEach(async () => {
  seeded = await createSeededDb();
});

const call = (
  handler: typeof status,
  input: Parameters<typeof commandInteraction>[0],
  now: Date,
) => handler(commandContext(seeded.db, commandInteraction(input), now));

describe("/uc-status", () => {
  it("自チームの、対戦枠ごとの挙手状況と受付の段階を返す（取り消した対戦枠は、未挙手に戻る）", async () => {
    await call(handup, { name: "uc-handup", userId: ALICE, options: [timeOption(21)] }, jst("2026-10-07T14:05:00"));
    await call(handup, { name: "uc-handup", userId: ALICE, options: [timeOption(23)] }, jst("2026-10-07T14:06:00"));
    await call(handdown, { name: "uc-handdown", userId: BOB, options: [timeOption(23)] }, jst("2026-10-07T14:10:00"));

    const response = await call(status, { name: "uc-status" }, jst("2026-10-07T21:30:00"));

    expect(contentOf(response)).toBe(
      [
        `<@&${KMU_ROLE}> の挙手状況（2026-10-07）`,
        "**0pt**（1位）・0試合・0勝",
        `- 21時: 挙手済み（by <@${ALICE}>, 14:05）・締切`,
        "- 22時: 未挙手・受付中",
        "- 23時: 未挙手・受付中",
      ].join("\n"),
    );
    expect(response.data?.flags).toBe(64);
  });

  describe("得点（順位・試合数・勝利数）", () => {
    const win = (teamId: number, day: number, points: number) =>
      insertWinInSlot(seeded.db, { guildId: GUILD_ID, teamId, slotDate: `2026-09-${String(day).padStart(2, "0")}`, slotHour: 21, points, screenshotKey: null, recordedBy: "a", createdAt: day });
    const lines = async (now = jst("2026-10-07T14:00:00")) => contentOf(await call(status, { name: "uc-status" }, now)).split("\n");
    const scoreLine = async () => (await lines())[1];

    it("自チームの得点・順位・試合数・勝利数を、見出しの下に出す（他のチームの得点は、見せない）", async () => {
      await win(seeded.kmuId, 1, 80);
      await win(seeded.kmuId, 2, 70);
      await win(seeded.utId, 3, 300);

      expect(await scoreLine()).toBe("**150pt**（2位）・3試合・2勝");
      expect(contentOf(await call(status, { name: "uc-status" }, jst("2026-10-07T14:00:00")))).not.toContain("300");
    });

    it("同点は、同じ順位（/uc-teams と同じ）", async () => {
      await win(seeded.kmuId, 1, 100);
      await win(seeded.utId, 2, 100);

      expect(await scoreLine()).toBe("**100pt**（1位）・2試合・1勝");
    });

    it("試合数が N を超えたら、その旨を出す。負けた試合も、試合数に数える", async () => {
      await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, fixedAfterMatches: 1 }, 1);
      await win(seeded.kmuId, 1, 80);
      await win(seeded.utId, 2, 70);
      await win(seeded.kmuId, 3, 90);

      // KMU は、3 試合（うち勝利は 2）。3 試合目の勝利は、固定点（既定 100）で数える（80 + 100）
      // （テスト用の勝利は、相手チームにも組分けを作るので、勝っていない試合も、試合数に数える）
      expect((await lines()).slice(1, 3)).toEqual(["**180pt**（1位）・3試合・2勝", "-# 試合数1を超えました。以降の試合は、勝つと100pt固定です"]);
    });
  });

  it("募集開始前は、未挙手と「受付前」が出る", async () => {
    const response = await call(status, { name: "uc-status" }, jst("2026-10-07T09:00:00"));

    expect(contentOf(response)).toContain("- 21時: 未挙手・受付前");
  });

  it("他のチームの挙手は、一切見せない", async () => {
    await call(handup, { name: "uc-handup", userId: CAROL, roleIds: [UT_ROLE], options: [timeOption(21)] }, jst("2026-10-07T14:00:00"));

    const response = await call(status, { name: "uc-status" }, jst("2026-10-07T15:00:00"));

    const text = contentOf(response);
    expect(text).toContain("- 21時: 未挙手・受付中");
    expect(text).not.toContain(CAROL);
    expect(text).not.toContain(UT_ROLE);
  });

  it("前日の挙手は含めない（日付で区切る）", async () => {
    await createHandup(seeded.db, {
      guildId: GUILD_ID,
      slotDate: "2026-10-06",
      slotHour: 21,
      teamId: seeded.kmuId,
      raisedBy: ALICE,
      createdAt: jst("2026-10-06T14:00:00").getTime(),
    });

    const response = await call(status, { name: "uc-status" }, jst("2026-10-07T15:00:00"));

    expect(contentOf(response)).toContain("- 21時: 未挙手・受付中");
  });

  it("チームのロールを持っていない人・複数持っている人には、理由を返す", async () => {
    const none = await call(status, { name: "uc-status", roleIds: [] }, jst("2026-10-07T15:00:00"));
    const many = await call(status, { name: "uc-status", roleIds: [KMU_ROLE, UT_ROLE] }, jst("2026-10-07T15:00:00"));

    expect(contentOf(none)).toBe("チームに所属していません");
    expect(contentOf(many)).toBe("複数のチームロールを持っているため、確認できません");
  });
});
