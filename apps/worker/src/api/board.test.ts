import { beforeEach, describe, expect, it } from "vitest";
import { jst } from "../test-helpers";
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
    matchNumberA: number;
    matchNumberB: number;
  }[];
};
type Board = { date: string; today: string; slots: Slot[] };
const board = async (query = "") => (await h.json<Board>(`/api/board${query}`, { cookie })).body;
const slotOf = async (hour: number, query = "") => (await board(query)).slots.find((slot) => slot.hour === hour)!;

const addMatch = (body: Record<string, unknown>) => h.json<{ id: number; error?: string }>("/api/matches", { method: "POST", cookie, body });
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

  it("組分けごとに、各チームが何試合目かを返す（そのチームが入った組分けを、日付・時刻の順に数える。保存せず、毎回、数える）", async () => {
    await h.json("/api/matches", { method: "POST", cookie, body: { teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21, slotDate: "2026-10-05" } });
    const matchId = await kmuVsUt(22);

    const { slots } = await board();

    expect(slots.find((slot) => slot.hour === 22)?.matches).toMatchObject([
      { id: matchId, teamA: { name: "KMU" }, teamB: { name: "UT" }, matchNumberA: 2, matchNumberB: 2 },
    ]);
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
    expect(slot.matches).toMatchObject([{ id: result.body.id, teamA: { name: "KMU" }, teamB: { name: "UT" } }]);
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
  it("組分けを削除する。挙手は残る。同じチームで、組み直せる", async () => {
    const matchId = await kmuVsUt();

    const result = await h.json(`/api/matches/${matchId}`, { method: "DELETE", cookie });

    expect(result.status).toBe(200);
    const slot = await slotOf(21);
    expect(slot.matches).toEqual([]);
    expect(slot.handups).toHaveLength(2);
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

