import { defaultGuildSettings, getGuildSettings, saveGuildSettings, saveMatchResult } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { GUILD_ID } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

let h: ApiHarness;
let cookie: string;
beforeEach(async () => {
  h = await createApiHarness();
  cookie = await h.login();
});

const season = (start: string, end: string) =>
  saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, seasonStart: start, seasonEnd: end }, 1);

describe("大会の期間", () => {
  it("期間を決めていないときは、access は play。代理の挙手ができる", async () => {
    const board = await h.json<{ access: string }>("/api/board", { cookie });
    expect(board.body.access).toBe("play");
    expect((await h.json("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.kmuId, slotHour: 21 } })).status).toBe(201);
  });

  it("期間の前は、挙手も組分けの追加も確定もやり直しも 409。開始前に期間内の日を見ても closed", async () => {
    await h.json("/api/matches", { method: "POST", cookie, body: { teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21, slotDate: "2026-10-08" } });
    await season("2026-10-08", "2026-10-09");

    expect(await h.json("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.kmuId, slotHour: 21 } })).toMatchObject({
      status: 409,
      body: { error: "outside_season" },
    });
    expect(await h.json("/api/matches", { method: "POST", cookie, body: { teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 22 } })).toMatchObject({
      status: 409,
      body: { error: "outside_season" },
    });
    expect(await h.json("/api/match-slots/confirm", { method: "POST", cookie, body: { slotHour: 21, slotDate: "2026-10-08" } })).toMatchObject({
      status: 409,
      body: { error: "outside_season" },
    });
    expect(await h.json("/api/match-slots/reopen", { method: "POST", cookie, body: { slotHour: 21, slotDate: "2026-10-08" } })).toMatchObject({
      status: 409,
      body: { error: "outside_season" },
    });
    expect(await h.json("/api/match-slots/cancel-waiting", { method: "POST", cookie, body: { slotHour: 21, slotDate: "2026-10-08" } })).toMatchObject({
      status: 409,
      body: { error: "outside_season" },
    });

    const today = await h.json<{ access: string }>("/api/board", { cookie });
    const future = await h.json<{ access: string; slots: { hour: number; matches: { id: number }[] }[] }>("/api/board?date=2026-10-08", { cookie });
    expect(today.body.access).toBe("closed");
    expect(future.body.access).toBe("closed");
    const matchId = future.body.slots.find((slot) => slot.hour === 21)?.matches[0]?.id;
    expect(await h.json(`/api/matches/${matchId}`, { method: "DELETE", cookie })).toMatchObject({ status: 409, body: { error: "outside_season" } });
  });

  it("終わったあとは、期間内の日の組分けの削除ができる。追加・挙手・マッチング処理・やり直しは 409", async () => {
    const created = await h.json<{ id: number }>("/api/matches", {
      method: "POST",
      cookie,
      body: { teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21, slotDate: "2026-10-06" },
    });
    // 過去の日の対戦枠は、マッチング済みの記録として、用意する（試合開始後は、マッチング処理を実行できない）
    await saveMatchResult(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-06", slotHour: 22, excludedTeamId: null, pairs: [], now: 1 });
    await season("2026-10-06", "2026-10-06");

    const board = await h.json<{ access: string }>("/api/board?date=2026-10-06", { cookie });
    expect(board.body.access).toBe("repair");
    expect((await h.json<{ access: string }>("/api/board", { cookie })).body.access).toBe("closed");

    expect(await h.json("/api/matches", { method: "POST", cookie, body: { teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21, slotDate: "2026-10-06" } })).toMatchObject({
      status: 409,
      body: { error: "outside_season" },
    });
    expect(await h.json("/api/handups", { method: "POST", cookie, body: { teamId: h.seeded.kmuId, slotHour: 21, slotDate: "2026-10-06" } })).toMatchObject({
      status: 409,
      body: { error: "outside_season" },
    });
    expect(await h.json("/api/match-slots/confirm", { method: "POST", cookie, body: { slotHour: 21, slotDate: "2026-10-06" } })).toMatchObject({
      status: 409,
      body: { error: "outside_season" },
    });

    expect((await h.json(`/api/matches/${created.body.id}`, { method: "DELETE", cookie })).status).toBe(200);
    // 試合が始まったあとは、期間のあとでも、やり直せない（組分けの削除で、記録を直す）
    expect(await h.json("/api/match-slots/reopen", { method: "POST", cookie, body: { slotHour: 22, slotDate: "2026-10-06" } })).toMatchObject({
      status: 409,
      body: { error: "slot_started" },
    });
  });

  it("大会の期間は、両方そろえて保存でき、読み返せる。片方だけ、開始が終了よりあとは、拒否する", async () => {
    const put = (body: Record<string, unknown>) =>
      h.json("/api/settings", { method: "PUT", cookie, body: { ...defaultGuildSettings, ...body } });

    expect((await put({ seasonStart: "2026-10-08", seasonEnd: "2026-10-10" })).status).toBe(200);
    expect(await getGuildSettings(h.seeded.db, GUILD_ID)).toMatchObject({ seasonStart: "2026-10-08", seasonEnd: "2026-10-10" });
    expect((await h.json<{ seasonStart: string; seasonEnd: string }>("/api/settings", { cookie })).body).toMatchObject({
      seasonStart: "2026-10-08",
      seasonEnd: "2026-10-10",
    });
    expect((await put({ seasonStart: "2026-10-08", seasonEnd: null })).status).toBe(400);
    expect((await put({ seasonStart: "2026-10-10", seasonEnd: "2026-10-08" })).status).toBe(400);
    expect(await getGuildSettings(h.seeded.db, GUILD_ID)).toMatchObject({ seasonStart: "2026-10-08", seasonEnd: "2026-10-10" });
  });
});
