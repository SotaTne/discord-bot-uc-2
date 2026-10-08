import { defaultGuildSettings, findMatchForTeam, saveGuildSettings, saveMatchResult } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_USER, GUILD_ID, insertWinInSlot, jst } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

let h: ApiHarness;
let cookie: string;
/** KMU と UT が対戦する、マッチング済みの対戦枠 */
const played = (slotDate: string, slotHour: number) =>
  saveMatchResult(h.seeded.db, { guildId: GUILD_ID, slotDate, slotHour, excludedTeamId: null, pairs: [[h.seeded.kmuId, h.seeded.utId]], now: 1 });

beforeEach(async () => {
  h = await createApiHarness();
  cookie = await h.login();
  await played("2026-10-07", 21);
  await played("2026-10-06", 23);
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function winForm(fields: Record<string, string | undefined>, image: File | null = new File([PNG], "shot.png", { type: "image/png" })) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) form.set(key, value);
  if (image) form.set("image", image);
  return form;
}

/** 2026-10-07 21:00 の、KMU vs UT の組分けに、ダッシュボードから勝利を追加する */
const record = async (fields: Record<string, string | undefined> = {}, image?: File | null) => {
  const match = await findMatchForTeam(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: h.seeded.kmuId });
  return h.postForm<Record<string, unknown>>(
    `/api/matches/${match?.matchId}/wins`,
    winForm({ teamId: String(h.seeded.kmuId), points: "80", ...fields }, image),
    { cookie },
  );
};

/** DB に直接、勝利を積む（記録の手順を省くため） */
const seedWin = (teamId: number, day: number, points: number) =>
  insertWinInSlot(h.seeded.db, {
    guildId: GUILD_ID, teamId, slotDate: `2026-09-${String(day).padStart(2, "0")}`, slotHour: 21, points, screenshotKey: null, recordedBy: "a", createdAt: day,
  });

type EventRow = {
  id: number; recordedByName: string; teamName: string; active: boolean; points: number; hasScreenshot: boolean; recordedBy: string;
  slotDate: string; slotHour: number; match: { id: number; teamA: string; teamB: string };
};
const events = async () => (await h.json<{ wins: EventRow[] }>("/api/wins", { cookie })).body.wins;
const setActive = (id: number, active: boolean, who = cookie) => h.json(`/api/wins/${id}/active`, { method: "PUT", cookie: who, body: { active } });

describe("GET /api/scores", () => {
  it("チームごとの得点と内訳を、得点の高い順に返す。勝利のないチームは 0pt", async () => {
    await seedWin(h.seeded.kmuId, 1, 80);
    await seedWin(h.seeded.kmuId, 2, 70);

    const { body } = await h.json<{
      rule: { fixedAfterMatches: number; fixedPoints: number };
      teams: { name: string; total: number; wins: { matchNumber: number; points: number }[] }[];
    }>("/api/scores", { cookie });

    expect(body.rule).toEqual({ fixedAfterMatches: 5, fixedPoints: 100 });
    expect(body.teams.map((t) => [t.name, t.total])).toEqual([["KMU", 150], ["UT", 0]]);
    expect(body.teams[0]?.wins.map((w) => [w.matchNumber, w.points])).toEqual([[1, 80], [2, 70]]);
  });

  it("チームごとの試合数（対戦した組分けの数。勝ち負けに関係なく）と、勝利数（wins の件数）を、分けて返す", async () => {
    // beforeEach で、KMU vs UT の組分けが2つ（10/07 21時と、10/06 23時）ある
    await seedWin(h.seeded.kmuId, 1, 80);
    const { addMatch } = await import("@uc/db");
    await addMatch(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 22, teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, createdAt: 1 });

    const { body } = await h.json<{ teams: { name: string; matches: number; wins: unknown[] }[] }>("/api/scores", { cookie });

    expect(body.teams.map((t) => [t.name, t.matches, t.wins.length])).toEqual([["KMU", 4, 1], ["UT", 4, 0]]);
  });

  it("6勝目以降は、生点に関係なく固定点で集計する", async () => {
    for (let day = 1; day <= 7; day++) await seedWin(h.seeded.kmuId, day, 10);

    const { body } = await h.json<{ teams: { total: number }[] }>("/api/scores", { cookie });

    expect(body.teams[0]?.total).toBe(5 * 10 + 2 * 100);
  });
});

describe("勝利の記録の有効 / 無効", () => {
  it("無効にすると、その勝利は集計から外れる。履歴には active: false で残る。有効に戻せる", async () => {
    const id = await seedWin(h.seeded.kmuId, 1, 80);

    expect((await setActive(id, false)).status).toBe(200);
    const off = await h.json<{ teams: { name: string; total: number }[] }>("/api/scores", { cookie });
    expect(off.body.teams.find((t) => t.name === "KMU")?.total).toBe(0);
    expect((await events()).find((e) => e.id === id)?.active).toBe(false);

    expect((await setActive(id, true)).status).toBe(200);
    const on = await h.json<{ teams: { name: string; total: number }[] }>("/api/scores", { cookie });
    expect(on.body.teams.find((t) => t.name === "KMU")?.total).toBe(80);
    expect((await events()).find((e) => e.id === id)?.active).toBe(true);
  });

  it("同じ状態にもう一度しても、エラーにならない（何度やっても同じ結果）", async () => {
    const id = await seedWin(h.seeded.kmuId, 1, 80);

    expect((await setActive(id, false)).status).toBe(200);
    expect((await setActive(id, false)).status).toBe(200);
    expect((await events())[0]?.active).toBe(false);
  });

  it("無効にしても、試合数は変わらない（組分けは残る）。6 試合目の勝利は、固定点のまま", async () => {
    const first = await seedWin(h.seeded.kmuId, 1, 10);
    for (let day = 2; day <= 5; day++) await seedWin(h.seeded.kmuId, day, 10);
    await seedWin(h.seeded.kmuId, 6, 30);
    const total = async () =>
      (await h.json<{ teams: { name: string; total: number }[] }>("/api/scores", { cookie })).body.teams.find((t) => t.name === "KMU")?.total;

    expect(await total()).toBe(5 * 10 + 100);
    await setActive(first, false);
    expect(await total()).toBe(4 * 10 + 100);
  });

  it("存在しない記録は 404。ID が不正・active が不正なら 400。別のサーバーの記録は変えられない", async () => {
    const id = await seedWin(h.seeded.kmuId, 1, 80);
    const other = await h.login({ guildId: "999999999999999999" });

    expect((await setActive(9999, false)).status).toBe(404);
    expect((await h.json("/api/wins/abc/active", { method: "PUT", cookie, body: { active: false } })).status).toBe(400);
    expect((await h.json(`/api/wins/${id}/active`, { method: "PUT", cookie, body: { active: "no" } })).status).toBe(400);
    expect((await setActive(id, false, other)).status).toBe(404);
    expect((await events())[0]?.active).toBe(true);
  });

  it("得点のクリアは、すべての勝利の記録（無効なものも）と組分けを削除する（履歴も 0 になる）。以後は1試合目から数える。画像も消える", async () => {
    await record();
    for (let day = 1; day <= 6; day++) await seedWin(h.seeded.kmuId, day, 10);
    expect(h.r2.objects.size).toBe(1);

    const cleared = await h.json<{ ok: boolean; screenshots: number }>("/api/wins", { method: "DELETE", cookie });

    expect(cleared).toMatchObject({ status: 200, body: { ok: true, screenshots: 1 } });
    expect(await events()).toEqual([]);
    expect(h.r2.objects.size).toBe(0);
    await seedWin(h.seeded.kmuId, 20, 25);
    const { body } = await h.json<{ teams: { name: string; total: number; wins: { matchNumber: number }[] }[] }>("/api/scores", { cookie });
    const kmu = body.teams.find((t) => t.name === "KMU");
    expect(kmu?.total).toBe(25);
    expect(kmu?.wins.map((w) => w.matchNumber)).toEqual([1]);
  });

  it("クリアすると、組分け（試合数）も消える。固定点の判定が、最初に戻る。挙手と対戦枠は残る。別のサーバーには影響しない", async () => {
    await seedWin(h.seeded.kmuId, 1, 80);
    // 21時の対戦枠は、マッチング済みなので、22時の対戦枠に、挙手する
    await h.json("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.kmuId, slotHour: 22 } });
    const other = await h.login({ guildId: "999999999999999999" });

    await h.json("/api/wins", { method: "DELETE", cookie: other });
    expect(await events()).toHaveLength(1);

    await h.json("/api/wins", { method: "DELETE", cookie });
    const board = await h.json<{ slots: { matches: unknown[]; handups: unknown[] }[] }>("/api/board?date=2026-10-07", { cookie });
    expect(board.body.slots.flatMap((slot) => slot.matches)).toEqual([]);
    expect(board.body.slots.flatMap((slot) => slot.handups)).toHaveLength(1);
    const scores = await h.json<{ teams: { name: string; matches: number }[] }>("/api/scores", { cookie });
    expect(scores.body.teams.map((t) => t.matches)).toEqual([0, 0]);
  });
});

describe("PUT /api/wins/:id/points（点数の修正）", () => {
  const setPoints = (id: number, points: unknown, who = cookie) => h.json(`/api/wins/${id}/points`, { method: "PUT", cookie: who, body: { points } });
  const totalOf = async (name: string) => (await h.json<{ teams: { name: string; total: number }[] }>("/api/scores", { cookie })).body.teams.find((t) => t.name === name)?.total;

  it("点数だけを編集する。勝ったチーム・組分けは変わらず、得点は、すぐ反映される", async () => {
    const id = await seedWin(h.seeded.kmuId, 1, 80);

    expect((await setPoints(id, 95)).status).toBe(200);

    expect(await totalOf("KMU")).toBe(95);
    expect((await events()).find((e) => e.id === id)).toMatchObject({ points: 95, teamName: "KMU", active: true });
  });

  it("N 試合を超えた試合の点数を直しても、集計は固定点のまま（生点は、履歴に残る）", async () => {
    await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, fixedAfterMatches: 1 }, 1);
    await seedWin(h.seeded.kmuId, 1, 80);
    const second = await seedWin(h.seeded.kmuId, 2, 80);

    await setPoints(second, 10);

    expect(await totalOf("KMU")).toBe(80 + 100);
    expect((await events()).find((e) => e.id === second)?.points).toBe(10);
  });

  it("無効な記録も直せる（得点には数えない）", async () => {
    const id = await seedWin(h.seeded.kmuId, 1, 80);
    await setActive(id, false);

    expect((await setPoints(id, 50)).status).toBe(200);

    expect(await totalOf("KMU")).toBe(0);
    await setActive(id, true);
    expect(await totalOf("KMU")).toBe(50);
  });

  it("存在しない記録は 404。点数が不正（負・小数・文字）・ID が不正なら 400。別のサーバーの記録は変えられない", async () => {
    const id = await seedWin(h.seeded.kmuId, 1, 80);
    const other = await h.login({ guildId: "999999999999999999" });

    expect((await setPoints(9999, 1)).status).toBe(404);
    for (const bad of [-1, 1.5, "10", null]) expect((await setPoints(id, bad)).status).toBe(400);
    expect((await h.json("/api/wins/abc/points", { method: "PUT", cookie, body: { points: 1 } })).status).toBe(400);
    expect((await setPoints(id, 1, other)).status).toBe(404);
    expect((await events())[0]?.points).toBe(80);
  });
});

describe("GET /api/wins", () => {
  it("記録した人を、Discord での表示名でも返す。取れない人は、ID のまま", async () => {
    await seedWin(h.seeded.kmuId, 1, 10);
    await insertWinInSlot(h.seeded.db, { guildId: GUILD_ID, teamId: h.seeded.utId, slotDate: "2026-09-02", slotHour: 21, points: 5, screenshotKey: null, recordedBy: "900000000000000009", createdAt: 2 });

    const names = (await events()).map((e) => e.recordedByName);

    expect(names).toEqual(["900000000000000009", "a"]);
  });

  it("新しい順に返す", async () => {
    await seedWin(h.seeded.kmuId, 1, 10);
    await seedWin(h.seeded.utId, 2, 20);

    expect((await events()).map((e) => e.teamName)).toEqual(["UT", "KMU"]);
  });

  it("別のサーバーのイベントは含めない", async () => {
    await seedWin(h.seeded.kmuId, 1, 10);
    const other = await h.login({ guildId: "999999999999999999" });

    expect((await h.json<{ wins: unknown[] }>("/api/wins", { cookie: other })).body.wins).toEqual([]);
  });
});

describe("GET /api/screenshots/:id", () => {
  it("記録した画像を、元の形式で返す（ログインしていれば）", async () => {
    const { body } = await record();
    const response = await h.call(`/api/screenshots/${body.id}`, { cookie });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("ログインしていなければ見られない", async () => {
    const { body } = await record();
    expect((await h.call(`/api/screenshots/${body.id}`)).status).toBe(401);
  });

  it("画像のないイベント・存在しないイベント・別のサーバーのイベントは 404", async () => {
    const withoutImage = await seedWin(h.seeded.kmuId, 1, 10);
    const { body } = await record();
    const other = await h.login({ guildId: "999999999999999999" });

    expect((await h.call(`/api/screenshots/${withoutImage}`, { cookie })).status).toBe(404);
    expect((await h.call("/api/screenshots/9999", { cookie })).status).toBe(404);
    expect((await h.call(`/api/screenshots/${body.id}`, { cookie: other })).status).toBe(404);
    expect((await h.call("/api/screenshots/abc", { cookie })).status).toBe(400);
  });
});
