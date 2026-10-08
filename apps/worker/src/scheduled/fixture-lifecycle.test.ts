import { fixedClock } from "@uc/core";
import { defaultGuildSettings, findMatchSlot, listHandupsForSlot, listMatchedSlots, saveGuildSettings } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { handdown } from "../commands/handdown";
import { handup } from "../commands/handup";
import { status } from "../commands/status";
import { ALICE, CAROL, GUILD_ID, KMU_ROLE, UT_ROLE, commandContext, commandInteraction, contentOf, createSeededDb, jst, timeOption } from "../test-helpers";
import { runScheduled } from "./run";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
let posted: string[];
const slot = { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21 };

const rest = {
  async createMessage(_channelId: string, payload: { content?: string }) {
    posted.push(payload.content ?? "");
    return { id: String(posted.length) };
  },
};

beforeEach(async () => {
  seeded = await createSeededDb();
  posted = [];
  await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: "300000000000000001" }, 1);
});

const tick = (at: string) => runScheduled({ db: seeded.db, rest, clock: fixedClock(jst(at)) });
/** carol は UT。それ以外は KMU */
const raise = (userId: string, at: string) =>
  handup(
    commandContext(
      seeded.db,
      commandInteraction({ name: "uc-handup", userId, roleIds: userId === CAROL ? [UT_ROLE] : [KMU_ROLE], options: [timeOption(21)] }),
      jst(at),
    ),
  );

describe("対戦枠の状態（時刻ではなく、状態で挙手の受付を決める）", () => {
  it("挙手を受け付けているあいだは、未マッチング（open）。締切でマッチングを処理すると、処理済み（matched）になる", async () => {
    await raise(ALICE, "2026-10-07T15:00:00");
    expect(await findMatchSlot(seeded.db, slot)).toMatchObject({ status: "open" });

    await tick("2026-10-07T20:53:00");

    expect(await findMatchSlot(seeded.db, slot)).toMatchObject({ status: "matched", matchedAt: jst("2026-10-07T20:53:00").getTime() });
  });

  it("処理済みの枠は、時計を受付時間に戻しても、挙手も取り消しも受け付けない。マッチング結果も変わらない", async () => {
    await raise(ALICE, "2026-10-07T15:00:00");
    await raise(CAROL, "2026-10-07T15:01:00");
    await tick("2026-10-07T20:53:00");
    const before = await listMatchedSlots(seeded.db, { guildId: GUILD_ID });

    // 時計を戻して、もう一度、受付時間のあいだに
    const again = await handup(
      commandContext(seeded.db, commandInteraction({ name: "uc-handup", userId: ALICE, options: [timeOption(21)] }), jst("2026-10-07T15:00:00")),
    );
    const down = await handdown(
      commandContext(seeded.db, commandInteraction({ name: "uc-handdown", userId: ALICE, options: [timeOption(21)] }), jst("2026-10-07T15:00:00")),
    );
    await tick("2026-10-07T20:53:00");

    expect(contentOf(again)).toBe("21時の試合は、すでにマッチングが済んでいます");
    expect(contentOf(down)).toBe("21時の試合は、すでにマッチングが済んでいます");
    expect(await listHandupsForSlot(seeded.db, slot)).toHaveLength(2);
    expect(await listMatchedSlots(seeded.db, { guildId: GUILD_ID })).toEqual(before);
    expect(posted.filter((text) => text.includes("21"))).toHaveLength(1);
  });

  it("ほかの枠は、まだ受け付ける（枠ごとに、状態を持つ）", async () => {
    await tick("2026-10-07T20:53:00");

    const response = await handup(
      commandContext(seeded.db, commandInteraction({ name: "uc-handup", userId: ALICE, options: [timeOption(22)] }), jst("2026-10-07T15:00:00")),
    );

    expect(contentOf(response)).toContain("22時の試合に応募しました");
  });

  it("/uc-status は、処理済みの枠を「マッチング済み」と見せる", async () => {
    await raise(ALICE, "2026-10-07T15:00:00");
    await tick("2026-10-07T20:53:00");

    const response = await status(
      commandContext(seeded.db, commandInteraction({ name: "uc-status", userId: ALICE }), jst("2026-10-07T15:00:00")),
    );

    expect(contentOf(response)).toContain("21時: 挙手済み");
    expect(contentOf(response)).toContain("・マッチング済み");
    expect(contentOf(response)).toContain("22時: 未挙手・受付中");
  });

  it("投稿に失敗してやり直しても、挙手は変わらない（失敗した時点で、すでに処理済みなので）", async () => {
    await raise(ALICE, "2026-10-07T15:00:00");
    const failing = { async createMessage() { throw new Error("Discord が応答しません"); } };

    const failed = await runScheduled({ db: seeded.db, rest: failing, clock: fixedClock(jst("2026-10-07T20:53:00")) });
    const late = await raise(CAROL, "2026-10-07T20:54:00");
    const retried = await tick("2026-10-07T20:55:00");

    expect(failed.errors).toHaveLength(1);
    expect(contentOf(late)).toBe("21時の試合は、すでにマッチングが済んでいます");
    expect(retried.ran).toContain("cutoff:2026-10-07:21");
    expect(await listHandupsForSlot(seeded.db, slot)).toHaveLength(1);
  });
});
