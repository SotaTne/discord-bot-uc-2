import { fixedClock } from "@uc/core";
import {
  createHandup,
  createTeam,
  defaultGuildSettings,
  findMatchSlot,
  listMatchedSlots,
  saveGuildSettings,
} from "@uc/db";
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
  createFakeChannel,
  createSeededDb,
  jst,
  type FakeChannel,
} from "../test-helpers";
import { join, wait, waitCancel } from "./waiting";

/**
 * 継続募集のテストは、「フック」（きっかけ → 起きること）ごとに、独立して書く。
 *   1. 締切のマッチング        → 案内（「待機する」）を投稿する
 *   2. 「待機する」を押す      → 募集のメッセージを、最初の 1 回だけ投稿する（2 回目以降は、編集）
 *   3. 「待機をキャンセル」    → 募集のメッセージを、取り消しの表示にして、ボタンを外す（削除しない）
 *   4. 「対戦する」を押す      → 組分けを作り、結果を投稿し、募集のメッセージを削除し、案内のボタンを外す
 *   5. 試合開始の時刻になる    → 募集のメッセージを削除し、案内のボタンを外す（毎分の cron。1 度だけ）
 *   6. 対象でない人が押す      → 何も変わらない
 * フックの前後で、チャンネルへの 投稿・編集・削除 と、DB（メッセージの ID）が、どうなるかを、確かめる。
 */

const CHANNEL = "300000000000000001";
const NGT_ROLE = "400000000000000003";
const ITF_ROLE = "400000000000000004";
const DATE = "2026-10-07";
const WAIT = `wait:${DATE}:21`;
const CANCEL = `wait-cancel:${DATE}:21`;
const JOIN = `join:${DATE}:21`;

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
let ngtId: number;
let itfId: number;
let channel: FakeChannel;

beforeEach(async () => {
  seeded = await createSeededDb();
  ngtId = await createTeam(seeded.db, { guildId: GUILD_ID, roleId: NGT_ROLE, createdAt: 1 });
  itfId = await createTeam(seeded.db, { guildId: GUILD_ID, roleId: ITF_ROLE, createdAt: 1 });
  channel = createFakeChannel();
  await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL }, 1);
});

/** cron を、その時刻で 1 回動かす */
const tick = (at: string) => runScheduled({ db: seeded.db, rest: channel.rest, clock: fixedClock(jst(at)) });

/** 21 時の挙手: KMU → UT → NGT の順。奇数なので、NGT が組まれない。20:53 の締切のマッチングを、実行する */
async function runCutoff() {
  for (const [teamId, at] of [[seeded.kmuId, 1], [seeded.utId, 2], [ngtId, 3]] as const) {
    await createHandup(seeded.db, { guildId: GUILD_ID, slotDate: DATE, slotHour: 21, teamId, raisedBy: "u", createdAt: at });
  }
  await tick("2026-10-07T20:53:00");
}

/** ボタンを押す */
const press = (
  handler: typeof wait,
  input: { customId: string; roleIds: string[]; userId?: string },
  at = "2026-10-07T20:56:00",
) =>
  handler(
    commandKit(
      seeded.db,
      commandInteraction({ customId: input.customId, roleIds: input.roleIds, ...(input.userId ? { userId: input.userId } : {}) }),
      jst(at),
      { channel },
    ).context,
  );

const slotOf = async () => (await findMatchSlot(seeded.db, { guildId: GUILD_ID, slotDate: DATE, slotHour: 21 }))!;
const labels = (components: unknown) =>
  (components as { components: { label: string }[] }[] | undefined)?.map((row) => row.components.map((button) => button.label));
/** 募集のメッセージ（「対戦相手を募集しています」）の投稿 */
const announces = () => channel.posted.filter((message) => message.content.includes("対戦相手を募集しています"));
/** 案内のメッセージ（「待機する」）の投稿 */
const offers = () => channel.posted.filter((message) => message.content.includes("挙手が奇数だったため"));

describe("フック 1: 締切のマッチング → 案内（「待機する」）を投稿する", () => {
  it("組まれなかったチームのロールにだけ通知する、「待機する」だけのボタンつきの案内を投稿し、そのメッセージ ID を保存する", async () => {
    await runCutoff();

    const [offer] = offers();
    expect(offer?.content).toBe(
      [
        `<@&${NGT_ROLE}> 挙手が奇数だったため、21時は組まれませんでした。`,
        `待機すると、21:00 まで、<@&${NGT_ROLE}> と対戦したいチームを募集します。待機しなければ、この対戦枠は、このまま終わります。`,
      ].join("\n"),
    );
    expect(labels(offer?.components)).toEqual([["待機する"]]);
    expect(offer?.allowedMentions).toEqual({ roles: [NGT_ROLE] });
    expect(await slotOf()).toMatchObject({ waitingMessageId: offer?.id, waitingAnnounceMessageId: null, waitingSince: null });
  });

  it("待機しなければ、何も起きない（募集のメッセージは、出ない。削除も編集も、ない）", async () => {
    await runCutoff();

    expect(announces()).toEqual([]);
    expect(channel.edited).toEqual([]);
    expect(channel.deleted).toEqual([]);
  });
});

describe("フック 2: 「待機する」→ 募集のメッセージ（最初の 1 回だけ投稿し、あとは編集）", () => {
  beforeEach(runCutoff);

  it("最初の待機で、「対戦する」「待機をキャンセル」つきの募集のメッセージを、募集の通知先に投稿し、その ID を保存する。押した人には、本人にだけ見える返信を返す", async () => {
    const before = channel.posted.length;

    const response = await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });

    expect(channel.posted).toHaveLength(before + 1);
    const [announce] = announces();
    expect(announce?.content).toContain(`# 21時の対戦相手を募集しています（<@&${NGT_ROLE}> が待機中）`);
    expect(labels(announce?.components)).toEqual([["対戦する", "待機をキャンセル"]]);
    expect(announce?.channelId).toBe(CHANNEL);
    expect(await slotOf()).toMatchObject({
      waitingSince: jst("2026-10-07T20:56:00").getTime(),
      waitingAnnounceMessageId: announce?.id,
    });
    // 案内（「待機する」）のメッセージは、そのまま（編集も削除も、しない）
    expect(channel.edited).toEqual([]);
    expect(channel.deleted).toEqual([]);
    // 押した人への返信は、本人にだけ見える（全員が見るメッセージを、書き換えない）
    expect(response.type).toBe(4);
    expect((response.data?.flags ?? 0) & 64).toBe(64);
  });

  it("待機 → キャンセル → 待機 を繰り返しても、募集のメッセージは、1 通のまま。2 回目以降は、そのメッセージを編集して、ボタンを戻す", async () => {
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
    const [announce] = announces();
    await press(waitCancel, { customId: CANCEL, roleIds: [NGT_ROLE] });

    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] }, "2026-10-07T20:57:00");

    expect(announces()).toHaveLength(1);
    expect(channel.edited).toHaveLength(1);
    expect(channel.edited[0]).toMatchObject({ channelId: CHANNEL, messageId: announce?.id });
    expect(labels(channel.edited[0]?.components)).toEqual([["対戦する", "待機をキャンセル"]]);
    expect(channel.edited[0]?.content).toContain("# 21時の対戦相手を募集しています");
  });

  it("すでに待機中のとき、もう一度押しても、何も増えない（投稿も編集も、ない）", async () => {
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
    const posted = channel.posted.length;

    const again = await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });

    expect(contentOf(again)).toBe("すでに待機中です");
    expect(channel.posted).toHaveLength(posted);
    expect(channel.edited).toEqual([]);
  });

  it("募集のメッセージの投稿に失敗しても、待機は始まる（次の待機で、もう一度、投稿を試す）", async () => {
    const failing = { ...channel.rest, createMessage: async () => { throw new Error("Discord が応答しません"); } };
    const response = await wait(
      commandKit(seeded.db, commandInteraction({ customId: WAIT, roleIds: [NGT_ROLE] }), jst("2026-10-07T20:56:00"), {
        channel: { ...channel, rest: failing },
      }).context,
    );

    expect(response.type).toBe(4);
    expect(await slotOf()).toMatchObject({ waitingSince: jst("2026-10-07T20:56:00").getTime(), waitingAnnounceMessageId: null });
  });
});

describe("フック 3: 「待機をキャンセル」→ 募集のメッセージを、取り消しの表示にする（削除しない）", () => {
  beforeEach(async () => {
    await runCutoff();
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
  });

  it("押されたメッセージ（募集のメッセージ）を、取り消しの表示に置き換えて、ボタンを外す。待機は終わるが、組まれなかったチームは、そのまま", async () => {
    const response = await press(waitCancel, { customId: CANCEL, roleIds: [NGT_ROLE] });

    expect(response.type).toBe(7);
    expect(contentOf(response)).toContain(`# 21時の対戦相手の募集は、取り消されました（<@&${NGT_ROLE}> が待機をキャンセル）`);
    expect(response.data?.components).toEqual([]);
    expect(await slotOf()).toMatchObject({ waitingSince: null, excludedTeamId: ngtId });
    // 募集のメッセージは、削除しない（待機し直したとき、同じメッセージを編集して、使う）
    expect(channel.deleted).toEqual([]);
    expect((await slotOf()).waitingAnnounceMessageId).not.toBeNull();
  });
});

describe("フック 4: 「対戦する」→ 組分けを作り、募集のメッセージを削除し、案内のボタンを外す", () => {
  beforeEach(async () => {
    await runCutoff();
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
  });

  /** 募集のメッセージと、案内のメッセージの ID */
  const ids = async () => {
    const slot = await slotOf();
    return { announce: slot.waitingAnnounceMessageId, offer: slot.waitingMessageId };
  };

  it("別のチームが押すと、組分けになり、結果（何試合目か・主催つき）を投稿する", async () => {
    const posted = channel.posted.length;

    await press(join, { customId: JOIN, roleIds: [ITF_ROLE], userId: CAROL });

    const [slot] = await listMatchedSlots(seeded.db, { guildId: GUILD_ID, slotDate: DATE });
    expect(slot?.pairs.map((p) => [p.teamAId, p.teamBId])).toContainEqual([ngtId, itfId]);
    expect(await slotOf()).toMatchObject({ waitingSince: null, excludedTeamId: null });
    const result = channel.posted[posted];
    expect(result?.content).toMatch(new RegExp(`<@&${NGT_ROLE}>（1試合目） vs <@&${ITF_ROLE}>（1試合目）・主催: <@&(${NGT_ROLE}|${ITF_ROLE})>`));
  });

  it("募集のメッセージを削除し、案内のメッセージは、本文を「対戦が決まりました」にして、ボタンを外す。メッセージの ID は、空になる", async () => {
    const { announce, offer } = await ids();

    await press(join, { customId: JOIN, roleIds: [ITF_ROLE] });

    expect(channel.deleted).toEqual([{ channelId: CHANNEL, messageId: announce }]);
    expect(channel.edited).toEqual([
      { channelId: CHANNEL, messageId: offer, content: `21時: <@&${NGT_ROLE}> と <@&${ITF_ROLE}> の対戦が決まりました。`, components: [] },
    ]);
    expect(await ids()).toEqual({ announce: null, offer: null });
  });

  it("押した人には、本人にだけ見える返信を返す（押されたメッセージは、削除したため、編集しない）", async () => {
    const response = await press(join, { customId: JOIN, roleIds: [ITF_ROLE] });

    expect(response.type).toBe(4);
    expect((response.data?.flags ?? 0) & 64).toBe(64);
    expect(contentOf(response)).toBe(`21時: <@&${NGT_ROLE}> と <@&${ITF_ROLE}> の対戦が決まりました。`);
  });

  it("募集のメッセージが、すでにない（404）なら、終わっているものとして扱い、ID を空にする", async () => {
    channel.failDelete(404);

    await press(join, { customId: JOIN, roleIds: [ITF_ROLE] });

    expect(await ids()).toEqual({ announce: null, offer: null });
  });

  it("削除に失敗した（404 以外）ときは、対戦は決まったまま、ID を残す。次の定期実行（00 分）が、やり直す", async () => {
    const { announce } = await ids();
    channel.failDelete(500);

    await press(join, { customId: JOIN, roleIds: [ITF_ROLE] });

    // 対戦は決まっている
    expect(await slotOf()).toMatchObject({ waitingSince: null, excludedTeamId: null });
    // 募集のメッセージの ID だけが残る（案内は、編集できたので、空）
    expect(await ids()).toEqual({ announce, offer: null });

    channel.failDelete(null);
    await tick("2026-10-07T21:00:00");

    expect(channel.deleted).toEqual([{ channelId: CHANNEL, messageId: announce }]);
    expect(await ids()).toEqual({ announce: null, offer: null });
  });
});

describe("フック 5: 試合開始の時刻になる → 募集のメッセージを削除し、案内のボタンを外す（毎分の cron）", () => {
  beforeEach(runCutoff);

  it("試合開始の前は、何もしない（募集のメッセージも、案内も、そのまま）", async () => {
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });

    await tick("2026-10-07T20:59:00");

    expect(channel.deleted).toEqual([]);
    expect(channel.edited).toEqual([]);
    expect((await slotOf()).waitingAnnounceMessageId).not.toBeNull();
  });

  it("試合開始の時刻（00 分）になったら、募集のメッセージを削除し、案内のボタンを外す。ID は、空になる", async () => {
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
    const slot = await slotOf();

    await tick("2026-10-07T21:00:00");

    expect(channel.deleted).toEqual([{ channelId: CHANNEL, messageId: slot.waitingAnnounceMessageId }]);
    expect(channel.edited).toEqual([
      { channelId: CHANNEL, messageId: slot.waitingMessageId, content: "21時: 待機の受付は、終わりました。", components: [] },
    ]);
    expect(await slotOf()).toMatchObject({ waitingMessageId: null, waitingAnnounceMessageId: null });
  });

  it("毎分動いても、1 度しか処理しない（ID が空になっているので、2 回目以降は、何も呼ばない）", async () => {
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });

    await tick("2026-10-07T21:00:00");
    await tick("2026-10-07T21:01:00");
    await tick("2026-10-07T21:02:00");

    expect(channel.deleted).toHaveLength(1);
    expect(channel.edited).toHaveLength(1);
  });

  it("待機が、一度も押されなかった対戦枠も、案内の「待機する」が外れる（募集のメッセージは、ないので、削除はしない）", async () => {
    const slot = await slotOf();

    await tick("2026-10-07T21:00:00");

    expect(channel.deleted).toEqual([]);
    expect(channel.edited).toEqual([
      { channelId: CHANNEL, messageId: slot.waitingMessageId, content: "21時: 待機の受付は、終わりました。", components: [] },
    ]);
    expect((await slotOf()).waitingMessageId).toBeNull();
  });

  it("キャンセルして待機が終わっていても、残っている募集のメッセージを、試合開始で削除する", async () => {
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
    await press(waitCancel, { customId: CANCEL, roleIds: [NGT_ROLE] });
    const slot = await slotOf();

    await tick("2026-10-07T21:00:00");

    expect(channel.deleted).toEqual([{ channelId: CHANNEL, messageId: slot.waitingAnnounceMessageId }]);
  });

  it("削除に失敗した（404 以外）ときは、ID を残して、次の分に、やり直す", async () => {
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
    channel.failDelete(500);

    await tick("2026-10-07T21:00:00");
    expect((await slotOf()).waitingAnnounceMessageId).not.toBeNull();
    expect(channel.deleted).toEqual([]);

    channel.failDelete(null);
    await tick("2026-10-07T21:01:00");

    expect(channel.deleted).toHaveLength(1);
    expect((await slotOf()).waitingAnnounceMessageId).toBeNull();
  });
});

describe("フック 6: 対象でない人が押す → 何も変わらない（本人にだけ見える返信だけ）", () => {
  beforeEach(async () => {
    await runCutoff();
    await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] });
  });

  /** 押す前の状態（DB と、チャンネルへの 投稿・編集・削除 の数） */
  const snapshot = async () => {
    const slot = await slotOf();
    const [matched] = await listMatchedSlots(seeded.db, { guildId: GUILD_ID, slotDate: DATE });
    return {
      db: { waitingSince: slot.waitingSince, excludedTeamId: slot.excludedTeamId, pairs: matched?.pairs.length },
      calls: { posted: channel.posted.length, edited: channel.edited.length, deleted: channel.deleted.length },
    };
  };
  const isPrivateReply = (response: Awaited<ReturnType<typeof press>>) => {
    expect(response.type).toBe(4);
    expect((response.data?.flags ?? 0) & 64).toBe(64);
    expect(response.data?.components).toBeUndefined();
  };

  it("「待機する」を、組まれなかったチーム以外が押す", async () => {
    const before = await snapshot();

    for (const role of [KMU_ROLE, UT_ROLE, ITF_ROLE]) isPrivateReply(await press(wait, { customId: WAIT, roleIds: [role] }));

    expect(await snapshot()).toEqual(before);
  });

  it("「待機をキャンセル」を、待機しているチーム以外が押す（待機は、続く）", async () => {
    const before = await snapshot();

    for (const role of [KMU_ROLE, UT_ROLE, ITF_ROLE]) isPrivateReply(await press(waitCancel, { customId: CANCEL, roleIds: [role] }));

    expect(await snapshot()).toEqual(before);
    expect(before.db.waitingSince).not.toBeNull();
  });

  it("「対戦する」を、待機しているチーム自身・すでに組まれているチームが押す（待機は、続く）", async () => {
    const before = await snapshot();

    for (const role of [NGT_ROLE, KMU_ROLE, UT_ROLE]) isPrivateReply(await press(join, { customId: JOIN, roleIds: [role] }));

    expect(await snapshot()).toEqual(before);
  });

  it("チームのロールを持っていない人・複数のチームのロールを持つ人が押す", async () => {
    const before = await snapshot();

    isPrivateReply(await press(wait, { customId: WAIT, roleIds: [] }));
    isPrivateReply(await press(join, { customId: JOIN, roleIds: [ITF_ROLE, KMU_ROLE] }));

    expect(await snapshot()).toEqual(before);
  });

  it("試合開始の時刻を過ぎたら、だれも押せない", async () => {
    const before = await snapshot();

    isPrivateReply(await press(join, { customId: JOIN, roleIds: [ITF_ROLE] }, "2026-10-07T21:00:00"));
    isPrivateReply(await press(wait, { customId: WAIT, roleIds: [NGT_ROLE] }, "2026-10-07T21:00:00"));

    expect(await snapshot()).toEqual(before);
  });

  it("先着 1 チームだけ。2 つ目のチームは、「いま、対戦相手を募集していません」", async () => {
    const lbaRole = "400000000000000005";
    await createTeam(seeded.db, { guildId: GUILD_ID, roleId: lbaRole, createdAt: 1 });
    await press(join, { customId: JOIN, roleIds: [ITF_ROLE] });
    const before = await snapshot();

    const second = await press(join, { customId: JOIN, roleIds: [lbaRole] });

    expect(contentOf(second)).toBe("21時は、いま、対戦相手を募集していません");
    expect(await snapshot()).toEqual(before);
  });

  it("custom_id が壊れているときは、無効として返す", async () => {
    const response = await press(wait, { customId: "wait:abc:99", roleIds: [NGT_ROLE] });

    expect(contentOf(response)).toBe("この操作は無効です");
  });
});
