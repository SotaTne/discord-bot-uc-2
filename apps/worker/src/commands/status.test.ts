import { createHandup, type Handup, type Team } from "@uc/db";
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
        `- 第1試合 21時: 挙手済み（by <@${ALICE}>, 14:05）・締切`,
        "- 第2試合 22時: 未挙手・受付中",
        "- 第3試合 23時: 未挙手・受付中",
      ].join("\n"),
    );
    expect(response.data?.flags).toBe(64);
  });

  it("募集開始前は、未挙手と「受付前」が出る", async () => {
    const response = await call(status, { name: "uc-status" }, jst("2026-10-07T09:00:00"));

    expect(contentOf(response)).toContain("- 第1試合 21時: 未挙手・受付前");
  });

  it("他のチームの挙手は、一切見せない", async () => {
    await call(handup, { name: "uc-handup", userId: CAROL, roleIds: [UT_ROLE], options: [timeOption(21)] }, jst("2026-10-07T14:00:00"));

    const response = await call(status, { name: "uc-status" }, jst("2026-10-07T15:00:00"));

    const text = contentOf(response);
    expect(text).toContain("- 第1試合 21時: 未挙手・受付中");
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

    expect(contentOf(response)).toContain("- 第1試合 21時: 未挙手・受付中");
  });

  it("チームのロールを持っていない人・複数持っている人には、理由を返す", async () => {
    const none = await call(status, { name: "uc-status", roleIds: [] }, jst("2026-10-07T15:00:00"));
    const many = await call(status, { name: "uc-status", roleIds: [KMU_ROLE, UT_ROLE] }, jst("2026-10-07T15:00:00"));

    expect(contentOf(none)).toBe("チームに所属していません");
    expect(contentOf(many)).toBe("複数のチームロールを持っているため、確認できません");
  });
});
