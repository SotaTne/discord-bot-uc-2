import { fixedClock } from "@uc/core";
import { defaultGuildSettings, findMatchSlot, listHandupsForSlot, listMatchedSlots, reopenMatchSlot, saveGuildSettings } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { handdown } from "../interactions/handdown";
import { handup } from "../interactions/handup";
import { status } from "../interactions/status";
import { ALICE, CAROL, GUILD_ID, KMU_ROLE, UT_ROLE, channelNoops, commandContext, commandInteraction, contentOf, createSeededDb, jst, timeOption } from "../test-helpers";
import { runScheduled } from "./run";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
let posted: string[];
const slot = { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21 };

const rest = {
  async createMessage(_channelId: string, payload: { content?: string }) {
    posted.push(payload.content ?? "");
    return { id: String(posted.length) };
  },
  ...channelNoops,
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

  it("処理済みの対戦枠は、時計を受付時間に戻しても、挙手も取り消しも受け付けない。マッチング結果も変わらない", async () => {
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

  it("ほかの対戦枠は、まだ受け付ける（対戦枠ごとに、状態を持つ）", async () => {
    await tick("2026-10-07T20:53:00");

    const response = await handup(
      commandContext(seeded.db, commandInteraction({ name: "uc-handup", userId: ALICE, options: [timeOption(22)] }), jst("2026-10-07T15:00:00")),
    );

    expect(contentOf(response)).toContain("22時の試合に挙手しました");
  });

  it("/uc-status は、処理済みの対戦枠を、「マッチング済み」（組まれたなら、相手つき）と見せる", async () => {
    await raise(ALICE, "2026-10-07T15:00:00");
    await tick("2026-10-07T20:53:00");

    const response = await status(
      commandContext(seeded.db, commandInteraction({ name: "uc-status", userId: ALICE }), jst("2026-10-07T15:00:00")),
    );

    // 挙手が 1 チームだけで、組まれなかった。処理済みなので、締切や受付中とは出さない
    expect(contentOf(response)).toContain("21時: 組まれませんでした");
    expect(contentOf(response)).toContain("22時: 未挙手・受付中");
  });

  it("投稿に失敗してやり直しても、挙手は変わらない（失敗した時点で、すでに処理済みなので）", async () => {
    await raise(ALICE, "2026-10-07T15:00:00");
    const failing = { async createMessage() { throw new Error("Discord が応答しません"); }, ...channelNoops };

    const failed = await runScheduled({ db: seeded.db, rest: failing, clock: fixedClock(jst("2026-10-07T20:53:00")) });
    const late = await raise(CAROL, "2026-10-07T20:54:00");
    const retried = await tick("2026-10-07T20:55:00");

    expect(failed.errors).toHaveLength(1);
    expect(contentOf(late)).toBe("21時の試合は、すでにマッチングが済んでいます");
    expect(retried.ran).toContain("cutoff:2026-10-07:21");
    expect(await listHandupsForSlot(seeded.db, slot)).toHaveLength(1);
  });

  describe("締切を過ぎてから「やり直す」を実行して、そのあと、締切を後ろにずらしたとき", () => {
    // 締切 7 分前 → 20:53 にマッチング → 20:54 に「やり直す」（締切を過ぎているので、実行済みの記録は、残る）
    const reopenedAfterCutoff = async () => {
      await raise(ALICE, "2026-10-07T15:00:00");
      await raise(CAROL, "2026-10-07T15:01:00");
      await tick("2026-10-07T20:53:00");
      await reopenMatchSlot(seeded.db, slot);
    };
    const setCutoff = (cutoffMinutes: number) =>
      saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: "300000000000000001", cutoffMinutes }, 2);

    it("新しい締切（5 分前）の時刻になったら、自動で、マッチングする（古い実行済みの記録に、止められない）", async () => {
      await reopenedAfterCutoff();
      await setCutoff(5);

      expect((await tick("2026-10-07T20:54:00")).ran).toEqual([]); // 新しい締切の前
      expect((await findMatchSlot(seeded.db, slot))?.status).toBe("open");

      expect((await tick("2026-10-07T20:55:00")).ran).toContain("cutoff:2026-10-07:21");
      expect((await findMatchSlot(seeded.db, slot))?.status).toBe("matched");
    });

    it("締切を、ずらさなければ、今までどおり、自動では、マッチングし直さない（管理者が確定するまで、そのまま）", async () => {
      await reopenedAfterCutoff();

      expect((await tick("2026-10-07T20:54:00")).ran).toEqual([]);
      expect((await tick("2026-10-07T21:00:00")).ran).toEqual([]);
      expect((await findMatchSlot(seeded.db, slot))?.status).toBe("open");
    });

    it("マッチング済みの対戦枠は、締切を後ろにずらしても、二重には、マッチングしない", async () => {
      await raise(ALICE, "2026-10-07T15:00:00");
      await raise(CAROL, "2026-10-07T15:01:00");
      await tick("2026-10-07T20:53:00");
      const posts = posted.length;

      await setCutoff(5);
      await tick("2026-10-07T20:54:00");
      await tick("2026-10-07T20:55:00");

      expect(posted).toHaveLength(posts);
    });
  });
});
