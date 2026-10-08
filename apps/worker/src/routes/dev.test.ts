import { createHandup, defaultGuildSettings, saveGuildSettings } from "@uc/db";
import { createTestDb } from "@uc/db/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { AppEnv } from "../env";
import { GUILD_ID, createFakeR2, createSeededDb, insertWinInSlot } from "../test-helpers";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
let requests: { url: string; body: unknown }[];

beforeEach(async () => {
  seeded = await createSeededDb();
  await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: "300000000000000001" }, 1);
  requests = [];
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body ?? "null")) });
    return new Response(JSON.stringify({ id: "1" }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tick = (env: Partial<AppEnv>, body: unknown = { now: "2026-10-07T12:00:00+09:00" }) =>
  createApp().request(
    "/dev/tick",
    { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) },
    { DB: seeded.db.$client, DISCORD_API_BASE: "http://mock.local/api/v10", DISCORD_BOT_TOKEN: "t", ...env } as AppEnv,
  );

describe("POST /dev/tick（開発専用）", () => {
  it("DEV_CLOCK が true でなければ、404（本番では使えない）", async () => {
    expect((await tick({})).status).toBe(404);
    expect((await tick({ DEV_CLOCK: "1" })).status).toBe(404);
    expect(requests).toEqual([]);
  });

  it("DEV_CLOCK=true なら、指定した日時で cron の処理を1回実行する", async () => {
    const response = await tick({ DEV_CLOCK: "true" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ran: ["recruit:2026-10-07"], errors: [] });
    expect(requests).toMatchObject([
      {
        url: "http://mock.local/api/v10/channels/300000000000000001/messages",
        body: { content: "# 12:00になりましたので、本日の募集を開始します" },
      },
    ]);
  });

  it("時刻が来ていなければ、何も実行しない", async () => {
    const response = await tick({ DEV_CLOCK: "true" }, { now: "2026-10-07T11:00:00+09:00" });

    expect(await response.json()).toEqual({ ran: [], errors: [] });
    expect(requests).toEqual([]);
  });
});


describe("開発専用: /dev/state・/dev/screenshots・/dev/reset", () => {
  const call = (path: string, env: Partial<AppEnv>, init: RequestInit = {}) =>
    createApp().request(
      path,
      init,
      { DB: seeded.db.$client, SCREENSHOTS: createFakeR2().bucket, ...env } as AppEnv,
    );
  const DEV = { DEV_CLOCK: "true" };

  it("DEV_CLOCK が true でなければ、どれも 404（本番では使えない）", async () => {
    for (const [method, path] of [["GET", "/dev/state"], ["GET", "/dev/screenshots/1"], ["POST", "/dev/reset"]] as const) {
      expect((await call(path, {}, { method })).status).toBe(404);
      expect((await call(path, { DEV_CLOCK: "1" }, { method })).status).toBe(404);
    }
  });

  it("/dev/state は、投稿先を設定した最初のサーバーの状態を返す。guildId で選べる", async () => {
    const response = await call("/dev/state", DEV, { headers: { "X-Dev-Now": "2026-10-07T20:53:00+09:00" } });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { now: string; today: string; slots: number[]; schedule: { key: string; state: string }[] };
    expect(body.today).toBe("2026-10-07");
    expect(body.now).toBe(new Date("2026-10-07T20:53:00+09:00").toISOString());
    expect(body.slots).toEqual([21, 22, 23]);
    expect(body.schedule.find((s) => s.key === "cutoff:2026-10-07:21")?.state).toBe("ready");

    const unknown = await call("/dev/state?guildId=999", DEV);
    expect(((await unknown.json()) as { slots: number[] }).slots).toEqual([]);
  });

  it("/dev/state は、サーバーがまだなければ 404", async () => {
    const empty = createTestDb();
    const response = await createApp().request("/dev/state", {}, { DB: empty.$client, ...DEV } as AppEnv);
    expect(response.status).toBe(404);
  });

  it("/dev/screenshots/:seq は、保存した画像を、ログインなしで返す。画像のないイベントは 404", async () => {
    const r2 = createFakeR2();
    await r2.bucket.put("screenshots/x/a.png", new Uint8Array([1, 2, 3]).buffer, { httpMetadata: { contentType: "image/png" } });
    const withImage = await insertWinInSlot(seeded.db, {
      guildId: GUILD_ID, teamId: seeded.kmuId, slotDate: "2026-10-07", slotHour: 21, points: 1, screenshotKey: "screenshots/x/a.png", recordedBy: "a", createdAt: 1,
    });
    const without = await insertWinInSlot(seeded.db, {
      guildId: GUILD_ID, teamId: seeded.kmuId, slotDate: "2026-10-07", slotHour: 21, points: 1, screenshotKey: null, recordedBy: "a", createdAt: 2,
    });
    const env = { ...DEV, SCREENSHOTS: r2.bucket };

    const ok = await call(`/dev/screenshots/${withImage}`, env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await call(`/dev/screenshots/${without}`, env)).status).toBe(404);
    expect((await call("/dev/screenshots/abc", env)).status).toBe(404);
  });

  it("/dev/reset は、活動の記録を消して、設定・枠・チームは残す", async () => {
    await createHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: seeded.kmuId, raisedBy: "u", createdAt: 1 });
    await insertWinInSlot(seeded.db, {
      guildId: GUILD_ID, teamId: seeded.kmuId, slotDate: "2026-10-07", slotHour: 21, points: 1, screenshotKey: null, recordedBy: "a", createdAt: 1,
    });

    expect((await call("/dev/reset", DEV, { method: "POST" })).status).toBe(200);

    const state = (await (await call("/dev/state", { ...DEV }, { headers: { "X-Dev-Now": "2026-10-07T15:00:00+09:00" } })).json()) as {
      handups: unknown[]; wins: unknown[]; slots: number[]; teams: unknown[];
    };
    expect(state.handups).toEqual([]);
    expect(state.wins).toEqual([]);
    expect(state.slots).toEqual([21, 22, 23]);
    expect(state.teams).toHaveLength(2);
  });
});
