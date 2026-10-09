import { createHandup, defaultGuildSettings, saveGuildSettings } from "@uc/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALICE, GUILD_ID, KMU_ROLE, UT_ROLE, jst } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

let h: ApiHarness;
let cookie: string;
beforeEach(async () => {
  h = await createApiHarness();
  cookie = await h.login();
});

type Slot = { hour: number; matched: boolean; handups: unknown[]; matches: { id: number; win: unknown }[]; excluded: unknown };
const slotOf = async (hour: number) =>
  (await h.json<{ slots: Slot[] }>("/api/board", { cookie })).body.slots.find((slot) => slot.hour === hour)!;

const confirm = (slotHour = 21, extra: Record<string, unknown> = {}) =>
  h.json<{ error?: string }>("/api/match-slots/confirm", { method: "POST", cookie, body: { slotHour, ...extra } });
const reopen = (slotHour = 21) =>
  h.json<{ error?: string; deletedMatches?: number; deletedWins?: number }>("/api/match-slots/reopen", { method: "POST", cookie, body: { slotHour } });

const raise = (teamId: number, slotHour = 21) => createHandup(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour, teamId, raisedBy: ALICE, createdAt: 10 });

/** 投稿先のチャンネルを設定して、Discord への投稿を記録する */
async function withChannel() {
  await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: "123456789012345678" }, 1);
  const posted: string[] = [];
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/messages") && init?.method === "POST") {
      posted.push(String((JSON.parse(String(init.body)) as { content: string }).content));
      return new Response(JSON.stringify({ id: "1" }));
    }
    return base(input, init);
  });
  return posted;
}

async function matchedWithWin() {
  await raise(h.seeded.kmuId);
  await raise(h.seeded.utId);
  await confirm();
  const match = (await slotOf(21)).matches[0]!;
  const form = new FormData();
  form.set("teamId", String(h.seeded.kmuId));
  form.set("points", "7");
  form.set("image", new File([new Uint8Array([137, 80, 78, 71])], "s.png", { type: "image/png" }));
  await h.postForm(`/api/matches/${match.id}/wins`, form, { cookie });
}

describe("POST /api/match-slots/confirm（マッチングの確定）", () => {
  it("未マッチングの対戦枠の挙手を組み、マッチング済みにして、結果を投稿する。勝利の記録もできる", async () => {
    const posted = await withChannel();
    await raise(h.seeded.kmuId);
    await raise(h.seeded.utId);

    expect((await confirm()).status).toBe(200);

    const slot = await slotOf(21);
    expect(slot.matched).toBe(true);
    expect(slot.matches).toHaveLength(1);
    expect(posted).toHaveLength(1);
  });

  it("挙手がなくても確定できる（組分けは空）。チャンネルが未設定なら、投稿せずに保存だけする", async () => {
    expect((await confirm(22)).status).toBe(200);
    expect(await slotOf(22)).toMatchObject({ matched: true, matches: [] });
  });

  it("確定済みの対戦枠は 409。締切の時刻が来ても、cron で二重に確定されない", async () => {
    await confirm();
    expect(await confirm()).toMatchObject({ status: 409, body: { error: "slot_matched" } });
  });

  it("登録されていない試合時刻は 404。入力が不正なら 400", async () => {
    expect((await confirm(20)).status).toBe(404);
    expect((await confirm(24)).status).toBe(400);
  });

  it("日付を指定できる。管理者が追加した組分けは、残る", async () => {
    await h.json("/api/matches", { method: "POST", cookie, body: { teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21, slotDate: "2026-10-09" } });
    expect((await confirm(21, { slotDate: "2026-10-09" })).status).toBe(200);
    const { body } = await h.json<{ slots: Slot[] }>("/api/board?date=2026-10-09", { cookie });
    expect(body.slots.find((slot) => slot.hour === 21)).toMatchObject({ matched: true });
    expect(body.slots.find((slot) => slot.hour === 21)!.matches).toHaveLength(1);
  });
});

describe("POST /api/match-slots/reopen（やり直し）", () => {
  it("組分けと勝利（と画像）を消して、未マッチングに戻す。挙手は残り、もう一度確定できる", async () => {
    await matchedWithWin();
    expect([...h.r2.objects.keys()]).toHaveLength(1);

    const result = await reopen();

    expect(result).toMatchObject({ status: 200, body: { deletedMatches: 1, deletedWins: 1 } });
    expect(await slotOf(21)).toMatchObject({ matched: false, matches: [], excluded: null });
    expect((await slotOf(21)).handups).toHaveLength(2);
    expect([...h.r2.objects.keys()]).toHaveLength(0);
    expect((await confirm()).status).toBe(200);
    expect((await slotOf(21)).matches).toHaveLength(1);
  });

  it("やり直すと、Discord に、マッチングのキャンセルを投稿する（取り消された組分けのチームに、通知する）", async () => {
    const posted = await withChannel();
    await raise(h.seeded.kmuId);
    await raise(h.seeded.utId);
    await confirm();
    posted.length = 0;

    const result = await reopen();

    expect(result.body).toMatchObject({ ok: true, notified: true });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toBe(["## 21時のマッチングはキャンセルされました", `- <@&${KMU_ROLE}> vs <@&${UT_ROLE}>`].join("\n"));
  });

  it("組まれなかったチームも、キャンセルの投稿に出す", async () => {
    const posted = await withChannel();
    await raise(h.seeded.kmuId);
    await confirm();
    posted.length = 0;

    await reopen();

    expect(posted[0]).toBe(["## 21時のマッチングはキャンセルされました", `- <@&${KMU_ROLE}>（マッチングしていませんでした）`].join("\n"));
  });

  it("notify: false なら、投稿しない。組分けも除外チームもない対戦枠は、投稿しない", async () => {
    const posted = await withChannel();
    await raise(h.seeded.kmuId);
    await raise(h.seeded.utId);
    await confirm();
    await confirm(22);
    posted.length = 0;

    const quiet = await h.json<{ notified?: boolean }>("/api/match-slots/reopen", { method: "POST", cookie, body: { slotHour: 21, notify: false } });
    const empty = await reopen(22);

    expect(quiet.body.notified).toBe(false);
    expect(empty.body).toMatchObject({ ok: true });
    expect(posted).toEqual([]);
  });

  it("チャンネルが未設定なら、投稿しない。投稿に失敗しても、やり直しは、取り消さない（notified: false）", async () => {
    await raise(h.seeded.kmuId);
    await raise(h.seeded.utId);
    await confirm();
    expect((await reopen()).body).toMatchObject({ ok: true, notified: false, notifyFailed: false });

    await withChannel();
    await confirm();
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) =>
      String(input instanceof Request ? input.url : input).endsWith("/messages") ? new Response("{}", { status: 500 }) : base(input, init),
    );

    const failed = await reopen();

    expect(failed).toMatchObject({ status: 200, body: { notified: false, notifyFailed: true } });
    expect((await slotOf(21)).matched).toBe(false);
  });

  it("未マッチングの対戦枠は 409（slot_not_matched）。ほかの対戦枠は、変わらない", async () => {
    await confirm(22);
    expect(await reopen(21)).toMatchObject({ status: 409, body: { error: "slot_not_matched" } });
    expect((await slotOf(22)).matched).toBe(true);
  });

  it("締切の前なら、cron が自動で確定できるように戻す。締切を過ぎていれば、管理者が確定するまで、自動では確定されない", async () => {
    h.time.now = jst("2026-10-07T13:00:00");
    await confirm();
    await reopen();
    // 前: 確定の権利が戻っている（もう一度、確定できる＝権利を取れる）
    expect((await confirm()).status).toBe(200);

    h.time.now = jst("2026-10-07T21:00:00");
    await reopen();
    // 後: 権利は戻さない（cron は、同じキーを取れない）
    const { claimJob } = await import("@uc/db");
    expect(await claimJob(h.seeded.db, GUILD_ID, "cutoff:2026-10-07:21", 1)).toBe(false);
  });
});

describe("試合時刻を削除したあとの対戦枠", () => {
  const deleteHour = async (hour: number) => {
    const { body } = await h.json<{ slots: { id: number; hour: number }[] }>("/api/slots", { cookie });
    return h.json(`/api/slots/${body.slots.find((slot) => slot.hour === hour)!.id}`, { method: "DELETE", cookie });
  };
  const hours = async () => (await h.json<{ slots: (Slot & { deleted: boolean })[] }>("/api/board", { cookie })).body.slots.map((slot) => [slot.hour, slot.deleted]);

  it("マッチング済みの対戦枠は、削除した試合時刻でも、記録として出す（deleted: true）。時刻の順に並ぶ", async () => {
    await withChannel();
    await raise(h.seeded.kmuId);
    await raise(h.seeded.utId);
    await confirm();

    expect((await deleteHour(21)).status).toBe(200);

    expect(await hours()).toEqual([
      [21, true],
      [22, false],
      [23, false],
    ]);
    const slot = await slotOf(21);
    expect(slot.matched).toBe(true);
    expect(slot.matches).toHaveLength(1);
  });

  it("削除した試合時刻の対戦枠をやり直すときは、notify が true でも、Discord に投稿しない（やり直しは、できる）", async () => {
    const posted = await withChannel();
    await raise(h.seeded.kmuId);
    await raise(h.seeded.utId);
    await confirm();
    posted.length = 0;
    await deleteHour(21);

    const { status, body } = await h.json<{ notified?: boolean }>("/api/match-slots/reopen", { method: "POST", cookie, body: { slotHour: 21, notify: true } });

    expect(status).toBe(200);
    expect(body.notified).toBe(false);
    expect(posted).toEqual([]);
    // やり直したあとも、挙手が残っているので、削除済みの対戦枠は、未マッチングとして、画面に残る
    expect(await hours()).toEqual([
      [21, true],
      [22, false],
      [23, false],
    ]);
    expect((await slotOf(21)).matched).toBe(false);
  });

  it("未マッチングでも、その日に、挙手が残っていれば、削除した試合時刻の対戦枠を出す。記録が何もなければ、出さない", async () => {
    await raise(h.seeded.kmuId);

    await deleteHour(21);
    await deleteHour(22);

    expect(await hours()).toEqual([
      [21, true],
      [23, false],
    ]);
  });

});
