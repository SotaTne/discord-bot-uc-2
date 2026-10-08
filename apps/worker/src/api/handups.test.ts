import { createHandup, saveMatchResult, withdrawHandup } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_USER, ALICE, GUILD_ID, jst } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

let h: ApiHarness;
let cookie: string;
beforeEach(async () => {
  h = await createApiHarness();
  cookie = await h.login();
});

type HandupRow = { id: number; slotHour: number; team: { id: number; name: string }; raisedByName: string };
type Board = { date: string; slots: { hour: number; handups: Omit<HandupRow, "slotHour">[] }[] };
/** 対戦枠の画面（/api/board）から、その日の挙手を、対戦枠の時刻つきで取り出す */
const list = async (query = "") => {
  const { body } = await h.json<Board>(`/api/board${query}`, { cookie });
  return { body: { date: body.date, handups: body.slots.flatMap((slot) => slot.handups.map((handup) => ({ ...handup, slotHour: slot.hour }))) } };
};

describe("対戦枠の画面に出る挙手", () => {
  it("その日の全チームの挙手を、対戦枠ごとに、挙手の順に返す（取り消した挙手は、含まない）", async () => {
    const { db, kmuId, utId } = h.seeded;
    await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 22, teamId: kmuId, raisedBy: ALICE, createdAt: 10 });
    await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: utId, raisedBy: "u2", createdAt: 20 });
    await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: kmuId, raisedBy: "u3", createdAt: 25 });
    await withdrawHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: kmuId });

    const { body } = await list();

    expect(body.date).toBe("2026-10-07");
    expect(body.handups.map((r) => [r.slotHour, r.team.name])).toEqual([
      [21, "UT"],
      [22, "KMU"],
    ]);
  });

  it("挙手した人は、Discord での表示名でも返す。取れない人は、ID のまま", async () => {
    const { db, kmuId, utId } = h.seeded;
    await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: kmuId, raisedBy: ALICE, createdAt: 10 });
    await createHandup(db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 22, teamId: utId, raisedBy: "900000000000000009", createdAt: 20 });

    const { body } = await list();

    expect(body.handups.map((r) => [r.slotHour, r.raisedByName])).toEqual([
      [21, "alice"],
      [22, "900000000000000009"],
    ]);
  });

  it("日付を指定できる。別の日の挙手は含めない。形式が不正なら 400", async () => {
    await createHandup(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-06", slotHour: 21, teamId: h.seeded.kmuId, raisedBy: "u", createdAt: 1 });

    expect((await list()).body.handups).toEqual([]);
    expect((await list("?date=2026-10-06")).body.handups).toHaveLength(1);
    expect((await h.json("/api/board?date=10/06", { cookie })).status).toBe(400);
  });
});

describe("POST /api/handups（管理者による代理の挙手）", () => {
  const raise = (body: unknown) => h.json<{ id?: number; error?: string }>("/api/handups", { method: "POST", cookie, body });

  it("チームの挙手を作る。挙手した人は、操作した管理者になる", async () => {
    const result = await raise({ teamId: h.seeded.kmuId, slotHour: 21 });

    expect(result.status).toBe(201);
    const { body } = await list();
    expect(body.handups).toMatchObject([{ slotHour: 21, team: { name: "KMU" } }]);
  });

  it("受付時間（締切）を過ぎていても、できる", async () => {
    h.time.now = jst("2026-10-07T21:30:00");
    expect((await raise({ teamId: h.seeded.kmuId, slotHour: 21 })).status).toBe(201);
  });

  it("日付を指定できる", async () => {
    await raise({ teamId: h.seeded.kmuId, slotHour: 21, slotDate: "2026-10-05" });
    expect((await list("?date=2026-10-05")).body.handups).toHaveLength(1);
  });

  it("すでに挙手しているチームは 409。取り消した後なら、もう一度できる", async () => {
    await raise({ teamId: h.seeded.kmuId, slotHour: 21 });
    expect((await raise({ teamId: h.seeded.kmuId, slotHour: 21 })).status).toBe(409);

    const id = (await list()).body.handups[0]!.id;
    await h.json(`/api/handups/${id}`, { method: "DELETE", cookie });
    expect((await raise({ teamId: h.seeded.kmuId, slotHour: 21 })).status).toBe(201);
  });

  it("存在しないチーム・登録されていない試合時刻は 404。入力が不正なら 400", async () => {
    expect((await raise({ teamId: 9999, slotHour: 21 })).status).toBe(404);
    expect((await raise({ teamId: h.seeded.kmuId, slotHour: 20 })).status).toBe(404);
    expect((await raise({ teamId: h.seeded.kmuId, slotHour: 24 })).status).toBe(400);
    expect((await raise({ slotHour: 21 })).status).toBe(400);
  });
});

describe("DELETE /api/handups/:id（管理者による代理の取り消し）", () => {
  it("取り消すと、一覧から消える（取り消し済みの行は、残らない）。2回目は 404", async () => {
    await h.json("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.utId, slotHour: 22 } });
    const id = (await list()).body.handups[0]!.id;

    expect((await h.json(`/api/handups/${id}`, { method: "DELETE", cookie })).status).toBe(200);

    expect((await list()).body.handups).toEqual([]);
    expect((await h.json(`/api/handups/${id}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await h.json("/api/handups/abc", { method: "DELETE", cookie })).status).toBe(400);
  });

  it("挙手 → 取り消し → 挙手を繰り返しても、一覧には、有効な挙手が1件だけ残る（同じチーム・対戦枠の行が、重ならない）", async () => {
    const raise = () => h.json<{ id: number }>("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.kmuId, slotHour: 21 } });

    const first = await raise();
    await h.json(`/api/handups/${first.body.id}`, { method: "DELETE", cookie });
    const second = await raise();
    const duplicate = await raise();

    expect(second.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect((await list()).body.handups.map((r) => [r.id, r.team.name, r.slotHour])).toEqual([[second.body.id, "KMU", 21]]);
  });

  it("別のサーバーの挙手は、取り消せない", async () => {
    await h.json("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.utId, slotHour: 22 } });
    const id = (await list()).body.handups[0]!.id;
    const other = await h.login({ guildId: "999999999999999999" });

    expect((await h.json(`/api/handups/${id}`, { method: "DELETE", cookie: other })).status).toBe(404);
    expect((await list()).body.handups).toHaveLength(1);
  });
});

describe("マッチング済みの対戦枠（ダッシュボードからも、挙手を受け付けない）", () => {
  const markMatched = async () => {
    await saveMatchResult(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [], now: 2 });
  };

  it("代理の挙手は 409（slot_matched）。ほかの対戦枠には、できる", async () => {
    await markMatched();
    const raise = (slotHour: number) =>
      h.json<{ error?: string }>("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.kmuId, slotHour } });

    const matched = await raise(21);
    const other = await raise(22);

    expect(matched).toMatchObject({ status: 409, body: { error: "slot_matched" } });
    expect(other.status).toBe(201);
  });

  it("代理の取り消しも 409（slot_matched）。挙手は残る", async () => {
    const { id } = (await h.json<{ id: number }>("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.kmuId, slotHour: 21 } })).body;
    await markMatched();

    const result = await h.json<{ error?: string }>(`/api/handups/${id}`, { method: "DELETE", cookie });

    expect(result).toMatchObject({ status: 409, body: { error: "slot_matched" } });
    expect((await list()).body.handups).toHaveLength(1);
  });
});
