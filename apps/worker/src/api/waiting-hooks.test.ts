import {
  clearWaitingMessages,
  createTeam,
  defaultGuildSettings,
  findMatchSlot,
  saveGuildSettings,
  saveMatchResult,
  setWaitingAnnounceMessage,
  setWaitingMessage,
  startWaiting,
  stopWaiting,
} from "@uc/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUILD_ID, ROLE_NAMES, jst } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

/**
 * 管理者がダッシュボードから行う操作と、継続募集（待機）の関係を、フック（きっかけ → 起きること）ごとに確かめる。
 *   A. 組分けが追加された（管理者）   → 待機中のチームが組まれたなら、継続募集を終わらせる
 *   B. 対戦枠をやり直した             → 継続募集を終わらせる
 *   C. 待機を解除した（管理者）       → 待機を外し、募集のメッセージを削除する（案内の「待機する」は残る）
 * Discord への呼び出し（削除・編集）は、fetch の差し替えで記録する。
 */

const CHANNEL = "300000000000000001";
const NGT_ROLE = "400000000000000003";
const OFFER_ID = "9001";
const ANNOUNCE_ID = "9002";
const DATE = "2026-10-07";

let h: ApiHarness;
let cookie: string;
let ngtId: number;
let itfId: number;
/** Discord へ送られた、メッセージの 削除・編集 の記録 */
let discord: { method: string; path: string; body: unknown }[];
/** 削除を、このステータスで失敗させる（null なら、成功） */
let deleteStatus: number | null;

beforeEach(async () => {
  h = await createApiHarness();
  cookie = await h.login();
  discord = [];
  deleteStatus = null;
  ngtId = await createTeam(h.seeded.db, { guildId: GUILD_ID, roleId: NGT_ROLE, createdAt: 1 });
  itfId = await createTeam(h.seeded.db, { guildId: GUILD_ID, roleId: "400000000000000004", createdAt: 1 });
  await saveGuildSettings(h.seeded.db, GUILD_ID, { ...defaultGuildSettings, channelId: CHANNEL }, 1);

  // 21 時: KMU と UT が組まれ、NGT が組まれなかった。NGT が待機中で、案内（OFFER）と募集（ANNOUNCE）のメッセージが出ている
  await saveMatchResult(h.seeded.db, {
    guildId: GUILD_ID,
    slotDate: DATE,
    slotHour: 21,
    excludedTeamId: ngtId,
    pairs: [[h.seeded.kmuId, h.seeded.utId]],
    now: 1,
  });
  const slot = (await findMatchSlot(h.seeded.db, { guildId: GUILD_ID, slotDate: DATE, slotHour: 21 }))!;
  await setWaitingMessage(h.seeded.db, { id: slot.id, messageId: OFFER_ID });
  await setWaitingAnnounceMessage(h.seeded.db, { id: slot.id, messageId: ANNOUNCE_ID });
  await startWaiting(h.seeded.db, { id: slot.id, since: jst("2026-10-07T14:56:00").getTime() });

  // 時刻は、試合開始（21 時）の前
  h.time.now = jst("2026-10-07T20:56:00");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const message = /\/channels\/[^/]+\/messages(?:\/(\d+))?$/.exec(url);
    if (message && (method === "DELETE" || method === "PATCH")) {
      discord.push({ method, path: new URL(url).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "DELETE" && deleteStatus !== null) return new Response("failed", { status: deleteStatus });
      return method === "DELETE" ? new Response(null, { status: 204 }) : new Response("{}");
    }
    if (message && method === "POST") return new Response(JSON.stringify({ id: "9100" }));
    return new Response(JSON.stringify(Object.entries(ROLE_NAMES).map(([id, name], position) => ({ id, name, position }))));
  });
});

afterEach(() => vi.unstubAllGlobals());

const slotOf = async () => (await findMatchSlot(h.seeded.db, { guildId: GUILD_ID, slotDate: DATE, slotHour: 21 }))!;
const addMatch = (body: Record<string, unknown>) =>
  h.json<{ id?: number; error?: string }>("/api/matches", { method: "POST", cookie, body: { slotHour: 21, slotDate: DATE, ...body } });
const reopen = () => h.json<{ error?: string }>("/api/match-slots/reopen", { method: "POST", cookie, body: { slotHour: 21, slotDate: DATE, notify: false } });
const cancelWaiting = (body: Record<string, unknown> = {}) =>
  h.json<{ ok?: true; error?: string }>("/api/match-slots/cancel-waiting", { method: "POST", cookie, body: { slotHour: 21, slotDate: DATE, ...body } });

/** 募集のメッセージの削除と、案内のメッセージの編集（ボタンを外す） */
const announceDeleted = { method: "DELETE", path: `/api/v10/channels/${CHANNEL}/messages/${ANNOUNCE_ID}`, body: undefined };
const offerEdited = (content: string) => ({ method: "PATCH", path: `/api/v10/channels/${CHANNEL}/messages/${OFFER_ID}`, body: { content, components: [] } });

describe("フック A: 組分けが追加された（管理者）→ 待機中のチームが組まれたなら、継続募集を終わらせる", () => {
  it("待機中のチームを、組分けに入れると、募集のメッセージを削除し、案内のボタンを外す。待機とメッセージの ID は、空になる", async () => {
    const result = await addMatch({ teamAId: ngtId, teamBId: itfId });

    expect(result.status).toBe(201);
    expect(discord).toEqual([announceDeleted, offerEdited("21時: 管理者が組分けを決めたため、待機は終わりました。")]);
    expect(await slotOf()).toMatchObject({ excludedTeamId: null, waitingSince: null, waitingMessageId: null, waitingAnnounceMessageId: null });
  });

  it("待機していないチーム同士を組んでも、継続募集は、そのまま続く（メッセージも、待機も、変わらない）", async () => {
    const lba = await createTeam(h.seeded.db, { guildId: GUILD_ID, roleId: "400000000000000005", createdAt: 1 });

    const result = await addMatch({ teamAId: itfId, teamBId: lba });

    expect(result.status).toBe(201);
    expect(discord).toEqual([]);
    expect(await slotOf()).toMatchObject({
      excludedTeamId: ngtId,
      waitingSince: jst("2026-10-07T14:56:00").getTime(),
      waitingMessageId: OFFER_ID,
      waitingAnnounceMessageId: ANNOUNCE_ID,
    });
  });

  it("Discord の削除に失敗しても、組分けの追加は成功する。メッセージの ID は残り、試合開始の定期実行が、やり直せる", async () => {
    deleteStatus = 500;

    const result = await addMatch({ teamAId: ngtId, teamBId: itfId });

    expect(result.status).toBe(201);
    expect(await slotOf()).toMatchObject({ excludedTeamId: null, waitingSince: null, waitingAnnounceMessageId: ANNOUNCE_ID });
  });
});

describe("フック B: 対戦枠をやり直した → 継続募集を終わらせる", () => {
  it("募集のメッセージを削除し、案内のボタンを外す。待機とメッセージの ID は、空になる。組まれなかったチームの印も、外れる", async () => {
    const result = await reopen();

    expect(result.status).toBe(200);
    expect(discord).toEqual([announceDeleted, offerEdited("21時: マッチングがやり直されたため、待機は終わりました。")]);
    expect(await slotOf()).toMatchObject({
      status: "open",
      excludedTeamId: null,
      waitingSince: null,
      waitingMessageId: null,
      waitingAnnounceMessageId: null,
    });
  });

  it("継続募集がない対戦枠のやり直しでは、Discord のメッセージには、触らない", async () => {
    const slot = await slotOf();
    // 継続募集が、すでに終わっている状態（待機もメッセージの ID も、空）にする
    await stopWaiting(h.seeded.db, slot.id);
    await clearWaitingMessages(h.seeded.db, { id: slot.id, offer: true, announce: true });

    await reopen();

    expect(discord).toEqual([]);
  });
});

describe("フック C: 待機を解除した（管理者）→ 待機を外し、募集のメッセージを削除する（案内の「待機する」は残る）", () => {
  it("待機を外し、募集のメッセージだけを削除する。案内は、編集しない（チームが、待機し直せる）。組まれなかったチームは、そのまま", async () => {
    const result = await cancelWaiting();

    expect(result).toMatchObject({ status: 200, body: { ok: true } });
    expect(discord).toEqual([announceDeleted]);
    expect(await slotOf()).toMatchObject({
      excludedTeamId: ngtId,
      waitingSince: null,
      waitingAnnounceMessageId: null,
      waitingMessageId: OFFER_ID,
    });
  });

  it("待機していない・試合開始を過ぎている対戦枠は、解除できない（409 not_waiting）。何も変わらない", async () => {
    h.time.now = jst("2026-10-07T21:00:00");
    const late = await cancelWaiting();
    expect(late).toMatchObject({ status: 409, body: { error: "not_waiting" } });

    h.time.now = jst("2026-10-07T20:56:00");
    await cancelWaiting();
    const again = await cancelWaiting();
    expect(again).toMatchObject({ status: 409, body: { error: "not_waiting" } });
    expect(discord).toEqual([announceDeleted]);
  });

  it("登録のない試合時刻は 404。入力が不正なら 400。ログインがなければ 401", async () => {
    expect(await cancelWaiting({ slotHour: 5 })).toMatchObject({ status: 404 });
    expect(await cancelWaiting({ slotHour: 24 })).toMatchObject({ status: 400 });

    const anonymous = await h.json("/api/match-slots/cancel-waiting", { method: "POST", body: { slotHour: 21 } });
    expect(anonymous.status).toBe(401);
  });

  it("Discord の削除に失敗しても、待機の解除は成功する。メッセージの ID は残り、試合開始の定期実行が、やり直せる", async () => {
    deleteStatus = 500;

    const result = await cancelWaiting();

    expect(result.status).toBe(200);
    expect(await slotOf()).toMatchObject({ waitingSince: null, waitingAnnounceMessageId: ANNOUNCE_ID });
  });

  it("別のサーバーの対戦枠は、解除できない", async () => {
    const other = await h.login({ guildId: "999999999999999999" });

    const result = await h.json("/api/match-slots/cancel-waiting", { method: "POST", cookie: other, body: { slotHour: 21, slotDate: DATE } });

    expect(result.status).toBe(404);
    expect((await slotOf()).waitingSince).not.toBeNull();
  });
});
