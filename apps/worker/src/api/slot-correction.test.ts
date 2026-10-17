import { defaultGuildSettings, saveGuildSettings, saveMatchResult } from "@uc/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GUILD_ID, jst } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

/**
 * 運営モード / 補正モード（`slotOperations`）の、API のテスト。
 *   運営（マッチング前で、試合開始前）: 挙手を直して、マッチング処理を実行できる
 *   補正（マッチング済み、または試合開始後）: 記録を直すだけ。マッチングはしない。試合開始前は、組分けの変更を、Discord に知らせる選択ができる
 * 21 時の対戦枠、K = 7（締切は 20:53）、試合開始は 21:00。
 */

let h: ApiHarness;
let cookie: string;
beforeEach(async () => {
  h = await createApiHarness();
  cookie = await h.login();
});

type Slot = { hour: number; matched: boolean; mode: string; canRunMatching: boolean; canReopen: boolean; canNotifyEdit: boolean; matches: { id: number }[] };
const slotOf = async (hour = 21) => (await h.json<{ slots: Slot[] }>("/api/board", { cookie })).body.slots.find((slot) => slot.hour === hour)!;

const markMatched = (hour = 21, pairs: [number, number][] = []) =>
  saveMatchResult(h.seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: hour, excludedTeamId: null, pairs, now: 2 });

const addMatch = (body: Record<string, unknown> = {}) =>
  h.json<{ id: number; notified: boolean; notifyFailed: boolean }>("/api/matches", {
    method: "POST",
    cookie,
    body: { teamAId: h.seeded.kmuId, teamBId: h.seeded.utId, slotHour: 21, ...body },
  });
const deleteMatch = (id: number, query = "") =>
  h.json<{ ok: boolean; notified: boolean; notifyFailed: boolean }>(`/api/matches/${id}${query}`, { method: "DELETE", cookie });

/** 投稿先のチャンネルを設定して、Discord への投稿を記録する（status を渡すと、投稿が、その結果で失敗する） */
async function withChannel(status = 200) {
  await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: "123456789012345678" }, 1);
  const posted: string[] = [];
  const base = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/messages") && init?.method === "POST") {
      posted.push(String((JSON.parse(String(init.body)) as { content: string }).content));
      return new Response(JSON.stringify({ id: "1" }), { status });
    }
    return base(input, init);
  });
  return posted;
}

describe("/api/board: 対戦枠ごとの、管理者の操作の可否", () => {
  it("未マッチングで試合開始前: 運営モード（マッチング処理ができる。やり直し・通知の選択はない）", async () => {
    expect(await slotOf()).toMatchObject({ mode: "operate", canRunMatching: true, canReopen: false, canNotifyEdit: false });
  });

  it("マッチング済みで試合開始前: 補正モード（やり直しと、通知の選択ができる。マッチング処理はできない）", async () => {
    await markMatched();
    h.time.now = jst("2026-10-07T20:55:00");

    expect(await slotOf()).toMatchObject({ mode: "correct", canRunMatching: false, canReopen: true, canNotifyEdit: true });
  });

  it("試合開始後: マッチング済みでも、未マッチングでも、補正モード（何も、実行できない）", async () => {
    await markMatched(21);
    h.time.now = jst("2026-10-07T21:00:00");

    expect(await slotOf(21)).toMatchObject({ mode: "correct", canRunMatching: false, canReopen: false, canNotifyEdit: false });
    expect(await slotOf(22)).toMatchObject({ mode: "operate", canRunMatching: true });
    h.time.now = jst("2026-10-07T22:00:00");
    expect(await slotOf(22)).toMatchObject({ mode: "correct", canRunMatching: false });
  });
});

describe("試合開始後は、マッチング処理もやり直しも、しない", () => {
  it("マッチング処理: 試合開始後の未マッチングの対戦枠は 409（slot_started）。開始前は、できる", async () => {
    const confirm = (slotHour: number) => h.json<{ error?: string }>("/api/match-slots/confirm", { method: "POST", cookie, body: { slotHour } });
    h.time.now = jst("2026-10-07T21:00:00");

    expect(await confirm(21)).toMatchObject({ status: 409, body: { error: "slot_started" } });
    expect((await confirm(22)).status).toBe(200);
  });

  it("やり直し: 試合開始後のマッチング済みの対戦枠は 409（slot_started）。組分けは、残る", async () => {
    await markMatched(21, [[h.seeded.kmuId, h.seeded.utId]]);
    h.time.now = jst("2026-10-07T21:00:00");

    const result = await h.json<{ error?: string }>("/api/match-slots/reopen", { method: "POST", cookie, body: { slotHour: 21 } });

    expect(result).toMatchObject({ status: 409, body: { error: "slot_started" } });
    expect((await slotOf()).matches).toHaveLength(1);
  });

  it("やり直し: 試合開始前なら、マッチング済みの対戦枠を、やり直せる（締切のあとでも）", async () => {
    await markMatched(21, [[h.seeded.kmuId, h.seeded.utId]]);
    h.time.now = jst("2026-10-07T20:59:00");

    const result = await h.json<{ deletedMatches?: number }>("/api/match-slots/reopen", { method: "POST", cookie, body: { slotHour: 21, notify: false } });

    expect(result).toMatchObject({ status: 200, body: { deletedMatches: 1 } });
  });
});

describe("組分けの追加・削除の通知（補正モードで、試合開始前のときだけ、選べる）", () => {
  it("マッチング済み・試合開始前: notify: true で、追加を投稿する（何試合目・主催つき）。既定は、投稿しない", async () => {
    const posted = await withChannel();
    await markMatched();
    h.time.now = jst("2026-10-07T20:55:00");

    const silent = await addMatch();
    expect(silent.body).toMatchObject({ notified: false, notifyFailed: false });
    expect(posted).toEqual([]);

    await deleteMatch(silent.body.id);
    const loud = await addMatch({ notify: true });

    expect(loud.body).toMatchObject({ notified: true, notifyFailed: false });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("## 21時の組分けが変更されました");
    expect(posted[0]).toMatch(/- 追加: .*（1試合目） vs .*（1試合目）・主催: /);
  });

  it("マッチング済み・試合開始前: ?notify=true で、削除を投稿する。付けなければ、投稿しない", async () => {
    const posted = await withChannel();
    await markMatched(21, [[h.seeded.kmuId, h.seeded.utId]]);
    h.time.now = jst("2026-10-07T20:55:00");
    const [first] = (await slotOf()).matches;

    const silent = await deleteMatch(first!.id);
    expect(silent.body).toMatchObject({ ok: true, notified: false });
    expect(posted).toEqual([]);

    const again = await addMatch();
    const loud = await deleteMatch(again.body.id, "?notify=true");

    expect(loud.body).toMatchObject({ notified: true });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatch(/## 21時の組分けが変更されました\n- 削除: /);
  });

  it("運営モード（マッチング前）では、notify: true でも、投稿しない（結果の投稿に、含まれる）", async () => {
    const posted = await withChannel();

    const result = await addMatch({ notify: true });

    expect(result.body).toMatchObject({ notified: false });
    expect(posted).toEqual([]);
  });

  it("試合開始後は、notify: true でも、投稿しない（記録の補正だけ）", async () => {
    const posted = await withChannel();
    await markMatched();
    h.time.now = jst("2026-10-07T21:30:00");

    const added = await addMatch({ notify: true });
    const removed = await deleteMatch(added.body.id, "?notify=true");

    expect(added.status).toBe(201);
    expect(added.body.notified).toBe(false);
    expect(removed.body.notified).toBe(false);
    expect(posted).toEqual([]);
  });

  it("投稿に失敗しても、組分けの追加・削除は成功する（notifyFailed で知らせる）", async () => {
    await withChannel(500);
    await markMatched();
    h.time.now = jst("2026-10-07T20:55:00");

    const added = await addMatch({ notify: true });
    const removed = await deleteMatch(added.body.id, "?notify=true");

    expect(added).toMatchObject({ status: 201, body: { notified: false, notifyFailed: true } });
    expect(removed).toMatchObject({ status: 200, body: { ok: true, notifyFailed: true } });
    expect((await slotOf()).matches).toEqual([]);
  });

  it("投稿先のチャンネルが決まっていなければ、notify: true でも、何も投稿しない（失敗にも、しない）", async () => {
    await markMatched();
    h.time.now = jst("2026-10-07T20:55:00");

    expect((await addMatch({ notify: true })).body).toMatchObject({ notified: false, notifyFailed: false });
  });
});
