import { createTeam, defaultGuildSettings, deleteTeam, getRoleMessageIds, listTeams, saveGuildSettings, setRoleMessageIds } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { ALICE, GUILD_ID, KMU_ROLE, UT_ROLE, createFakeChannel, createSeededDb, type FakeChannel } from "../test-helpers";
import { assignTeamRole, currentTeams, removeTeamRole, syncRoleMessage } from "./role-registration";

const CHANNEL = "300000000000000007";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
let channel: FakeChannel;

beforeEach(async () => {
  seeded = await createSeededDb();
  channel = createFakeChannel();
});

const deps = () => ({ db: seeded.db, rest: channel.rest });
const withRoleChannel = (roleChannelId: string | null = CHANNEL) =>
  saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, roleChannelId }, 1);
const buttonLabels = (components: unknown) => (components as { components: { label: string }[] }[]).map((row) => row.components.map((button) => button.label));
const rowsOf = (components: unknown) => components as { components: { label: string; custom_id: string }[] }[];
const teamButtons = (components: unknown) => rowsOf(components).flatMap((row) => row.components).filter((button) => button.custom_id.startsWith("role-set:"));
/** シード（KMU・UT）に加えて、n チームを登録する。ロール ID は extra-0 から */
const addExtras = async (count: number) => {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) ids.push(await createTeam(seeded.db, { guildId: GUILD_ID, roleId: `extra-${i}`, createdAt: 10 + i }));
  return ids;
};

describe("syncRoleMessage: ロール登録のメッセージ（永続）を、チームの一覧に合わせる", () => {
  it("投稿先のチャンネルが決まっていなければ、何もしない", async () => {
    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("no-channel");

    await withRoleChannel(null);
    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("no-channel");
    expect(channel.posted).toEqual([]);
  });

  it("まだ投稿していなければ、専用のチャンネルに投稿して、メッセージの ID を保存する。通知は、誰にも飛ばさない", async () => {
    await withRoleChannel();

    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("posted");

    expect(channel.posted).toHaveLength(1);
    expect(channel.posted[0]).toMatchObject({ channelId: CHANNEL, allowedMentions: { parse: [] } });
    expect(buttonLabels(channel.posted[0]!.components)).toEqual([["KMU", "UT"], ["今のロールを外す", "ロールを確認"]]);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[0]!.id]);
  });

  it("投稿済みなら、新しく投稿せず、同じメッセージを編集する（チームを増やすと、ボタンが増える）", async () => {
    await withRoleChannel();
    await syncRoleMessage(deps(), GUILD_ID);
    await createTeam(seeded.db, { guildId: GUILD_ID, roleId: "r3", createdAt: 2 });

    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("updated");

    expect(channel.posted).toHaveLength(1);
    expect(channel.edited).toHaveLength(1);
    expect(channel.edited[0]).toMatchObject({ channelId: CHANNEL, messageId: channel.posted[0]!.id });
    expect(buttonLabels(channel.edited[0]!.components)[0]).toEqual(["KMU", "UT", "NGT"]);
  });

  it("チームを削除すると、そのボタンが消える", async () => {
    await withRoleChannel();
    await syncRoleMessage(deps(), GUILD_ID);
    const { deleteTeam } = await import("@uc/db");
    await deleteTeam(seeded.db, GUILD_ID, seeded.utId, 5);

    await syncRoleMessage(deps(), GUILD_ID);

    expect(buttonLabels(channel.edited[0]!.components)[0]).toEqual(["KMU"]);
  });

  it("メッセージが消されていた（404）ら、新しく投稿して、ID を保存し直す", async () => {
    await withRoleChannel();
    await syncRoleMessage(deps(), GUILD_ID);
    channel.failEdit(404);

    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("posted");

    expect(channel.posted).toHaveLength(2);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[1]!.id]);
  });

  it("編集が、404 以外で失敗したら、投稿し直さず、そのまま失敗する（ID は残る。メッセージが、二重にならない）", async () => {
    await withRoleChannel();
    await syncRoleMessage(deps(), GUILD_ID);
    channel.failEdit(500);

    await expect(syncRoleMessage(deps(), GUILD_ID)).rejects.toThrow();

    expect(channel.posted).toHaveLength(1);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[0]!.id]);
  });

  it("投稿先のチャンネルを変えたら、新しいチャンネルに投稿し直す（古いメッセージは、そのまま）", async () => {
    await withRoleChannel();
    await syncRoleMessage(deps(), GUILD_ID);
    await withRoleChannel("300000000000000008");
    channel.failEdit(404); // 新しいチャンネルには、その ID のメッセージがない

    await syncRoleMessage(deps(), GUILD_ID);

    expect(channel.posted.map((message) => message.channelId)).toEqual([CHANNEL, "300000000000000008"]);
    expect(channel.deleted).toEqual([]);
  });

  it("設定を保存し直しても、メッセージの ID は、消えない", async () => {
    await withRoleChannel();
    await syncRoleMessage(deps(), GUILD_ID);

    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, roleChannelId: CHANNEL, cutoffMinutes: 10 }, 9);

    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[0]!.id]);
  });

  it("設定のないサーバーでは、ID を保存しても、何も起きない（エラーにならない）", async () => {
    await setRoleMessageIds(seeded.db, "no-such-guild", ["m1"]);

    expect(await getRoleMessageIds(seeded.db, "no-such-guild")).toEqual([]);
  });

  it("チームが 21 以上なら、20 チームごとにメッセージを分けて投稿する。ID は投稿順。同じチームは、1 つのメッセージにしか出ない。通知は飛ばさない", async () => {
    await withRoleChannel();
    await addExtras(19);

    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("posted");

    expect(channel.posted).toHaveLength(2);
    expect(channel.posted.every((message) => message.channelId === CHANNEL)).toBe(true);
    for (const message of channel.posted) expect(message.allowedMentions).toEqual({ parse: [] });
    expect(teamButtons(channel.posted[0]!.components).map((button) => button.label).slice(0, 2)).toEqual(["KMU", "UT"]);
    expect(teamButtons(channel.posted[0]!.components)).toHaveLength(20);
    expect(teamButtons(channel.posted[1]!.components).map((button) => button.label)).toEqual(["ロール extra-18"]);
    expect(channel.posted[0]!.content).toContain("（1/2）");
    expect(channel.posted[1]!.content).toContain("（2/2）");
    const ids = channel.posted.flatMap((message) => teamButtons(message.components).map((button) => button.custom_id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(21);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual(channel.posted.map((message) => message.id));
  });

  it("すでに 1 つ投稿してある状態で 21 チームになると、1 つ目は編集し、2 つ目だけを新しく投稿する", async () => {
    await withRoleChannel();
    await syncRoleMessage(deps(), GUILD_ID);
    const first = channel.posted[0]!.id;
    await addExtras(19);

    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("updated");

    expect(channel.posted).toHaveLength(2);
    expect(channel.edited.map((message) => message.messageId)).toEqual([first]);
    expect(teamButtons(channel.edited[0]!.components)).toHaveLength(20);
    expect(teamButtons(channel.posted[1]!.components).map((button) => button.label)).toEqual(["ロール extra-18"]);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([first, channel.posted[1]!.id]);
  });

  it("2 つ目のメッセージにチームが残っているあいだは、削除しない（21 チームのままなら、2 つとも編集）", async () => {
    await withRoleChannel();
    const extras = await addExtras(20);
    await syncRoleMessage(deps(), GUILD_ID);
    await deleteTeam(seeded.db, GUILD_ID, extras[0]!, 50);

    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("updated");

    expect(channel.deleted).toEqual([]);
    expect(channel.edited).toHaveLength(2);
    expect(teamButtons(channel.edited[0]!.components)).toHaveLength(20);
    expect(teamButtons(channel.edited[1]!.components)).toHaveLength(1);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[0]!.id, channel.posted[1]!.id]);
  });

  it("20 チーム以下に戻ると、余ったメッセージを削除し、ID からも外す。残ったメッセージは、分けた旨を消して編集する", async () => {
    await withRoleChannel();
    const extras = await addExtras(19);
    await syncRoleMessage(deps(), GUILD_ID);
    await deleteTeam(seeded.db, GUILD_ID, extras.at(-1)!, 50);

    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("updated");

    expect(channel.deleted).toEqual([{ channelId: CHANNEL, messageId: channel.posted[1]!.id }]);
    expect(channel.posted).toHaveLength(2);
    expect(channel.edited.at(-1)!.content).not.toContain("（1/");
    expect(teamButtons(channel.edited.at(-1)!.components)).toHaveLength(20);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[0]!.id]);
  });

  it("チームが 1 つもなくなると、メッセージは 1 つに戻り、チームがない旨を書く", async () => {
    await withRoleChannel();
    await addExtras(19);
    await syncRoleMessage(deps(), GUILD_ID);
    for (const team of await listTeams(seeded.db, GUILD_ID)) await deleteTeam(seeded.db, GUILD_ID, team.id, 50);

    await syncRoleMessage(deps(), GUILD_ID);

    expect(channel.deleted).toEqual([{ channelId: CHANNEL, messageId: channel.posted[1]!.id }]);
    expect(channel.edited.at(-1)!.content).toContain("登録されているチームがありません");
    expect(teamButtons(channel.edited.at(-1)!.components)).toEqual([]);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[0]!.id]);
  });

  it("2 つ目だけ消されていた（404）ら、1 つ目は編集し、2 つ目だけ投稿し直す。1 つ目は、消さない", async () => {
    await withRoleChannel();
    await addExtras(19);
    await syncRoleMessage(deps(), GUILD_ID);
    const [first, second] = channel.posted.map((message) => message.id);
    channel.failEdit(404, second);

    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("updated");

    expect(channel.edited.map((message) => message.messageId)).toEqual([first]);
    expect(channel.deleted).toEqual([]);
    expect(channel.posted).toHaveLength(3);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([first, channel.posted[2]!.id]);
  });

  it("2 つ目の編集が 404 以外で失敗したら、投稿し直さず、ID はそのまま（二重にならない）", async () => {
    await withRoleChannel();
    await addExtras(19);
    await syncRoleMessage(deps(), GUILD_ID);
    channel.failEdit(500, channel.posted[1]!.id);

    await expect(syncRoleMessage(deps(), GUILD_ID)).rejects.toThrow();

    expect(channel.posted).toHaveLength(2);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual(channel.posted.map((message) => message.id));
  });

  it("2 つ目の投稿に失敗したら、1 つ目の ID は残る。やり直したときは、1 つ目を編集し、2 つ目だけを投稿する", async () => {
    await withRoleChannel();
    await syncRoleMessage(deps(), GUILD_ID);
    const first = channel.posted[0]!.id;
    await addExtras(19);
    channel.allowCreates(0);

    await expect(syncRoleMessage(deps(), GUILD_ID)).rejects.toThrow();

    expect(channel.posted).toHaveLength(1);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([first]);

    channel.allowCreates(null);
    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("updated");
    expect(channel.posted).toHaveLength(2);
    expect(channel.edited.map((message) => message.messageId)).toContain(first);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([first, channel.posted[1]!.id]);
  });

  it("21 チームの投稿の途中で 2 つ目が失敗しても、1 つ目の ID は残る。やり直しで、1 つ目を二重に投稿しない", async () => {
    await withRoleChannel();
    await addExtras(19);
    channel.allowCreates(1);

    await expect(syncRoleMessage(deps(), GUILD_ID)).rejects.toThrow();

    const first = channel.posted[0]!.id;
    expect(channel.posted).toHaveLength(1);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([first]);

    channel.allowCreates(null);
    await syncRoleMessage(deps(), GUILD_ID);

    expect(channel.posted).toHaveLength(2);
    expect(channel.edited.map((message) => message.messageId)).toEqual([first]);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([first, channel.posted[1]!.id]);
  });

  it("余ったメッセージが、すでに消されていた（404）ら、ID から外す", async () => {
    await withRoleChannel();
    const extras = await addExtras(19);
    await syncRoleMessage(deps(), GUILD_ID);
    await deleteTeam(seeded.db, GUILD_ID, extras.at(-1)!, 50);
    channel.failDelete(404);

    await syncRoleMessage(deps(), GUILD_ID);

    expect(channel.deleted).toEqual([]);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[0]!.id]);
  });

  it("余ったメッセージの削除が 404 以外で失敗したら、ID を残す。次の更新で、新しく投稿せず、そのメッセージを消し直す", async () => {
    await withRoleChannel();
    const extras = await addExtras(19);
    await syncRoleMessage(deps(), GUILD_ID);
    const [first, second] = channel.posted.map((message) => message.id);
    await deleteTeam(seeded.db, GUILD_ID, extras.at(-1)!, 50);
    channel.failDelete(500);

    await syncRoleMessage(deps(), GUILD_ID);

    expect(channel.posted).toHaveLength(2);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([first, second]);

    channel.failDelete(null);
    await syncRoleMessage(deps(), GUILD_ID);

    expect(channel.posted).toHaveLength(2);
    expect(channel.deleted).toEqual([{ channelId: CHANNEL, messageId: second }]);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([first]);
  });

  it("削除できなかったメッセージは、再び 21 チームになると、消さずに編集して使う", async () => {
    await withRoleChannel();
    const extras = await addExtras(19);
    await syncRoleMessage(deps(), GUILD_ID);
    const [first, second] = channel.posted.map((message) => message.id);
    await deleteTeam(seeded.db, GUILD_ID, extras.at(-1)!, 50);
    channel.failDelete(500);
    await syncRoleMessage(deps(), GUILD_ID);
    channel.failDelete(null);
    await createTeam(seeded.db, { guildId: GUILD_ID, roleId: "extra-again", createdAt: 80 });

    expect(await syncRoleMessage(deps(), GUILD_ID)).toBe("updated");

    expect(channel.posted).toHaveLength(2);
    expect(channel.deleted).toEqual([]);
    expect(channel.edited.map((message) => message.messageId)).toContain(second);
    expect(teamButtons(channel.edited.at(-1)!.components).map((button) => button.label)).toEqual(["ロール extra-again"]);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([first, second]);
  });

  it("投稿先を変えてメッセージが 2 つあっても、古いチャンネルのメッセージは消さず、新しいチャンネルに投稿し直す", async () => {
    await withRoleChannel();
    await addExtras(19);
    await syncRoleMessage(deps(), GUILD_ID);
    await withRoleChannel("300000000000000008");
    channel.failEdit(404);

    await syncRoleMessage(deps(), GUILD_ID);

    expect(channel.deleted).toEqual([]);
    expect(channel.posted.map((message) => message.channelId)).toEqual([CHANNEL, CHANNEL, "300000000000000008", "300000000000000008"]);
    expect(await getRoleMessageIds(seeded.db, GUILD_ID)).toEqual([channel.posted[2]!.id, channel.posted[3]!.id]);
  });
});

describe("assignTeamRole: 「チームのボタン」", () => {
  const assign = (memberRoleIds: string[], teamId = seeded.kmuId) =>
    assignTeamRole(deps(), { guildId: GUILD_ID, userId: ALICE, memberRoleIds, teamId });

  it("チームのロールを持っていない人には、そのチームのロールを付ける（チーム以外のロールは、持っていてよい）", async () => {
    const result = await assign(["900000000000000001"]);

    expect(result).toMatchObject({ kind: "assigned", team: { id: seeded.kmuId } });
    expect(channel.roleCalls).toEqual([{ kind: "add", guildId: GUILD_ID, userId: ALICE, roleId: KMU_ROLE }]);
  });

  it("同じチームのロールを、すでに持っているなら、何もしない", async () => {
    expect(await assign([KMU_ROLE])).toMatchObject({ kind: "already" });
    expect(channel.roleCalls).toEqual([]);
  });

  it("ほかのチームのロールを、すでに持っているなら、変えない（付けも外しもしない）", async () => {
    const result = await assign([UT_ROLE]);

    expect(result).toMatchObject({ kind: "has-other", current: [{ id: seeded.utId }] });
    expect(channel.roleCalls).toEqual([]);
  });

  it("削除されたチームのボタンは、付けない", async () => {
    const { deleteTeam } = await import("@uc/db");
    await deleteTeam(seeded.db, GUILD_ID, seeded.kmuId, 5);

    expect(await assign([])).toEqual({ kind: "team-gone" });
    expect(channel.roleCalls).toEqual([]);
  });

  it("別のサーバーのチームは、付けない", async () => {
    const other = await createTeam(seeded.db, { guildId: "999", roleId: "other-role", createdAt: 1 });

    expect(await assign([], other)).toEqual({ kind: "team-gone" });
  });

  it("Discord が拒否したら（権限・ロールの位置）、failed を返す。例外にしない", async () => {
    channel.failRoles(403);

    expect(await assign([])).toEqual({ kind: "failed" });
  });
});

describe("removeTeamRole: 「今のロールを外す」", () => {
  const remove = (memberRoleIds: string[]) => removeTeamRole(deps(), { guildId: GUILD_ID, userId: ALICE, memberRoleIds });

  it("持っているチームのロールを外す。チーム以外のロールには、触らない", async () => {
    const result = await remove(["900000000000000001", KMU_ROLE]);

    expect(result).toMatchObject({ kind: "removed", teams: [{ id: seeded.kmuId }] });
    expect(channel.roleCalls).toEqual([{ kind: "remove", guildId: GUILD_ID, userId: ALICE, roleId: KMU_ROLE }]);
  });

  it("チームのロールを複数持っているなら、すべて外す", async () => {
    await remove([KMU_ROLE, UT_ROLE]);

    expect(channel.roleCalls.map((call) => call.roleId)).toEqual([KMU_ROLE, UT_ROLE]);
  });

  it("チームのロールを持っていなければ、何もしない", async () => {
    expect(await remove(["900000000000000001"])).toEqual({ kind: "none" });
    expect(channel.roleCalls).toEqual([]);
  });

  it("Discord が拒否したら、failed を返す", async () => {
    channel.failRoles(403);

    expect(await remove([KMU_ROLE])).toEqual({ kind: "failed" });
  });
});

describe("currentTeams: 「ロールを確認」", () => {
  it("持っているロールのうち、登録されているチームのものだけを返す（削除したチームは、含めない）", async () => {
    const { deleteTeam } = await import("@uc/db");
    await deleteTeam(seeded.db, GUILD_ID, seeded.utId, 5);

    expect((await currentTeams(seeded.db, GUILD_ID, [KMU_ROLE, UT_ROLE, "900000000000000001"])).map((team) => team.id)).toEqual([seeded.kmuId]);
    expect((await listTeams(seeded.db, GUILD_ID)).map((team) => team.id)).toEqual([seeded.kmuId]);
  });
});
