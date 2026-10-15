import { fixedClock } from "@uc/core";
import { createHandup, createTeam, defaultGuildSettings, findMatchSlot, listMatchedSlots, saveGuildSettings } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { runScheduled } from "../scheduled/run";
import {
  CAROL,
  GUILD_ID,
  KMU_ROLE,
  UT_ROLE,
  commandInteraction,
  commandKit,
  contentOf,
  createSeededDb,
  jst,
} from "../test-helpers";
import { join, wait, waitCancel } from "./waiting";

type Posted = { channelId: string; content: string; allowedMentions: unknown };

const CHANNEL = "300000000000000001";
const NGT_ROLE = "400000000000000003";
const DATE = "2026-10-07";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
let ngtId: number;
let posted: Posted[];

beforeEach(async () => {
  seeded = await createSeededDb();
  ngtId = await createTeam(seeded.db, { guildId: GUILD_ID, roleId: NGT_ROLE, createdAt: 1 });
  posted = [];
  await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL }, 1);
});

/** 21 時の締切のマッチングを、実行する（KMU・UT・NGT が挙手 → 奇数なので、NGT が組まれない） */
async function runCutoff() {
  for (const [teamId, at] of [[seeded.kmuId, 1], [seeded.utId, 2], [ngtId, 3]] as const) {
    await createHandup(seeded.db, { guildId: GUILD_ID, slotDate: DATE, slotHour: 21, teamId, raisedBy: "u", createdAt: at });
  }
  const rest = {
    async createMessage(channelId: string, payload: { content?: string; allowed_mentions?: unknown }) {
      posted.push({ channelId, content: payload.content ?? "", allowedMentions: payload.allowed_mentions });
      return { id: `m${posted.length}` };
    },
  };
  await runScheduled({ db: seeded.db, rest, clock: fixedClock(jst("2026-10-07T20:53:00")) });
}

/** ボタンを押す */
const press = (
  handler: typeof wait,
  input: { customId: string; roleIds: string[]; userId?: string },
  at = "2026-10-07T20:56:00",
) => {
  const kit = commandKit(
    seeded.db,
    commandInteraction({ customId: input.customId, roleIds: input.roleIds, ...(input.userId ? { userId: input.userId } : {}) }),
    jst(at),
    { posted },
  );
  return handler(kit.context);
};

const slotOf = async () => (await findMatchSlot(seeded.db, { guildId: GUILD_ID, slotDate: DATE, slotHour: 21 }))!;

describe("継続募集: 奇数で組まれなかったチームへの案内", () => {
  it("締切のマッチングのあとに、組まれなかったチームのロールにだけ通知する、「待機する」の案内を出す。メッセージ ID を保存する", async () => {
    await runCutoff();

    const offer = posted.at(-1)!;
    expect(offer.content).toContain(`<@&${NGT_ROLE}> 挙手が奇数だったため、21時は組まれませんでした。`);
    expect(offer.allowedMentions).toEqual({ roles: [NGT_ROLE] });
    expect((await slotOf()).waitingMessageId).toBe(`m${posted.length}`);
    expect((await slotOf()).waitingSince).toBeNull();
  });
});

describe("継続募集: ボタン", () => {
  beforeEach(async () => {
    await runCutoff();
    posted.length = 0;
  });

  const WAIT = `wait:${DATE}:21`;
  const CANCEL = `wait-cancel:${DATE}:21`;
  const JOIN = `join:${DATE}:21`;

  it("「待機する」: 組まれなかったチームが押すと、待機が始まる。案内は、「対戦する」「待機をキャンセル」に変わり、通知先に知らせる", async () => {
    const response = await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });

    expect((await slotOf()).waitingSince).toBe(jst("2026-10-07T20:56:00").getTime());
    expect(contentOf(response)).toContain(`<@&${NGT_ROLE}> が待機中です（21時）`);
    expect(response.data?.components?.[0]?.components.map((b) => b.label)).toEqual(["対戦する", "待機をキャンセル"]);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.content).toContain("# 21時の対戦相手を募集しています");
  });

  it("「待機する」: 組まれなかったチーム以外は、押せない。待機は始まらない", async () => {
    const response = await press(wait, { customId: WAIT, roleIds: [KMU_ROLE] });

    expect(contentOf(response)).toBe("待機できるのは、組まれなかったチームだけです");
    expect((await slotOf()).waitingSince).toBeNull();
  });

  it("「待機する」: 試合開始の時刻を過ぎたら、押せない", async () => {
    const response = await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] }, "2026-10-07T21:00:00");

    expect(contentOf(response)).toBe("21時の試合は、もう始まっています");
    expect((await slotOf()).waitingSince).toBeNull();
  });

  it("「待機をキャンセル」: 待機しているチームが押すと、待機が終わる。組まれなかったチームは、そのまま", async () => {
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });

    const response = await press(waitCancel, { customId: CANCEL, roleIds: [NGT_ROLE] });

    expect(contentOf(response)).toBe(`<@&${NGT_ROLE}> の待機は取り消されました（21時）。`);
    expect(response.data?.components).toEqual([]);
    expect(await slotOf()).toMatchObject({ waitingSince: null, excludedTeamId: ngtId });
  });

  it("「対戦する」: 待機中に、別のチームが押すと、組分けになる。結果は、何試合目か・主催つきで投稿される", async () => {
    // KMU・UT は、すでに組まれている。ここでは、組まれていない 4 つ目のチームが押す
    const itfRole = "400000000000000004";
    const itf = await createTeam(seeded.db, { guildId: GUILD_ID, roleId: itfRole, createdAt: 1 });
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
    posted.length = 0;

    const response = await press(join, { customId: JOIN, roleIds: [itfRole], userId: CAROL });

    expect(contentOf(response)).toBe(`21時: <@&${NGT_ROLE}> と <@&${itfRole}> の対戦が決まりました。`);
    const [slot] = await listMatchedSlots(seeded.db, { guildId: GUILD_ID, slotDate: DATE });
    expect(slot?.pairs.map((p) => [p.teamAId, p.teamBId])).toContainEqual([ngtId, itf]);
    expect(await slotOf()).toMatchObject({ waitingSince: null, excludedTeamId: null });
    expect(posted[0]?.content).toMatch(new RegExp(`<@&${NGT_ROLE}>（1試合目） vs <@&${itfRole}>（1試合目）・主催: <@&(${NGT_ROLE}|${itfRole})>`));
  });

  it("「対戦する」: 先着 1 チームだけ。2 つ目のチームは、「すでに、ほかのチームが対戦を決めています」", async () => {
    const itfRole = "400000000000000004";
    const lbaRole = "400000000000000005";
    await createTeam(seeded.db, { guildId: GUILD_ID, roleId: itfRole, createdAt: 1 });
    await createTeam(seeded.db, { guildId: GUILD_ID, roleId: lbaRole, createdAt: 1 });
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
    await press(join, { customId: JOIN, roleIds: [itfRole] });

    const second = await press(join, { customId: JOIN, roleIds: [lbaRole] });

    // 1 チーム目が決まった時点で、募集は終わっている（組まれなかったチームの印が、外れる）
    expect(contentOf(second)).toBe("21時は、いま、対戦相手を募集していません");
    const [slot] = await listMatchedSlots(seeded.db, { guildId: GUILD_ID, slotDate: DATE });
    expect(slot?.pairs).toHaveLength(2);
  });

  it("「対戦する」: 待機していないときは、押せない。待機しているチーム自身・すでに組まれているチームも、押せない", async () => {
    const before = await press(join, { customId: JOIN, roleIds: [UT_ROLE] });
    expect(contentOf(before)).toBe("待機しているチームがいません（待機が取り消されたか、終わっています）");

    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
    expect(contentOf(await press(join, { customId: JOIN, roleIds: [NGT_ROLE] }))).toBe("待機しているのは、自チームです");
    expect(contentOf(await press(join, { customId: JOIN, roleIds: [UT_ROLE] }))).toBe("21時は、すでに組まれています");
  });

  it("「対戦する」: 試合開始の時刻を過ぎたら、押せない", async () => {
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });

    const response = await press(join, { customId: JOIN, roleIds: [KMU_ROLE] }, "2026-10-07T21:00:00");

    expect(contentOf(response)).toBe("21時の試合は、もう始まっています");
  });

  describe("対象でない人が押しても、何も起きない（本人にだけ見える返信だけ。全員が見るメッセージも、DB も、投稿も、変わらない）", () => {
    /** 押す前の、対戦枠の状態 */
    const snapshot = async () => {
      const slot = await slotOf();
      const [matched] = await listMatchedSlots(seeded.db, { guildId: GUILD_ID, slotDate: DATE });
      return { waitingSince: slot.waitingSince, excludedTeamId: slot.excludedTeamId, pairs: matched?.pairs.length };
    };
    /** 本人にだけ見える返信か（UpdateMessage = 7 でも、公開の返信でもない） */
    const isPrivateReply = (response: Awaited<ReturnType<typeof press>>) => {
      expect(response.type).toBe(4);
      expect((response.data?.flags ?? 0) & 64).toBe(64);
      expect(response.data?.components).toBeUndefined();
    };

    it("「待機する」を、組まれなかったチーム以外が押す", async () => {
      const before = await snapshot();

      for (const role of [KMU_ROLE, UT_ROLE]) {
        isPrivateReply(await press(wait, { customId: WAIT, roleIds: [role] }));
      }

      expect(await snapshot()).toEqual(before);
      expect(posted).toEqual([]);
    });

    it("「待機をキャンセル」を、待機しているチーム以外が押す（待機は、続く）", async () => {
      await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
      posted.length = 0;
      const before = await snapshot();

      for (const role of [KMU_ROLE, UT_ROLE]) {
        isPrivateReply(await press(waitCancel, { customId: CANCEL, roleIds: [role] }));
      }

      expect(await snapshot()).toEqual(before);
      expect(before.waitingSince).not.toBeNull();
      expect(posted).toEqual([]);
    });

    it("「対戦する」を、待機しているチーム自身・すでに組まれているチームが押す（待機は、続く）", async () => {
      await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
      posted.length = 0;
      const before = await snapshot();

      for (const role of [NGT_ROLE, KMU_ROLE, UT_ROLE]) {
        isPrivateReply(await press(join, { customId: JOIN, roleIds: [role] }));
      }

      expect(await snapshot()).toEqual(before);
      expect(posted).toEqual([]);
    });

    it("チームのロールを持っていない人・複数のチームのロールを持つ人が押す", async () => {
      const before = await snapshot();

      isPrivateReply(await press(wait, { customId: WAIT, roleIds: [] }));
      isPrivateReply(await press(wait, { customId: WAIT, roleIds: [NGT_ROLE, KMU_ROLE] }));

      expect(await snapshot()).toEqual(before);
      expect(posted).toEqual([]);
    });
  });

  it("custom_id が壊れているときは、無効として返す", async () => {
    const response = await press(wait, { customId: "wait:abc:99", roleIds: [NGT_ROLE] });

    expect(contentOf(response)).toBe("この操作は無効です");
  });
});
