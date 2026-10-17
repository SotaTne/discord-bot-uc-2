import { createTeam, defaultGuildSettings, getRoleMessageIds, saveGuildSettings } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { ALICE, GUILD_ID, KMU_ROLE, UT_ROLE, adminInteraction, commandInteraction, commandKit, contentOf, createFakeChannel, createSeededDb, jst, type FakeChannel } from "../test-helpers";
import { adminRole, roleCheck, roleRemove, roleSet } from "./roles";

/**
 * ロール登録の入口のテスト（きっかけ → 起きること）。
 *   /uc-admin-role     → ロール登録のメッセージを投稿・更新する（管理者のみ）
 *   チームのボタン     → ロールを付ける。すでにチームのロールを持つ人は、変えない
 *   今のロールを外す   → チームのロールを外す
 *   ロールを確認       → 持っているチームのロールを返す
 * どれも、返信は、本人にだけ見える。
 */

const ROLE_CHANNEL = "300000000000000007";
const NOW = jst("2026-10-07T15:00:00");

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
let channel: FakeChannel;

beforeEach(async () => {
  seeded = await createSeededDb();
  channel = createFakeChannel();
});

const useRoleChannel = () => saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, roleChannelId: ROLE_CHANNEL }, 1);
const run = (handler: typeof roleSet, input: Parameters<typeof commandInteraction>[0]) =>
  handler(commandKit(seeded.db, commandInteraction(input), NOW, { channel }).context);
const press = (handler: typeof roleSet, customId: string, roleIds: string[]) => run(handler, { customId, roleIds, userId: ALICE });
const isEphemeral = (response: { data?: { flags?: number } }) => ((response.data?.flags ?? 0) & 64) === 64;

describe("/uc-admin-role", () => {
  it("投稿先が決まっていれば、ロール登録のメッセージを投稿して、本人にだけ見える返信で知らせる", async () => {
    await useRoleChannel();

    const response = await adminRole(commandKit(seeded.db, adminInteraction({ name: "uc-admin-role" }), NOW, { channel }).context);

    expect(contentOf(response)).toBe(`ロール登録のメッセージを、<#${ROLE_CHANNEL}> に投稿しました`);
    expect(isEphemeral(response)).toBe(true);
    expect(channel.posted).toHaveLength(1);
    expect(channel.posted[0]).toMatchObject({ channelId: ROLE_CHANNEL });
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[0]!.id]);
  });

  it("もう一度実行すると、新しく投稿せず、同じメッセージを更新する（20 チーム以下なら、メッセージは 1 つ）", async () => {
    await useRoleChannel();
    const context = () => commandKit(seeded.db, adminInteraction({ name: "uc-admin-role" }), NOW, { channel }).context;
    await adminRole(context());

    const response = await adminRole(context());

    expect(contentOf(response)).toBe(`<#${ROLE_CHANNEL}> のロール登録のメッセージを、更新しました`);
    expect(channel.posted).toHaveLength(1);
    expect(channel.edited).toHaveLength(1);
  });

  it("投稿先が決まっていなければ、何も投稿せず、設定で決めるよう返す", async () => {
    const response = await adminRole(commandKit(seeded.db, adminInteraction({ name: "uc-admin-role" }), NOW, { channel }).context);

    expect(contentOf(response)).toContain("ダッシュボードの設定で、決めてください");
    expect(channel.posted).toEqual([]);
  });

  it("管理者でなければ、使えない（何も投稿しない）", async () => {
    await useRoleChannel();

    const response = await run(adminRole, { name: "uc-admin-role" });

    expect(contentOf(response)).toBe("管理者権限を持たないユーザーはこのコマンドを使えません");
    expect(channel.posted).toEqual([]);
  });

  it("投稿に失敗したら、その旨を本人にだけ返す（例外にしない）", async () => {
    await useRoleChannel();
    const failing = { ...channel.rest, createMessage: async () => { throw new Error("403"); } };
    const kit = commandKit(seeded.db, adminInteraction({ name: "uc-admin-role" }), NOW, { channel });

    const response = await adminRole({ ...kit.context, rest: failing as never });

    expect(contentOf(response)).toContain("投稿できませんでした");
    expect(isEphemeral(response)).toBe(true);
  });

  it("DM（サーバー外）では、使えない", async () => {
    const response = await adminRole(commandKit(seeded.db, adminInteraction({ name: "uc-admin-role", guildId: null }), NOW, { channel }).context);

    expect(contentOf(response)).toBe("サーバー内で実行してください");
  });
});

describe("チームのボタン（role-set）", () => {
  it("チームのロールを持っていない人が押すと、そのロールが付く。本人にだけ見える返信を返す", async () => {
    const response = await press(roleSet, `role-set:${seeded.kmuId}`, []);

    expect(contentOf(response)).toBe(`<@&${KMU_ROLE}> のロールを付けました`);
    expect(isEphemeral(response)).toBe(true);
    expect(channel.roleCalls).toEqual([{ kind: "add", guildId: GUILD_ID, userId: ALICE, roleId: KMU_ROLE }]);
  });

  it("すでにチームのロールを持っている人が、ほかのチームのボタンを押しても、変わらない（付けも外しもしない）", async () => {
    const response = await press(roleSet, `role-set:${seeded.utId}`, [KMU_ROLE]);

    expect(contentOf(response)).toBe(`すでに <@&${KMU_ROLE}> のロールを持っているため、変えられません。変えるときは、先に「今のロールを外す」を押してください`);
    expect(channel.roleCalls).toEqual([]);
  });

  it("同じチームのボタンを押しても、何も起きない（「すでに持っています」）", async () => {
    const response = await press(roleSet, `role-set:${seeded.kmuId}`, [KMU_ROLE]);

    expect(contentOf(response)).toBe(`すでに <@&${KMU_ROLE}> のロールを持っています`);
    expect(channel.roleCalls).toEqual([]);
  });

  it("削除されたチームのボタンは、「登録されていません」と返す", async () => {
    const response = await press(roleSet, "role-set:999", []);

    expect(contentOf(response)).toBe("そのチームは、登録されていません（削除されました）");
    expect(channel.roleCalls).toEqual([]);
  });

  it("Discord が拒否したら（権限・ロールの位置）、運営に確認してもらうよう返す", async () => {
    channel.failRoles(403);

    const response = await press(roleSet, `role-set:${seeded.kmuId}`, []);

    expect(contentOf(response)).toContain("ボットの「ロールの管理」の権限と、ボットのロールの位置");
  });

  it("custom_id が壊れているとき・サーバー外のときは、無効として返す", async () => {
    expect(contentOf(await press(roleSet, "role-set:abc", []))).toBe("この操作は無効です");
    expect(contentOf(await run(roleSet, { customId: `role-set:${seeded.kmuId}`, guildId: null }))).toBe("サーバー内で実行してください");
    expect(channel.roleCalls).toEqual([]);
  });
});

describe("今のロールを外す（role-remove）", () => {
  it("持っているチームのロールを外す", async () => {
    const response = await press(roleRemove, "role-remove", [KMU_ROLE, "900000000000000001"]);

    expect(contentOf(response)).toBe(`<@&${KMU_ROLE}> のロールを外しました`);
    expect(isEphemeral(response)).toBe(true);
    expect(channel.roleCalls).toEqual([{ kind: "remove", guildId: GUILD_ID, userId: ALICE, roleId: KMU_ROLE }]);
  });

  it("外したあとは、ほかのチームのボタンで付けられる（付け替えの流れ）", async () => {
    await press(roleRemove, "role-remove", [KMU_ROLE]);

    const response = await press(roleSet, `role-set:${seeded.utId}`, []);

    expect(contentOf(response)).toBe(`<@&${UT_ROLE}> のロールを付けました`);
    expect(channel.roleCalls.map((call) => [call.kind, call.roleId])).toEqual([["remove", KMU_ROLE], ["add", UT_ROLE]]);
  });

  it("チームのロールを持っていなければ、何もしない", async () => {
    expect(contentOf(await press(roleRemove, "role-remove", []))).toBe("チームのロールを持っていません");
    expect(channel.roleCalls).toEqual([]);
  });

  it("Discord が拒否したら、運営に確認してもらうよう返す", async () => {
    channel.failRoles(403);

    expect(contentOf(await press(roleRemove, "role-remove", [KMU_ROLE]))).toContain("ボットの「ロールの管理」の権限");
  });
});

describe("ロールを確認（role-check）", () => {
  it("持っているチームのロールを返す。何も変えない", async () => {
    const response = await press(roleCheck, "role-check", [UT_ROLE]);

    expect(contentOf(response)).toBe(`いまのチームは、<@&${UT_ROLE}> です`);
    expect(isEphemeral(response)).toBe(true);
    expect(channel.roleCalls).toEqual([]);
  });

  it("チームのロールを持っていなければ、ボタンを押すよう案内する", async () => {
    expect(contentOf(await press(roleCheck, "role-check", []))).toBe("チームのロールを持っていません。自分のチームのボタンを押してください");
  });

  it("複数のチームのロールを持っていれば、その旨と、外してから選び直すよう案内する", async () => {
    const response = await press(roleCheck, "role-check", [KMU_ROLE, UT_ROLE]);

    expect(contentOf(response)).toContain("複数のチームのロールを持っています");
    expect(contentOf(response)).toContain("「今のロールを外す」で外してから");
  });

  it("削除したチームのロールは、チームとして数えない", async () => {
    const third = await createTeam(seeded.db, { guildId: GUILD_ID, roleId: "r9", createdAt: 1 });
    const { deleteTeam } = await import("@uc/db");
    await deleteTeam(seeded.db, GUILD_ID, third, 2);

    expect(contentOf(await press(roleCheck, "role-check", ["r9"]))).toContain("チームのロールを持っていません");
  });
});

