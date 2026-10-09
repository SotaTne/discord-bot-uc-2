import { createHandup, defaultGuildSettings, saveGuildSettings } from "@uc/db";
import { createTestDb } from "@uc/db/testing";
import { fixedClock } from "@uc/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { createDevApp } from "./app";
import { devClock, setDevClockState } from "./clock";
import type { AppEnv } from "../env";
import { GUILD_ID, createFakeR2, createSeededDb, insertWinInSlot, jst } from "../test-helpers";

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
  vi.unstubAllEnvs();
  setDevClockState({ offsetMs: 0 });
});

const env = (extra: Partial<AppEnv> = {}) =>
  ({ DB: seeded.db.$client, DISCORD_API_BASE: "http://mock.local/api/v10", DISCORD_BOT_TOKEN: "t", SCREENSHOTS: createFakeR2().bucket, ...extra }) as AppEnv;
/** 時計を、指定した日時に固定した worker に、リクエストする */
const callAt = (at: string, path: string, init: RequestInit = {}, extra: Partial<AppEnv> = {}) =>
  createDevApp({ clock: fixedClock(jst(at)) }).request(path, { headers: { Origin: "http://localhost" }, ...init }, env(extra));

describe("本番の入口（createApp）には、/dev/* が、ない（開発の入口 createDevApp だけが、足す）", () => {
  it("どの /dev/* も、404（ルートが、組み込まれていない）", async () => {
    for (const [method, path] of [["GET", "/dev/state"], ["GET", "/dev/clock"], ["PUT", "/dev/clock"], ["GET", "/dev/screenshots/1"], ["POST", "/dev/reset"]] as const) {
      const response = await createApp({ clock: fixedClock(jst("2026-10-07T12:00:00")) }).request(path, { method, headers: { Origin: "http://localhost" } }, env());
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(requests).toEqual([]);
  });

  it("開発の入口には、ある（同じルートが、200 になる）", async () => {
    expect((await callAt("2026-10-07T12:00:00", "/dev/clock")).status).toBe(200);
  });
});

describe("/dev/clock（疑似時計）", () => {
  const put = (body: unknown) =>
    createDevApp({ clock: devClock(fixedClock(jst("2026-10-07T12:00:00"))) }).request(
      "/dev/clock",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      env(),
    );
  const get = () => createDevApp({ clock: devClock(fixedClock(jst("2026-10-07T12:00:00"))) }).request("/dev/clock", {}, env());

  it("最初は、本物の時計そのもの（ずれ 0）", async () => {
    expect(await (await get()).json()).toEqual({ offsetMs: 0, now: jst("2026-10-07T12:00:00").getTime() });
  });

  it("ずれを設定すると、worker の時計が、その分だけ進む。負なら、戻る", async () => {
    const response = await put({ offsetMs: 9 * 3_600_000 });

    expect(await response.json()).toEqual({ offsetMs: 9 * 3_600_000, now: jst("2026-10-07T21:00:00").getTime() });
    expect(((await (await get()).json()) as { now: number }).now).toBe(jst("2026-10-07T21:00:00").getTime());

    await put({ offsetMs: -3_600_000 });
    expect(((await (await get()).json()) as { now: number }).now).toBe(jst("2026-10-07T11:00:00").getTime());
  });

  it("形が正しくなければ 400（状態は、変わらない）", async () => {
    for (const body of [null, {}, { offsetMs: "1" }, { offsetMs: Number.NaN }, { mode: "paused", at: 1 }]) {
      expect((await put(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await (await get()).json()).toMatchObject({ offsetMs: 0 });
  });
});

describe("開発専用: /dev/state・/dev/screenshots・/dev/reset", () => {
  const call = (path: string, extra: Partial<AppEnv> = {}, init: RequestInit = {}) =>
    callAt("2026-10-07T15:00:00", path, init, extra);

  it("/dev/state は、投稿先を設定した最初のサーバーの状態を返す。guildId で選べる", async () => {
    const response = await callAt("2026-10-07T20:53:00", "/dev/state");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { now: string; today: string; slotHours: number[]; schedule: { key: string; state: string }[] };
    expect(body.today).toBe("2026-10-07");
    expect(body.now).toBe(new Date("2026-10-07T20:53:00+09:00").toISOString());
    expect(body.slotHours).toEqual([21, 22, 23]);
    expect(body.schedule.find((s) => s.key === "cutoff:2026-10-07:21")?.state).toBe("ready");

    const unknown = await call("/dev/state?guildId=999");
    expect(((await unknown.json()) as { slotHours: number[] }).slotHours).toEqual([]);
  });

  it("/dev/state は、サーバーがまだなければ 404", async () => {
    const empty = createTestDb();
    const response = await createApp().request("/dev/state", {}, { DB: empty.$client } as AppEnv);
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
    const env = { SCREENSHOTS: r2.bucket };

    const ok = await call(`/dev/screenshots/${withImage}`, env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await call(`/dev/screenshots/${without}`, env)).status).toBe(404);
    expect((await call("/dev/screenshots/abc", env)).status).toBe(404);
  });

  it("/dev/reset は、活動の記録を消して、設定・対戦枠・チームは残す", async () => {
    await createHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: seeded.kmuId, raisedBy: "u", createdAt: 1 });
    await insertWinInSlot(seeded.db, {
      guildId: GUILD_ID, teamId: seeded.kmuId, slotDate: "2026-10-07", slotHour: 21, points: 1, screenshotKey: null, recordedBy: "a", createdAt: 1,
    });

    expect((await call("/dev/reset", {}, { method: "POST" })).status).toBe(200);

    const state = (await (await call("/dev/state")).json()) as {
      handups: unknown[]; wins: unknown[]; slotHours: number[]; teams: unknown[];
    };
    expect(state.handups).toEqual([]);
    expect(state.wins).toEqual([]);
    expect(state.slotHours).toEqual([21, 22, 23]);
    expect(state.teams).toHaveLength(2);
  });
});
