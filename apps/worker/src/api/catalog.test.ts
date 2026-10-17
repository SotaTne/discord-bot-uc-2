import { createHandup, defaultGuildSettings, getGuildSettings } from "@uc/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUILD_ID, jst } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

let h: ApiHarness;
let cookie: string;
beforeEach(async () => {
  h = await createApiHarness();
  cookie = await h.login();
});

describe("ログインが必要", () => {
  const endpoints: [string, string][] = [
    ["GET", "/api/settings"],
    ["PUT", "/api/settings"],
    ["GET", "/api/roles"],
    ["GET", "/api/slot-hours"],
    ["POST", "/api/slot-hours"],
    ["DELETE", "/api/slot-hours/1"],
    ["GET", "/api/teams"],
    ["POST", "/api/teams"],
    ["DELETE", "/api/teams/1"],
    ["GET", "/api/board"],
    ["POST", "/api/handups"],
    ["DELETE", "/api/handups/1"],
    ["POST", "/api/matches"],
    ["POST", "/api/match-slots/cancel-waiting"],
    ["DELETE", "/api/matches/1"],
    ["GET", "/api/sessions"],
    ["DELETE", "/api/sessions/1"],
    ["POST", "/api/sessions/revoke-all"],
  ];

  it.each(endpoints)("%s %s は、ログインなしでは 401", async (method, path) => {
    const response = await h.call(path, { method });
    expect(response.status).toBe(401);
  });
});

describe("サーバーの設定", () => {
  const valid = {
    channelId: "300000000000000001",
    roleChannelId: "300000000000000002",
    recruitHour: 10,
    cutoffMinutes: 15,
    recruitMentionMode: "roles" as const,
    recruitMentionTargets: ["200000000000000099", "here"],
    matchLimit: 8,
    revokeSessionsOnReissue: true,
  };

  it("未設定なら既定値を返す", async () => {
    expect((await h.json("/api/settings", { cookie })).body).toEqual(defaultGuildSettings);
  });

  it("保存した設定を読み出せる", async () => {
    expect((await h.json("/api/settings", { method: "PUT", cookie, body: valid })).status).toBe(200);

    expect((await h.json("/api/settings", { cookie })).body).toEqual(valid);
    expect(await getGuildSettings(h.seeded.db, GUILD_ID)).toEqual(valid);
  });

  it("不正な値（締切が0分・チャンネル ID の形式違い・時が範囲外・通知先の形式違い）は 400 で、保存しない", async () => {
    for (const bad of [
      { ...valid, cutoffMinutes: 0 },
      { ...valid, channelId: "abc" },
      { ...valid, recruitHour: 24 },
      { ...valid, recruitMentionTargets: ["everyone"] },
    ]) {
      expect((await h.json("/api/settings", { method: "PUT", cookie, body: bad })).status).toBe(400);
    }
    expect(await getGuildSettings(h.seeded.db, GUILD_ID)).toEqual(defaultGuildSettings);
  });

  it("Origin がなければ、保存できない", async () => {
    expect((await h.json("/api/settings", { method: "PUT", cookie, origin: null, body: valid })).status).toBe(403);
  });
});

describe("試合時刻", () => {
  it("一覧できる（シード: 21・22・23 時）", async () => {
    const { body } = await h.json<{ slotHours: { hour: number }[] }>("/api/slot-hours", { cookie });
    expect(body.slotHours.map((s) => s.hour)).toEqual([21, 22, 23]);
  });

  it("追加できる。同じ時刻は 409。範囲外は 400", async () => {
    expect((await h.json("/api/slot-hours", { method: "POST", cookie, body: { hour: 20 } })).status).toBe(201);
    expect((await h.json("/api/slot-hours", { method: "POST", cookie, body: { hour: 20 } })).status).toBe(409);
    expect((await h.json("/api/slot-hours", { method: "POST", cookie, body: { hour: 24 } })).status).toBe(400);

    const { body } = await h.json<{ slotHours: { hour: number }[] }>("/api/slot-hours", { cookie });
    expect(body.slotHours.map((s) => s.hour)).toEqual([20, 21, 22, 23]);
  });

  it("削除できる。存在しなければ 404。ID が不正なら 400", async () => {
    const { body } = await h.json<{ slotHours: { id: number; hour: number }[] }>("/api/slot-hours", { cookie });
    const slot = body.slotHours[0]!;

    expect((await h.json(`/api/slot-hours/${slot.id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await h.json(`/api/slot-hours/${slot.id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await h.json("/api/slot-hours/abc", { method: "DELETE", cookie })).status).toBe(400);
  });
});

describe("チーム: ロール登録のメッセージ（永続）の更新", () => {
  const ROLE_CHANNEL = "300000000000000002";
  const team = { roleId: "400000000000000003" };
  /** Discord への、メッセージの投稿・編集の呼び出し（ロール一覧は、ロール名のため、返す） */
  let calls: { method: string; url: string; body: { content?: string; components?: { components: { label: string }[] }[] } }[];
  let failNext: number | null;

  beforeEach(async () => {
    calls = [];
    failNext = null;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/roles")) {
        return new Response(JSON.stringify([{ id: "400000000000000001", name: "KMU", position: 1 }, { id: "400000000000000002", name: "UT", position: 2 }, { id: "400000000000000003", name: "NGT", position: 3 }]));
      }
      calls.push({ method, url, body: JSON.parse(String(init?.body ?? "{}")) });
      if (failNext !== null) return new Response("{}", { status: failNext });
      return new Response(JSON.stringify({ id: "msg-1" }));
    });
    const { saveGuildSettings } = await import("@uc/db");
    await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, roleChannelId: ROLE_CHANNEL }, 1);
  });

  const labels = (call: (typeof calls)[number]) => call.body.components?.[0]?.components.map((button) => button.label);

  it("チームを追加すると、ロール登録のメッセージが、新しく投稿される（ボタンに、追加したチームがある）。2 回目からは、編集", async () => {
    await h.json("/api/teams", { method: "POST", cookie, body: team });

    expect(calls.map((call) => call.method)).toEqual(["POST"]);
    expect(calls[0]!.url).toContain(`/channels/${ROLE_CHANNEL}/messages`);
    expect(labels(calls[0]!)).toEqual(["KMU", "UT", "NGT"]);
  });

  it("チームを削除すると、そのチームのボタンが消える（同じメッセージを、編集する）", async () => {
    const { setRoleMessageIds } = await import("@uc/db");
    await setRoleMessageIds(h.seeded.db, GUILD_ID, ["msg-1"]);

    const response = await h.json(`/api/teams/${h.seeded.utId}`, { method: "DELETE", cookie });

    expect(response.status).toBe(200);
    expect(calls.map((call) => call.method)).toEqual(["PATCH"]);
    expect(calls[0]!.url).toContain(`/channels/${ROLE_CHANNEL}/messages/msg-1`);
    expect(labels(calls[0]!)).toEqual(["KMU"]);
  });

  it("投稿先が決まっていなければ、Discord には、何も送らない", async () => {
    const { saveGuildSettings } = await import("@uc/db");
    await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings }, 2);

    await h.json("/api/teams", { method: "POST", cookie, body: team });

    expect(calls).toEqual([]);
  });

  it("メッセージの更新に失敗しても、チームの追加・削除は成功する（取り消さない）", async () => {
    failNext = 500;

    const added = await h.json<{ id: number }>("/api/teams", { method: "POST", cookie, body: team });
    const removed = await h.json(`/api/teams/${added.body.id}`, { method: "DELETE", cookie });

    expect(added.status).toBe(201);
    expect(removed.status).toBe(200);
  });

  it("存在しないチームの削除（404）や、重複した追加（409）では、メッセージを更新しない", async () => {
    await h.json("/api/teams/9999", { method: "DELETE", cookie });
    await h.json("/api/teams", { method: "POST", cookie, body: { roleId: "400000000000000001" } });

    expect(calls).toEqual([]);
  });
});

describe("チーム", () => {
  const team = { roleId: "400000000000000003" };

  it("一覧に、各チームの試合数（そのチームが入った組分けの数）が付く。組まれていないチームは 0。/uc-teams と同じ数", async () => {
    const { saveMatchResult } = await import("@uc/db");
    await saveMatchResult(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-06", slotHour: 21, excludedTeamId: null, pairs: [[h.seeded.kmuId, h.seeded.utId]], now: 1 });
    await saveMatchResult(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[h.seeded.kmuId, h.seeded.utId]], now: 1 });
    const third = await h.json<{ id: number }>("/api/teams", { method: "POST", cookie, body: team });

    const { body } = await h.json<{ teams: { id: number; matchCount: number }[] }>("/api/teams", { cookie });

    expect(body.teams.map((t) => [t.id, t.matchCount])).toEqual([[h.seeded.kmuId, 2], [h.seeded.utId, 2], [third.body.id, 0]]);
  });

  it("一覧に、規定数と、各チームの超過が付く（規定数なしなら null・超過なし）", async () => {
    const { saveMatchResult, saveGuildSettings, defaultGuildSettings } = await import("@uc/db");
    type Body = { teams: { id: number; matchOver: boolean }[]; matchLimit: number | null };
    const third = await h.json<{ id: number }>("/api/teams", { method: "POST", cookie, body: team });
    expect((await h.json<Body>("/api/teams", { cookie })).body).toMatchObject({ matchLimit: null });

    await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, matchLimit: 1 }, 1);
    await saveMatchResult(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-06", slotHour: 21, excludedTeamId: null, pairs: [[h.seeded.kmuId, h.seeded.utId]], now: 1 });
    await saveMatchResult(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[h.seeded.kmuId, third.body.id]], now: 1 });
    const { body } = await h.json<Body>("/api/teams", { cookie });

    expect(body.matchLimit).toBe(1);
    expect(body.teams.map((t) => [t.id, t.matchOver])).toEqual([[h.seeded.kmuId, true], [h.seeded.utId, false], [third.body.id, false]]);
  });

  it("一覧できる。表示名は、ロールの名前（シード: KMU・UT）", async () => {
    const { body } = await h.json<{ teams: { name: string; roleId: string }[] }>("/api/teams", { cookie });
    expect(body.teams.map((t) => [t.name, t.roleId])).toEqual([["KMU", "400000000000000001"], ["UT", "400000000000000002"]]);
  });

  it("ロールの名前を Discord から取れないとき、ロールが消されたときは、ロールの ID で表す", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const failed = await h.json<{ teams: { name: string }[] }>("/api/teams", { cookie });
    expect(failed.body.teams.map((t) => t.name)).toEqual(["ロール 400000000000000001", "ロール 400000000000000002"]);

    vi.stubGlobal("fetch", async () => new Response(JSON.stringify([{ id: "400000000000000001", name: "KMU", position: 1 }])));
    const deleted = await h.json<{ teams: { name: string }[] }>("/api/teams", { cookie });
    expect(deleted.body.teams.map((t) => t.name)).toEqual(["KMU", "ロール 400000000000000002"]);
  });

  it("ロールだけで追加できる。同じロールは 409。ロールが不正なら 400", async () => {
    expect((await h.json("/api/teams", { method: "POST", cookie, body: team })).status).toBe(201);
    expect((await h.json("/api/teams", { method: "POST", cookie, body: team })).status).toBe(409);
    expect((await h.json("/api/teams", { method: "POST", cookie, body: { roleId: "abc" } })).status).toBe(400);
    expect((await h.json("/api/teams", { method: "POST", cookie, body: {} })).status).toBe(400);
  });

  it("削除できる。存在しなければ 404", async () => {
    const created = await h.json<{ id: number }>("/api/teams", { method: "POST", cookie, body: team });

    expect((await h.json(`/api/teams/${created.body.id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await h.json(`/api/teams/${created.body.id}`, { method: "DELETE", cookie })).status).toBe(404);
  });

  it("使われているチームも削除できる（論理削除）。一覧から消え、まだ組まれていない対戦枠の挙手は取り消される。組分けの名前は、履歴に残る", async () => {
    const { db, kmuId, utId } = h.seeded;
    await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: kmuId, raisedBy: "u", createdAt: 1 });
    await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 22, teamId: kmuId, raisedBy: "u", createdAt: 1 });
    await h.json("/api/matches", { method: "POST", cookie, body: { teamAId: kmuId, teamBId: utId, slotHour: 23 } });

    expect((await h.json(`/api/teams/${kmuId}`, { method: "DELETE", cookie })).status).toBe(200);

    expect((await h.json<{ teams: { name: string }[] }>("/api/teams", { cookie })).body.teams.map((t) => t.name)).toEqual(["UT"]);
    const board = (await h.json<{ slots: { hour: number; handups: unknown[]; matches: { teamA: { name: string } }[] }[] }>("/api/board", { cookie })).body.slots;
    expect(board.map((slot) => slot.handups.length)).toEqual([0, 0, 1]);
    expect(board.find((slot) => slot.hour === 23)?.matches[0]?.teamA.name).toBe("KMU");
  });

  it("削除したチームは、挙手・組分けに使えない（404）。同じロールを登録し直すと、元に戻る（履歴がつながる）", async () => {
    const { kmuId, utId } = h.seeded;
    await h.json(`/api/teams/${kmuId}`, { method: "DELETE", cookie });

    expect((await h.json("/api/handups", { method: "POST", cookie, body: { teamId: kmuId, slotHour: 21 } })).status).toBe(404);
    expect((await h.json("/api/matches", { method: "POST", cookie, body: { teamAId: kmuId, teamBId: utId, slotHour: 21 } })).status).toBe(404);

    const again = await h.json<{ id: number }>("/api/teams", { method: "POST", cookie, body: { roleId: "400000000000000001" } });
    expect(again).toMatchObject({ status: 201, body: { id: kmuId } });
    expect((await h.json("/api/handups", { method: "POST", cookie, body: { teamId: kmuId, slotHour: 21 } })).status).toBe(201);
  });

  it("別のサーバーのチームは、見えないし、消せない", async () => {
    const other = await h.login({ guildId: "999999999999999999" });

    expect((await h.json<{ teams: unknown[] }>("/api/teams", { cookie: other })).body.teams).toEqual([]);
    expect((await h.json(`/api/teams/${h.seeded.kmuId}`, { method: "DELETE", cookie: other })).status).toBe(404);
    expect((await h.json<{ teams: unknown[] }>("/api/teams", { cookie })).body.teams).toHaveLength(2);
  });
});

describe("GET /api/roles（Discord のロール一覧）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("@everyone を除き、上にあるロールから順に返す。Bot のトークンで Discord に問い合わせる", async () => {
    const calls: { url: string; auth: string | undefined }[] = [];
    vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), auth: (init?.headers as Record<string, string>)?.Authorization });
      return new Response(
        JSON.stringify([
          { id: GUILD_ID, name: "@everyone", position: 0 },
          { id: "1", name: "下のロール", position: 1 },
          { id: "2", name: "上のロール", position: 5 },
        ]),
      );
    });

    const { status, body } = await h.json<{ roles: { id: string; name: string }[] }>("/api/roles", { cookie });

    expect(status).toBe(200);
    expect(body.roles).toEqual([
      { id: "2", name: "上のロール" },
      { id: "1", name: "下のロール" },
    ]);
    expect(calls).toEqual([{ url: `http://discord.mock/api/v10/guilds/${GUILD_ID}/roles`, auth: "Bot test-bot-token" }]);
  });

  it("Discord に問い合わせられなければ 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => new Response("down", { status: 500 }));

    expect((await h.json("/api/roles", { cookie })).status).toBe(502);
  });
});

describe("時計", () => {
  it("API の時刻は、注入した時計に従う", async () => {
    h.time.now = jst("2026-10-08T09:00:00");
    const { body } = await h.json<{ date: string }>("/api/board", { cookie: await h.login() });
    expect(body.date).toBe("2026-10-08");
  });
});
