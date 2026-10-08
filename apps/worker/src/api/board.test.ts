import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_USER, ALICE, GUILD_ID, jst } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

let h: ApiHarness;
let cookie: string;
beforeEach(async () => {
  h = await createApiHarness();
  cookie = await h.login();
});

type Team = { id: number; name: string };
type Slot = {
  hour: number;
  phase: string;
  matched: boolean;
  excluded: Team | null;
  handups: { id: number; team: Team; raisedByName: string; createdAt: number }[];
  matches: {
    id: number;
    teamA: Team;
    teamB: Team;
    win: { id: number; team: Team; points: number; recordedByName: string; hasScreenshot: boolean } | null;
    deletedWins: number;
  }[];
};
type Board = { date: string; today: string; slots: Slot[] };
const board = async (query = "") => (await h.json<Board>(`/api/board${query}`, { cookie })).body;
const slotOf = async (hour: number, query = "") => (await board(query)).slots.find((slot) => slot.hour === hour)!;

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const addMatch = (body: Record<string, unknown>) => h.json<{ id: number; error?: string }>("/api/matches", { method: "POST", cookie, body });
const winForm = (fields: Record<string, string>, image: File | null = new File([PNG], "shot.png", { type: "image/png" })) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  if (image) form.set("image", image);
  return form;
};
const addWin = (matchId: number, fields: Record<string, string>, image?: File | null) =>
  h.postForm<{ id?: number; error?: string; winNumber?: number }>(`/api/matches/${matchId}/wins`, winForm(fields, image), { cookie });
const setActive = (id: number, active: boolean) => h.json(`/api/wins/${id}/active`, { method: "PUT", cookie, body: { active } });

/** 21時に、KMU vs UT の組分けを追加して、その ID を返す */
async function kmuVsUt(slotHour = 21) {
  const { body } = await addMatch({ teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour });
  return body.id;
}

describe("GET /api/board（対戦枠の画面）", () => {
  it("登録した試合時刻ごとに、受付の段階・挙手・組分け・除外チームを返す。何もなければ、空の対戦枠が並ぶ", async () => {
    const result = await board();

    expect(result.date).toBe("2026-10-07");
    expect(result.today).toBe("2026-10-07");
    expect(result.slots.map((slot) => [slot.hour, slot.phase, slot.matched, slot.handups.length, slot.matches.length, slot.excluded])).toEqual([
      [21, "open", false, 0, 0, null],
      [22, "open", false, 0, 0, null],
      [23, "open", false, 0, 0, null],
    ]);
  });

  it("受付の段階は、日付と時刻で決まる（今日の締切前・締切後・過去の日・未来の日）", async () => {
    h.time.now = jst("2026-10-07T21:30:00");

    expect((await slotOf(21)).phase).toBe("closed");
    expect((await slotOf(23)).phase).toBe("open");
    expect((await slotOf(21, "?date=2026-10-06")).phase).toBe("closed");
    expect((await slotOf(21, "?date=2026-10-08")).phase).toBe("before-open");
  });

  it("挙手した人は、Discord での表示名で返す", async () => {
    await h.json("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.kmuId, slotHour: 21 } });

    expect((await slotOf(21)).handups).toMatchObject([{ team: { name: "KMU" }, raisedByName: "管理者さん" }]);
  });

  it("組分けごとに、有効な勝利を返す。削除した記録は出さず、件数だけ返す", async () => {
    const matchId = await kmuVsUt();
    const first = await addWin(matchId, { teamId: String(h.seeded.utId), points: "70" });
    await setActive(first.body.id!, false);
    await addWin(matchId, { teamId: String(h.seeded.kmuId), points: "80" });

    const [match] = (await slotOf(21)).matches;

    expect(match).toMatchObject({
      id: matchId,
      teamA: { name: "KMU" },
      teamB: { name: "UT" },
      win: { team: { name: "KMU" }, points: 80, recordedByName: "管理者さん", hasScreenshot: true },
      deletedWins: 1,
    });
  });

  it("別の日の組分け・別のサーバーのデータは、出ない。日付が不正なら 400", async () => {
    await kmuVsUt();
    const other = await h.login({ guildId: "999999999999999999" });

    expect((await slotOf(21, "?date=2026-10-06")).matches).toEqual([]);
    expect((await h.json<Board>("/api/board", { cookie: other })).body.slots).toEqual([]);
    expect((await h.json("/api/board?date=10/06", { cookie })).status).toBe(400);
  });
});

describe("POST /api/matches（管理者による、組分けの追加）", () => {
  it("組分けを追加できる。2チームの挙手が、自動で付く（挙手した人は、管理者）", async () => {
    const result = await addMatch({ teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21 });

    expect(result.status).toBe(201);
    const slot = await slotOf(21);
    expect(slot.matches).toMatchObject([{ id: result.body.id, teamA: { name: "KMU" }, teamB: { name: "UT" }, win: null }]);
    expect(slot.handups.map((handup) => [handup.team.name, handup.raisedByName])).toEqual([["KMU", "管理者さん"], ["UT", "管理者さん"]]);
  });

  it("すでに挙手しているチームの挙手は、そのまま（二重にならない。挙手した人も、変わらない）", async () => {
    await h.json("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.kmuId, slotHour: 21 } });
    const before = (await slotOf(21)).handups[0]!;

    await kmuVsUt();

    const after = (await slotOf(21)).handups;
    expect(after.map((handup) => handup.team.name).sort()).toEqual(["KMU", "UT"]);
    expect(after.find((handup) => handup.team.name === "KMU")).toMatchObject({ id: before.id, createdAt: before.createdAt });
  });

  it("日付を指定できる。マッチング済みの対戦枠にも、追加できる（挙手も付く）", async () => {
    await addMatch({ teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21, slotDate: "2026-10-05" });

    expect((await slotOf(21, "?date=2026-10-05")).matches).toHaveLength(1);
    expect((await slotOf(21, "?date=2026-10-05")).handups).toHaveLength(2);
  });

  it("同じ対戦枠で、すでに組分けに入っているチームは、409（team_already_matched）。別の対戦枠には、入れる", async () => {
    await kmuVsUt();

    expect((await addMatch({ teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21 })).body.error).toBe("team_already_matched");
    expect((await addMatch({ teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 22 })).status).toBe(201);
  });

  it("存在しないチーム・登録されていない試合時刻は 404。同じチーム同士・入力が不正なら 400", async () => {
    expect((await addMatch({ teamAId: 9999, teamBId: h.seeded.utId, slotHour: 21 })).body.error).toBe("team_not_found");
    expect((await addMatch({ teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 20 })).body.error).toBe("slot_not_found");
    expect((await addMatch({ teamAId: h.seeded.kmuId, teamBId: h.seeded.kmuId, slotHour: 21 })).status).toBe(400);
    expect((await addMatch({ teamAId: h.seeded.kmuId, slotHour: 21 })).status).toBe(400);
    expect((await slotOf(21)).matches).toEqual([]);
  });

  it("Origin がなければ、追加できない", async () => {
    const response = await h.json("/api/matches", { method: "POST", cookie, origin: null, body: { teamAId: 1, teamBId: 2, slotHour: 21 } });
    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/matches/:id（組分けの削除）", () => {
  it("組分けと、その勝利の記録（無効なものも）・画像を、あわせて削除する。挙手は残る。同じチームで、組み直せる", async () => {
    const matchId = await kmuVsUt();
    const win = await addWin(matchId, { teamId: String(h.seeded.kmuId), points: "80" });
    await setActive(win.body.id!, false);
    await addWin(matchId, { teamId: String(h.seeded.utId), points: "50" });
    expect(h.r2.objects.size).toBe(2);

    const result = await h.json(`/api/matches/${matchId}`, { method: "DELETE", cookie });

    expect(result.status).toBe(200);
    const slot = await slotOf(21);
    expect(slot.matches).toEqual([]);
    expect(slot.handups).toHaveLength(2);
    expect(h.r2.objects.size).toBe(0);
    expect((await h.json<{ wins: unknown[] }>("/api/wins", { cookie })).body.wins).toEqual([]);
    expect((await kmuVsUt()) > 0).toBe(true);
  });

  it("存在しない・別のサーバーの組分けは 404。ID が不正なら 400", async () => {
    const matchId = await kmuVsUt();
    const other = await h.login({ guildId: "999999999999999999" });

    expect((await h.json("/api/matches/9999", { method: "DELETE", cookie })).status).toBe(404);
    expect((await h.json(`/api/matches/${matchId}`, { method: "DELETE", cookie: other })).status).toBe(404);
    expect((await h.json("/api/matches/abc", { method: "DELETE", cookie })).status).toBe(400);
    expect((await slotOf(21)).matches).toHaveLength(1);
  });
});

describe("N 試合を超えた試合の勝利", () => {
  it("組分けには、各チームの何試合目かと、集計の規則（N と固定点）が付く。画面の入力の案内に使う", async () => {
    await h.json("/api/matches", { method: "POST", cookie, body: { teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21, slotDate: "2026-10-05" } });
    const second = await kmuVsUt(22);

    const { body } = await h.json<{ rule: { fixedAfterMatches: number; fixedPoints: number }; slots: { hour: number; matches: { id: number; matchNumberA: number; matchNumberB: number }[] }[] }>("/api/board", { cookie });

    expect(body.rule).toEqual({ fixedAfterMatches: 5, fixedPoints: 100 });
    expect(body.slots.find((slot) => slot.hour === 22)?.matches).toMatchObject([{ id: second, matchNumberA: 2, matchNumberB: 2 }]);
  });

  it("N 試合を超えた試合で勝つと、入力が何点でも、固定点で登録される。N 試合目までは、入力のまま", async () => {
    const { saveGuildSettings, defaultGuildSettings } = await import("@uc/db");
    await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, fixedAfterMatches: 1 }, 1);
    const first = await kmuVsUt(21);
    const second = await kmuVsUt(22);

    const a = await addWin(first, { teamId: String(h.seeded.kmuId), points: "5000" });
    const b = await addWin(second, { teamId: String(h.seeded.kmuId), points: "5000" });

    expect(a.body).toMatchObject({ points: 5000, fixed: false, countedPoints: 5000 });
    expect(b.body).toMatchObject({ points: 100, fixed: true, countedPoints: 100 });
    const slots = (await board()).slots;
    expect(slots.find((slot) => slot.hour === 22)?.matches[0]?.win?.points).toBe(100);
  });

  it("点数の上限（100000）を超えると 400", async () => {
    const matchId = await kmuVsUt();

    expect((await addWin(matchId, { teamId: String(h.seeded.kmuId), points: "100001" })).status).toBe(400);
    expect((await addWin(matchId, { teamId: String(h.seeded.kmuId), points: "100000" })).status).toBe(201);
  });
});

describe("POST /api/matches/:id/wins（組分けへの、勝利の記録）", () => {
  it("勝ったチームと点数と画像で、記録できる。集計での扱いが返る。記録者は、管理者", async () => {
    const matchId = await kmuVsUt();

    const result = await addWin(matchId, { teamId: String(h.seeded.utId), points: "452" });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ slotDate: "2026-10-07", matchNumber: 1, countedPoints: 452, fixed: false });
    expect((await slotOf(21)).matches[0]?.win).toMatchObject({ team: { name: "UT" }, points: 452, recordedByName: "管理者さん" });
    expect(h.r2.objects.size).toBe(1);
  });

  it("有効な記録は、1つの組分けに1件まで（409 win_exists）。削除すると、記録し直せる", async () => {
    const matchId = await kmuVsUt();
    const first = await addWin(matchId, { teamId: String(h.seeded.kmuId), points: "80" });

    const second = await addWin(matchId, { teamId: String(h.seeded.utId), points: "70" });
    expect(second).toMatchObject({ status: 409, body: { error: "win_exists" } });
    expect(h.r2.objects.size).toBe(1);

    await setActive(first.body.id!, false);
    expect((await addWin(matchId, { teamId: String(h.seeded.utId), points: "70" })).status).toBe(201);
    expect((await slotOf(21)).matches[0]).toMatchObject({ win: { team: { name: "UT" }, points: 70 }, deletedWins: 1 });
  });

  it("削除した記録は、ほかに有効な記録があるときは、有効に戻せない（409）。そちらを削除すれば、戻せる", async () => {
    const matchId = await kmuVsUt();
    const first = await addWin(matchId, { teamId: String(h.seeded.kmuId), points: "80" });
    await setActive(first.body.id!, false);
    const second = await addWin(matchId, { teamId: String(h.seeded.utId), points: "70" });

    expect((await setActive(first.body.id!, true)).status).toBe(409);
    expect((await slotOf(21)).matches[0]?.win?.team.name).toBe("UT");

    await setActive(second.body.id!, false);
    expect((await setActive(first.body.id!, true)).status).toBe(200);
    expect((await slotOf(21)).matches[0]?.win?.team.name).toBe("KMU");
  });

  it("その組分けに出ていないチームは、記録できない（400 team_not_in_match）。画像も保存しない", async () => {
    const matchId = await kmuVsUt();
    const { createTeam } = await import("@uc/db");
    const third = await createTeam(h.seeded.db, { guildId: GUILD_ID, roleId: "400000000000000009", createdAt: 1 });

    const result = await addWin(matchId, { teamId: String(third), points: "10" });

    expect(result).toMatchObject({ status: 400, body: { error: "team_not_in_match" } });
    expect(h.r2.objects.size).toBe(0);
  });

  it("存在しない・別のサーバーの組分けは 404。ID が不正なら 400", async () => {
    const matchId = await kmuVsUt();
    const other = await h.login({ guildId: "999999999999999999" });

    expect((await addWin(9999, { teamId: String(h.seeded.kmuId), points: "1" })).status).toBe(404);
    const crossed = await h.postForm(`/api/matches/${matchId}/wins`, winForm({ teamId: String(h.seeded.kmuId), points: "1" }), { cookie: other });
    expect(crossed.status).toBe(404);
    expect((await addWin("abc" as unknown as number, { teamId: "1", points: "1" })).status).toBe(400);
  });

  describe("記録できないとき（何も保存しない）", () => {
    it("画像がない・画像でない・大きすぎる", async () => {
      const matchId = await kmuVsUt();
      const fields = { teamId: String(h.seeded.kmuId), points: "80" };

      expect((await addWin(matchId, fields, null)).body).toEqual({ error: "image_required" });
      expect((await addWin(matchId, fields, new File(["x"], "a.pdf", { type: "application/pdf" }))).body).toEqual({ error: "unsupported_image" });
      expect((await addWin(matchId, fields, new File([new Uint8Array(9 * 1024 * 1024)], "big.png", { type: "image/png" }))).body).toEqual({ error: "image_too_large" });
      expect(h.r2.objects.size).toBe(0);
      expect((await slotOf(21)).matches[0]?.win).toBeNull();
    });

    it("点数が負・チームが数値でない・点数がない", async () => {
      const matchId = await kmuVsUt();

      for (const bad of [{ teamId: String(h.seeded.kmuId), points: "-1" }, { teamId: "abc", points: "1" }, { teamId: String(h.seeded.kmuId) }]) {
        expect((await addWin(matchId, bad)).status).toBe(400);
      }
      expect(h.r2.objects.size).toBe(0);
    });

    it("Origin がない", async () => {
      const matchId = await kmuVsUt();
      const result = await h.postForm(`/api/matches/${matchId}/wins`, winForm({ teamId: String(h.seeded.kmuId), points: "1" }), { cookie, origin: null });
      expect(result.status).toBe(403);
    });
  });

  it("N 試合を超えた試合（6 試合目）で勝つと、集計が一律の固定点になることが返る", async () => {
    const { insertWinInSlot } = await import("../test-helpers");
    for (let day = 1; day <= 5; day++) {
      await insertWinInSlot(h.seeded.db, { guildId: GUILD_ID, teamId: h.seeded.kmuId, slotDate: `2026-09-0${day}`, slotHour: 21, points: 10, screenshotKey: null, recordedBy: ALICE, createdAt: day });
    }
    const matchId = await kmuVsUt();

    const result = await addWin(matchId, { teamId: String(h.seeded.kmuId), points: "30" });

    expect(result.body).toMatchObject({ matchNumber: 6, countedPoints: 100, fixed: true });
    expect(ADMIN_USER).toBeTruthy();
  });
});
