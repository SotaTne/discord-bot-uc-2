import { createHandup, defaultGuildSettings, saveGuildSettings } from "@uc/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { AppEnv } from "../env";
import { ALICE, GUILD_ID, createFakeR2, createSeededDb, jst } from "../test-helpers";

const SECRET = "cron-secret-for-test";
let seeded: Awaited<ReturnType<typeof createSeededDb>>;
let env: AppEnv;
const clock = { now: () => jst("2026-10-07T12:00:00") };

const post = (headers: Record<string, string> = { Authorization: `Bearer ${SECRET}` }) =>
  createApp({ clock }).request("/cron", { method: "POST", headers }, env);

beforeEach(async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "1" })));
  seeded = await createSeededDb();
  env = { DB: seeded.db.$client, SCREENSHOTS: createFakeR2().bucket, DISCORD_BOT_TOKEN: "t", DISCORD_API_BASE: "http://discord.mock/api/v10", CRON_SECRET: SECRET } as AppEnv;
});

describe("POST /cron（外のタイマーが、毎分呼ぶ入口）", () => {
  it("合言葉が合えば、cron と同じ処理を行って、結果を返す。時刻が来ていなければ、何も行わない", async () => {
    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: "123456789012345678" }, 1);
    // 12:00 は、募集開始の時刻。1 回目は、募集の投稿を行う
    const first = await post();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ran: ["recruit:2026-10-07"], errors: [] });
    // 2 回目（同じ分に、もう一度呼ばれても）は、二重には行わない
    expect(await (await post()).json()).toEqual({ ran: [], errors: [] });
  });

  it("締切の時刻になっていれば、マッチングも行う", async () => {
    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: "123456789012345678" }, 1);
    await createHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: seeded.kmuId, raisedBy: ALICE, createdAt: 10 });
    await createHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: seeded.utId, raisedBy: ALICE, createdAt: 10 });
    const late = createApp({ clock: { now: () => jst("2026-10-07T20:53:30") } });
    const response = await late.request("/cron", { method: "POST", headers: { Authorization: `Bearer ${SECRET}` } }, env);
    expect(((await response.json()) as { ran: string[] }).ran).toContain("cutoff:2026-10-07:21");
  });

  it("合言葉が違う・ない・メソッドが違うときは、処理を行わない", async () => {
    expect((await post({ Authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post({})).status).toBe(401);
    expect((await createApp({ clock }).request("/cron", { method: "GET", headers: { Authorization: `Bearer ${SECRET}` } }, env)).status).toBe(404);
  });
});
