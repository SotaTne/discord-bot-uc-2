import { fixedClock, hostTeamOf } from "@uc/core";
import { addMatch, createHandup, createTeam, defaultGuildSettings, ensureHandup, listMatchedSlots, saveGuildSettings, withdrawHandup } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { GUILD_ID, KMU_ROLE, UT_ROLE, createSeededDb, jst } from "../test-helpers";
import { runScheduled } from "./run";

type Seeded = Awaited<ReturnType<typeof createSeededDb>>;
type Posted = { channelId: string; content: string; allowedMentions: unknown };

let seeded: Seeded;
let posted: Posted[];
let failNext = 0;
const CHANNEL = "300000000000000001";

/** 組分けの 1 行（主催つき）。主催は、日付・時刻・2 チームから、計算で決まる */
const pairLine = (a: { id: number; role: string }, b: { id: number; role: string }) => {
  const host = hostTeamOf({ slotDate: "2026-10-07", slotHour: 21, teamAId: a.id, teamBId: b.id });
  return `- <@&${a.role}> vs <@&${b.role}>（主催: <@&${host === a.id ? a.role : b.role}>）`;
};

const rest = {
  async createMessage(channelId: string, payload: { content?: string; allowed_mentions?: unknown }) {
    if (failNext > 0) {
      failNext -= 1;
      throw new Error("Discord が応答しません");
    }
    posted.push({ channelId, content: payload.content ?? "", allowedMentions: payload.allowed_mentions });
    return { id: String(posted.length) };
  },
};

beforeEach(async () => {
  seeded = await createSeededDb();
  posted = [];
  failNext = 0;
  await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL }, 1);
});

const tick = (at: string) => runScheduled({ db: seeded.db, rest, clock: fixedClock(jst(at)) });

/** チームを増やして、挙手させる（挙手の順に createdAt が増える） */
async function raise(teamName: string, roleId: string, slotHour: number, createdAt: number) {
  const teamId = await seeded.db.query.teams
    .findFirst({ where: (t, { eq }) => eq(t.roleId, roleId) })
    .then((t) => t?.id);
  if (teamId === undefined) throw new Error(`team not found: ${teamName}`);
  await createHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour, teamId, raisedBy: "u", createdAt });
}

describe("募集開始", () => {
  it("募集開始の時刻になると、設定したチャンネルに投稿する（通知はしない）", async () => {
    const summary = await tick("2026-10-07T12:00:00");

    expect(summary.ran).toEqual(["recruit:2026-10-07:12"]);
    expect(posted).toEqual([
      { channelId: CHANNEL, content: "# 12:00になりましたので、本日の募集を開始します", allowedMentions: { parse: [], roles: [] } },
    ]);
  });

  describe("通知先（設定）", () => {
    const withMention = (recruitMentionMode: "none" | "teams" | "roles", recruitMentionTargets: string[] = []) =>
      saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL, recruitMentionMode, recruitMentionTargets }, 2);

    it("チーム全て: 登録済みのチームのロールに、通知する", async () => {
      await withMention("teams");
      await tick("2026-10-07T12:00:00");

      expect(posted).toEqual([
        {
          channelId: CHANNEL,
          content: `<@&${KMU_ROLE}> <@&${UT_ROLE}>\n# 12:00になりましたので、本日の募集を開始します`,
          allowedMentions: { parse: [], roles: [KMU_ROLE, UT_ROLE] },
        },
      ]);
    });

    it("ロールを選ぶ: 選んだロールと @here に、通知する", async () => {
      await withMention("roles", ["200000000000000099", "here"]);
      await tick("2026-10-07T12:00:00");

      expect(posted[0]).toMatchObject({
        content: "@here <@&200000000000000099>\n# 12:00になりましたので、本日の募集を開始します",
        allowedMentions: { parse: ["everyone"], roles: ["200000000000000099"] },
      });
    });

    it("ロールを選ぶ（選んだものがない）・なし: 誰にも通知しない（チームのロールを持っていても）", async () => {
      await withMention("roles", []);
      await tick("2026-10-07T12:00:00");
      expect(posted[0]).toMatchObject({ content: "# 12:00になりましたので、本日の募集を開始します", allowedMentions: { parse: [], roles: [] } });
    });
  });

  it("募集開始の時刻を変えると、新しい時刻で、もう一度、投稿する（同じ時刻では、1 日 1 回）", async () => {
    await tick("2026-10-07T12:00:00");
    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL, recruitHour: 13 }, 2);

    expect((await tick("2026-10-07T12:30:00")).ran).toEqual([]);
    expect((await tick("2026-10-07T13:00:00")).ran).toEqual(["recruit:2026-10-07:13"]);
    expect((await tick("2026-10-07T13:01:00")).ran).toEqual([]);
    expect(posted.map((post) => post.content)).toEqual([
      "# 12:00になりましたので、本日の募集を開始します",
      "# 13:00になりましたので、本日の募集を開始します",
    ]);
  });

  it("毎分呼ばれても、1日1回しか投稿しない", async () => {
    await tick("2026-10-07T12:00:00");
    await tick("2026-10-07T12:01:00");
    await tick("2026-10-07T12:30:00");

    expect(posted).toHaveLength(1);
  });

  it("時刻の前には投稿しない。猶予（1時間）を過ぎたら、もう投稿しない", async () => {
    await tick("2026-10-07T11:59:00");
    await tick("2026-10-07T13:00:00");

    expect(posted).toEqual([]);
  });

  it("cron が少し遅れても、猶予のあいだなら投稿される", async () => {
    await tick("2026-10-07T12:20:00");

    expect(posted).toHaveLength(1);
  });

  it("日が変われば、翌日の分をまた投稿する", async () => {
    await tick("2026-10-07T12:00:00");
    await tick("2026-10-08T12:00:00");

    expect(posted).toHaveLength(2);
  });

  it("募集開始の時刻は、サーバーの設定に従う", async () => {
    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL, recruitHour: 9 }, 2);

    await tick("2026-10-07T12:00:00");
    expect(posted).toEqual([]);
    await tick("2026-10-07T09:00:00");
    expect(posted[0]?.content).toBe("# 9:00になりましたので、本日の募集を開始します");
  });

  it("投稿先のチャンネルが未設定のサーバーは、何もしない", async () => {
    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: null }, 2);

    expect((await tick("2026-10-07T12:00:00")).ran).toEqual([]);
    expect(posted).toEqual([]);
  });
});

describe("試合の K 分前の締切とマッチング", () => {
  it("締切の時刻になると、マッチングを確定して保存し、結果を投稿する（チームに通知する）", async () => {
    await raise("KMU", KMU_ROLE, 21, 100);
    await raise("UT", UT_ROLE, 21, 200);

    const summary = await tick("2026-10-07T20:53:00");

    expect(summary.ran).toEqual(["cutoff:2026-10-07:21"]);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.content).toBe(
      ["## 試合 (時間:21時) の組分け:", pairLine({ id: seeded.kmuId, role: KMU_ROLE }, { id: seeded.utId, role: UT_ROLE })].join("\n"),
    );
    expect(posted[0]?.allowedMentions).toEqual({ parse: ["roles"] });

    const rounds = await listMatchedSlots(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07" });
    expect(rounds).toMatchObject([
      { slotHour: 21, excludedTeamId: null, pairs: [{ teamAId: seeded.kmuId, teamBId: seeded.utId }] },
    ]);
  });

  it("締切の前には確定しない", async () => {
    await raise("KMU", KMU_ROLE, 21, 100);
    await raise("UT", UT_ROLE, 21, 200);

    await tick("2026-10-07T20:52:59");

    expect(posted).toEqual([]);
    expect(await listMatchedSlots(seeded.db, { guildId: GUILD_ID })).toEqual([]);
  });

  it("毎分呼ばれても、1回しか確定・投稿しない", async () => {
    await raise("KMU", KMU_ROLE, 21, 100);
    await raise("UT", UT_ROLE, 21, 200);

    await tick("2026-10-07T20:53:00");
    await tick("2026-10-07T20:54:00");
    await tick("2026-10-07T21:10:00");

    expect(posted).toHaveLength(1);
    expect(await listMatchedSlots(seeded.db, { guildId: GUILD_ID })).toHaveLength(1);
  });

  it("取り消された挙手は、マッチングに含めない", async () => {
    await raise("KMU", KMU_ROLE, 21, 100);
    await raise("UT", UT_ROLE, 21, 200);
    await withdrawHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: seeded.utId });

    await tick("2026-10-07T20:53:00");

    expect(posted[0]?.content).toBe("## 試合 (時間:21時)\n試合に参加するチームが十分ではありません");
    const [round] = await listMatchedSlots(seeded.db, { guildId: GUILD_ID });
    expect(round).toMatchObject({ pairs: [], excludedTeamId: seeded.kmuId });
  });

  it("挙手がなくても、その旨を投稿して、結果（空）を保存する", async () => {
    await tick("2026-10-07T20:53:00");

    expect(posted[0]?.content).toContain("十分ではありません");
    expect(await listMatchedSlots(seeded.db, { guildId: GUILD_ID })).toMatchObject([{ slotHour: 21, pairs: [], excludedTeamId: null }]);
  });

  it("対戦枠ごとに別々の締切で確定する", async () => {
    await raise("KMU", KMU_ROLE, 22, 100);
    await raise("UT", UT_ROLE, 22, 200);

    await tick("2026-10-07T20:53:00");
    await tick("2026-10-07T21:53:00");

    expect(posted.map((p) => p.content.split("\n")[0])).toEqual([
      "## 試合 (時間:21時)",
      "## 試合 (時間:22時) の組分け:",
    ]);
  });

  it("試合開始から30分を過ぎたら、もう確定しない", async () => {
    await raise("KMU", KMU_ROLE, 21, 100);
    await raise("UT", UT_ROLE, 21, 200);

    await tick("2026-10-07T21:30:00");

    expect(posted.filter((p) => p.content.includes("21時"))).toEqual([]);
  });

  it("締切の分数は、サーバーの設定に従う", async () => {
    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL, cutoffMinutes: 30 }, 2);

    await tick("2026-10-07T20:29:00");
    expect(posted).toEqual([]);
    await tick("2026-10-07T20:30:00");
    expect(posted).toHaveLength(1);
  });
});

describe("管理者が追加した組分けと、自動のマッチング", () => {
  /** チームを2つ増やして、(NGT, ITF) の ID を返す */
  async function moreTeams() {
    const ngt = await createTeam(seeded.db, { guildId: GUILD_ID, roleId: "r-ngt", createdAt: 1 });
    const itf = await createTeam(seeded.db, { guildId: GUILD_ID, roleId: "r-itf", createdAt: 1 });
    return { ngt, itf };
  }
  const raiseTeam = (teamId: number, createdAt: number) =>
    createHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId, raisedBy: "u", createdAt });
  const manual = (teamAId: number, teamBId: number) =>
    addMatch(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamAId, teamBId, createdAt: 1 });

  it("管理者の組分けは残り、そのチームは自動のマッチングに使わない。残りのチームで組む。投稿には、全部の組分けが入る", async () => {
    const { ngt, itf } = await moreTeams();
    await manual(seeded.kmuId, seeded.utId);
    await ensureHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: seeded.kmuId, raisedBy: "admin", createdAt: 1 });
    await ensureHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: seeded.utId, raisedBy: "admin", createdAt: 1 });
    await raiseTeam(ngt, 10);
    await raiseTeam(itf, 20);

    await tick("2026-10-07T20:53:00");

    const [slot] = await listMatchedSlots(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07" });
    expect(slot?.pairs.map((pair) => [pair.teamAId, pair.teamBId])).toEqual([[seeded.kmuId, seeded.utId], [ngt, itf]]);
    expect(posted[0]?.content).toBe(
      [
        "## 試合 (時間:21時) の組分け:",
        pairLine({ id: seeded.kmuId, role: KMU_ROLE }, { id: seeded.utId, role: UT_ROLE }),
        pairLine({ id: ngt, role: "r-ngt" }, { id: itf, role: "r-itf" }),
      ].join("\n"),
    );
  });

  it("残りのチームが1つなら、除外にする。管理者の組分けは、そのまま", async () => {
    const { ngt } = await moreTeams();
    await manual(seeded.kmuId, seeded.utId);
    await raiseTeam(ngt, 10);

    await tick("2026-10-07T20:53:00");

    const [slot] = await listMatchedSlots(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07" });
    expect(slot).toMatchObject({ excludedTeamId: ngt });
    expect(slot?.pairs).toHaveLength(1);
    expect(posted[0]?.content).toContain("<@&r-ngt> は参加チーム数が奇数だったためマッチングしませんでした");
  });

  it("管理者の組分けだけで、ほかの挙手がなくても、「参加チームが十分ではありません」にはならない", async () => {
    await manual(seeded.kmuId, seeded.utId);

    await tick("2026-10-07T20:53:00");

    expect(posted[0]?.content).toBe(
      ["## 試合 (時間:21時) の組分け:", pairLine({ id: seeded.kmuId, role: KMU_ROLE }, { id: seeded.utId, role: UT_ROLE })].join("\n"),
    );
  });

  it("投稿に失敗してやり直しても、組分けは重複しない。勝利が紐づいた組分けの ID も、変わらない", async () => {
    const { ngt, itf } = await moreTeams();
    await raiseTeam(ngt, 10);
    await raiseTeam(itf, 20);
    failNext = 1;

    await tick("2026-10-07T20:53:00");
    const before = (await listMatchedSlots(seeded.db, { guildId: GUILD_ID }))[0]?.pairs;
    await tick("2026-10-07T20:54:00");

    const after = (await listMatchedSlots(seeded.db, { guildId: GUILD_ID }))[0]?.pairs;
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });
});

describe("失敗したとき", () => {
  it("投稿に失敗したら、次の cron でやり直す（結果は重複しない）", async () => {
    await raise("KMU", KMU_ROLE, 21, 100);
    await raise("UT", UT_ROLE, 21, 200);

    failNext = 1;
    const first = await tick("2026-10-07T20:53:00");
    expect(first.ran).toEqual([]);
    expect(first.errors[0]).toContain("cutoff:2026-10-07:21");
    expect(posted).toEqual([]);

    const second = await tick("2026-10-07T20:54:00");
    expect(second.ran).toEqual(["cutoff:2026-10-07:21"]);
    expect(posted).toHaveLength(1);
    expect(await listMatchedSlots(seeded.db, { guildId: GUILD_ID })).toHaveLength(1);
  });

  it("募集開始の投稿に失敗しても、同じ tick の締切のジョブは続けて実行する", async () => {
    // 募集開始（20:00 から 30 分）と締切（試合の 40 分前 = 20:20 から）が重なる設定
    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL, recruitHour: 20, cutoffMinutes: 40 }, 2);
    await raise("KMU", KMU_ROLE, 21, 100);
    await raise("UT", UT_ROLE, 21, 200);

    failNext = 1;
    const summary = await tick("2026-10-07T20:20:00");

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain("recruit:2026-10-07:20");
    expect(summary.ran).toEqual(["cutoff:2026-10-07:21"]);
  });
});

describe("期限切れのログインリンク・セッションの掃除", () => {
  it("毎時0分の tick で、期限切れのものを消す。有効なものは残す", async () => {
    const { createDashboardLink, createSession, findActiveSession, consumeDashboardLink } = await import("@uc/db");
    const at = jst("2026-10-07T15:00:00").getTime();
    await createDashboardLink(seeded.db, { tokenHash: "old", guildId: GUILD_ID, issuedBy: "a", expiresAt: at - 1, createdAt: 0 });
    await createSession(seeded.db, { sessionHash: "alive", guildId: GUILD_ID, userId: "a", userAgent: null, createdAt: 0, expiresAt: at + 1000 });
    await createSession(seeded.db, { sessionHash: "dead", guildId: GUILD_ID, userId: "a", userAgent: null, createdAt: 0, expiresAt: at - 1 });

    await tick("2026-10-07T15:00:00");

    expect(await seeded.db.query.dashboardLinks.findMany()).toEqual([]);
    expect(await seeded.db.query.sessions.findMany()).toHaveLength(1);
    expect(await findActiveSession(seeded.db, "alive", at)).toBeDefined();
    expect(await consumeDashboardLink(seeded.db, "old", 0)).toBeNull();
  });

  it("0分以外の tick では、掃除しない", async () => {
    const { createSession } = await import("@uc/db");
    const at = jst("2026-10-07T15:01:00").getTime();
    await createSession(seeded.db, { sessionHash: "dead", guildId: GUILD_ID, userId: "a", userAgent: null, createdAt: 0, expiresAt: at - 1 });

    await tick("2026-10-07T15:01:00");

    expect(await seeded.db.query.sessions.findMany()).toHaveLength(1);
  });
});
