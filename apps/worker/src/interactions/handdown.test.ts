import { defaultGuildSettings, findHandup, saveGuildSettings } from "@uc/db";
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

let seeded: Awaited<ReturnType<typeof createSeededDb>>;

beforeEach(async () => {
  seeded = await createSeededDb();
});

const OPEN = jst("2026-10-07T15:00:00");

const call = (
  handler: typeof handup,
  input: Parameters<typeof commandInteraction>[0],
  now = OPEN,
) => handler(commandContext(seeded.db, commandInteraction(input), now));

const active = (teamId: number, slotHour = 21) =>
  findHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour, teamId });

describe("/uc-handdown", () => {
  it("大会の期間の外では、取り消せない", async () => {
    await call(handup, { name: "uc-handup", options: [timeOption(21)] });
    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, seasonStart: "2026-10-08", seasonEnd: "2026-10-09" }, 1);

    const response = await call(handdown, { name: "uc-handdown", options: [timeOption(21)] });

    expect(contentOf(response)).toBe("いまは大会の期間外です（2026-10-08〜2026-10-09）");
    expect(await active(seeded.kmuId)).toBeDefined();
  });

  it("挙手を取り消せる（チームのメンションつきで、本人にだけ見える）", async () => {
    await call(handup, { name: "uc-handup", options: [timeOption(21)] });

    const response = await call(handdown, { name: "uc-handdown", options: [timeOption(21)] });

    expect(contentOf(response)).toBe(`<@&${KMU_ROLE}> 21時の挙手を取り消しました`);
    expect(response.data?.flags).toBe(64);
    expect(await active(seeded.kmuId)).toBeUndefined();
  });

  it("挙手した本人でなくても、同じチームの人なら取り消せる。取り消すと、行ごと消える（取り消し済みは、残らない）", async () => {
    await call(handup, { name: "uc-handup", userId: ALICE, options: [timeOption(21)] });
    await call(handdown, { name: "uc-handdown", userId: BOB, options: [timeOption(21)] });

    expect(await seeded.db.query.handups.findMany()).toEqual([]);
  });

  it("挙手 → 取り消し → 挙手 を繰り返しても、そのチームの行は、いつも1件以下（同じチーム・対戦枠が重ならない）", async () => {
    const rows = () => seeded.db.query.handups.findMany();

    await call(handup, { name: "uc-handup", userId: ALICE, options: [timeOption(21)] });
    await call(handdown, { name: "uc-handdown", userId: ALICE, options: [timeOption(21)] });
    await call(handup, { name: "uc-handup", userId: BOB, options: [timeOption(21)] });
    // 同じチームの別の人が、もう一度挙手しても、重ならない
    const duplicate = await call(handup, { name: "uc-handup", userId: ALICE, options: [timeOption(21)] });

    expect(contentOf(duplicate)).toBe("すでに挙手しています");
    expect(await rows()).toMatchObject([{ raisedBy: BOB }]);
  });

  it("同じチームの2人が、続けて挙手しても、2件目は断られる（行は1件）", async () => {
    await call(handup, { name: "uc-handup", userId: ALICE, options: [timeOption(21)] });
    const second = await call(handup, { name: "uc-handup", userId: BOB, options: [timeOption(21)] });

    expect(contentOf(second)).toBe("すでに挙手しています");
    expect(await seeded.db.query.handups.findMany()).toHaveLength(1);
  });

  it("取り消した後は、同じ対戦枠にもう一度挙手できる", async () => {
    await call(handup, { name: "uc-handup", options: [timeOption(21)] });
    await call(handdown, { name: "uc-handdown", options: [timeOption(21)] });

    const again = await call(handup, { name: "uc-handup", userId: BOB, options: [timeOption(21)] });

    expect(contentOf(again)).toContain("21時の試合に挙手しました");
    expect((await active(seeded.kmuId))?.raisedBy).toBe(BOB);
  });

  it("他のチームの挙手には影響しない", async () => {
    await call(handup, { name: "uc-handup", userId: CAROL, roleIds: [UT_ROLE], options: [timeOption(21)] });

    const response = await call(handdown, { name: "uc-handdown", options: [timeOption(21)] });

    expect(contentOf(response)).toBe("21時の挙手はありません");
    expect(await active(seeded.utId)).toBeDefined();
  });

  describe("取り消せないとき", () => {
    it("挙手していない", async () => {
      const response = await call(handdown, { name: "uc-handdown", options: [timeOption(21)] });
      expect(contentOf(response)).toBe("21時の挙手はありません");
    });

    it("チームのロールを持っていない・複数持っている", async () => {
      const none = await call(handdown, { name: "uc-handdown", roleIds: [], options: [timeOption(21)] });
      const many = await call(handdown, {
        name: "uc-handdown",
        roleIds: [KMU_ROLE, UT_ROLE],
        options: [timeOption(21)],
      });
      expect(contentOf(none)).toBe("キャンセルが許可されていません");
      expect(contentOf(many)).toBe("複数のチームロールを持っているため、キャンセルできません");
    });

    it("受付時間外（締切後）は取り消せない。挙手はそのまま残る", async () => {
      await call(handup, { name: "uc-handup", options: [timeOption(21)] });

      const response = await call(
        handdown,
        { name: "uc-handdown", options: [timeOption(21)] },
        jst("2026-10-07T20:53:00"),
      );

      expect(contentOf(response)).toBe("受付は終了しました（試合開始の7分前までです）");
      expect(await active(seeded.kmuId)).toBeDefined();
    });

    it("登録されていない時刻", async () => {
      const response = await call(handdown, { name: "uc-handdown", options: [timeOption(20)] });
      expect(contentOf(response)).toBe("20時の試合時刻は登録されていません");
    });
  });
});
