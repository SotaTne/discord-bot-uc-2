import { jstDateOf, recruitJobKey } from "@uc/core";
import { claimJob, defaultGuildSettings, getGuildSettings, saveGuildSettings } from "@uc/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GUILD_ID, KMU_ROLE, UT_ROLE } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

const CHANNEL = "300000000000000001";

let h: ApiHarness;
let cookie: string;
let posts: { content: string; allowedMentions: unknown }[];
let failPosts = false;

/** ハーネスの時計は、2026-10-07 15:00（JST）。チャンネルへの投稿を、記録する */
beforeEach(async () => {
  h = await createApiHarness();
  cookie = await h.login();
  posts = [];
  failPosts = false;
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/messages") && init?.method === "POST") {
      if (failPosts) return new Response("{}", { status: 500 });
      const body = JSON.parse(String(init.body)) as { content: string; allowed_mentions: unknown };
      posts.push({ content: body.content, allowedMentions: body.allowed_mentions });
      return new Response(JSON.stringify({ id: "1" }));
    }
    return base(input, init);
  });
  await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL }, 1);
});

const put = (changes: Record<string, unknown>) =>
  h.json<{ ok: boolean; notified: boolean; notifyFailed: boolean }>("/api/settings", {
    method: "PUT",
    cookie,
    body: { ...defaultGuildSettings, channelId: CHANNEL, ...changes },
  });

describe("PUT /api/settings: 募集開始の時刻・締切の変更の知らせ", () => {
  it("募集開始の時刻を、後ろにずらすと、変更だけを知らせる（募集開始の投稿は、新しい時刻に、cron が出す）", async () => {
    const result = await put({ recruitHour: 20, notifyChange: true });

    expect(result.body).toEqual({ ok: true, notified: true, notifyFailed: false });
    expect(posts).toEqual([{ content: "## 募集開始の時刻が変わりました\n12:00 → 20:00", allowedMentions: { parse: [], roles: [] } }]);
    expect((await getGuildSettings(h.seeded.db, GUILD_ID)).recruitHour).toBe(20);
    // 新しい時刻の募集開始の投稿は、まだ、出していない（cron が、その時刻に出す）
    expect(await claimJob(h.seeded.db, GUILD_ID, recruitJobKey("2026-10-07", 20), 1)).toBe(true);
  });

  it("新しい時刻が、もう来ているとき（いま 15:00 で、13:00 に変更）は、「もう始まっている」と知らせる。この知らせが、募集開始の投稿を兼ねるので、cron は、同じ時刻の投稿を、しない", async () => {
    await put({ recruitHour: 13, notifyChange: true });

    expect(posts[0]?.content).toBe("## 募集開始の時刻が変わりました\n12:00 → 13:00\nすでに募集は始まっています。いまから挙手できます");
    expect(await claimJob(h.seeded.db, GUILD_ID, recruitJobKey(jstDateOf(h.time.now), 13), 1)).toBe(false);
  });

  it("締切の変更も、知らせる。両方変えたときは、1 件にまとめる", async () => {
    await put({ cutoffMinutes: 5, notifyChange: true });
    expect(posts[0]?.content).toBe("## 締切が変わりました\n試合の 7 分前 → 5 分前");

    posts = [];
    await put({ recruitHour: 20, cutoffMinutes: 10, notifyChange: true });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.content).toBe("## 募集開始の時刻が変わりました\n12:00 → 20:00\n\n## 締切が変わりました\n試合の 5 分前 → 10 分前");
  });

  it("通知先は、募集開始の投稿と同じ（チーム全て）。先頭の行に、メンションを出す", async () => {
    await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL, recruitMentionMode: "teams" }, 2);
    await put({ cutoffMinutes: 5, recruitMentionMode: "teams", notifyChange: true });

    expect(posts[0]).toEqual({
      content: `<@&${KMU_ROLE}> <@&${UT_ROLE}>\n## 締切が変わりました\n試合の 7 分前 → 5 分前`,
      allowedMentions: { parse: [], roles: [KMU_ROLE, UT_ROLE] },
    });
  });

  it("通知先は、新しい設定で決まる（ロールを選ぶ・@here）", async () => {
    await put({ cutoffMinutes: 5, recruitMentionMode: "roles", recruitMentionTargets: ["200000000000000099", "here"], notifyChange: true });

    expect(posts[0]).toEqual({
      content: "@here <@&200000000000000099>\n## 締切が変わりました\n試合の 7 分前 → 5 分前",
      allowedMentions: { parse: ["everyone"], roles: ["200000000000000099"] },
    });
  });

  it("知らせない場合: notifyChange がない・false / 変わっていない / 投稿先のチャンネルがない。保存は、される", async () => {
    expect((await put({ recruitHour: 20 })).body).toMatchObject({ notified: false, notifyFailed: false });
    expect((await put({ recruitHour: 21, notifyChange: false })).body).toMatchObject({ notified: false });
    expect((await put({ recruitHour: 21, notifyChange: true })).body).toMatchObject({ notified: false }); // 変わっていない
    expect((await put({ recruitHour: 22, channelId: null, notifyChange: true })).body).toMatchObject({ notified: false });
    expect(posts).toEqual([]);
    expect((await getGuildSettings(h.seeded.db, GUILD_ID)).recruitHour).toBe(22);
  });

  it("通知先や点数だけの変更は、知らせない（募集開始の時刻と締切だけが、参加者の行動に、かかわる）", async () => {
    await put({ fixedPoints: 80, recruitMentionMode: "teams", notifyChange: true });
    expect(posts).toEqual([]);
  });

  it("投稿に失敗しても、保存は取り消さない（notifyFailed で知らせる）。募集開始を兼ねる知らせの権利は、返す（cron が、あとで、出せる）", async () => {
    failPosts = true;
    const result = await put({ recruitHour: 13, notifyChange: true });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, notified: false, notifyFailed: true });
    expect((await getGuildSettings(h.seeded.db, GUILD_ID)).recruitHour).toBe(13);
    expect(await claimJob(h.seeded.db, GUILD_ID, recruitJobKey(jstDateOf(h.time.now), 13), 1)).toBe(true);
  });
});
