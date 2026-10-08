import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_USER } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

let h: ApiHarness;
beforeEach(async () => {
  h = await createApiHarness();
});

type SessionRow = { id: number; userId: string; userName: string; userAgent: string | null; current: boolean; expiresAt: number };
const list = (cookie: string) => h.json<{ sessions: SessionRow[] }>("/api/sessions", { cookie });

describe("GET /api/sessions", () => {
  it("有効なセッションを一覧する。いま使っているものには current が付く", async () => {
    const first = await h.login({ userId: "admin-a" });
    const second = await h.login({ userId: "admin-b" });

    const { body } = await list(first);

    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.map((s) => [s.userId, s.current]).sort()).toEqual([
      ["admin-a", true],
      ["admin-b", false],
    ]);
    expect((await list(second)).body.sessions.find((s) => s.userId === "admin-b")?.current).toBe(true);
  });

  it("ログインした人を、Discord での表示名でも返す。取れない人は、ID のまま", async () => {
    const cookie = await h.login({ userId: ADMIN_USER });
    await h.login({ userId: "900000000000000009" });

    const { body } = await list(cookie);

    expect(body.sessions.map((s) => s.userName).sort()).toEqual(["900000000000000009", "管理者さん"].sort());
  });

  it("有効期限（発行から7日）が分かる", async () => {
    const cookie = await h.login();
    const [session] = (await list(cookie)).body.sessions;
    expect(session?.expiresAt).toBe(h.time.now.getTime() + 7 * 24 * 60 * 60 * 1000);
  });

  it("別のサーバーのセッションは、一覧に出ない", async () => {
    const cookie = await h.login();
    await h.login({ guildId: "999999999999999999" });

    expect((await list(cookie)).body.sessions).toHaveLength(1);
  });

  it("失効したセッションは、一覧に出ない", async () => {
    const first = await h.login();
    const second = await h.login();
    const id = (await list(first)).body.sessions.find((s) => !s.current)!.id;
    await h.json(`/api/sessions/${id}`, { method: "DELETE", cookie: first });

    expect((await list(first)).body.sessions).toHaveLength(1);
    expect((await h.json("/api/me", { cookie: second })).status).toBe(401);
  });
});

describe("DELETE /api/sessions/:id", () => {
  it("ほかのセッションを失効させると、そのセッションは使えなくなる（自分は使える）", async () => {
    const mine = await h.login();
    const other = await h.login();
    const otherId = (await list(mine)).body.sessions.find((s) => !s.current)!.id;

    expect((await h.json(`/api/sessions/${otherId}`, { method: "DELETE", cookie: mine })).status).toBe(200);

    expect((await h.json("/api/me", { cookie: other })).status).toBe(401);
    expect((await h.json("/api/me", { cookie: mine })).status).toBe(200);
  });

  it("自分のセッションを失効させると、Cookie も消える", async () => {
    const cookie = await h.login();
    const id = (await list(cookie)).body.sessions[0]!.id;

    const result = await h.json(`/api/sessions/${id}`, { method: "DELETE", cookie });

    expect(result.status).toBe(200);
    expect(result.response.headers.get("set-cookie")).toMatch(/^uc_session=;/);
    expect((await h.json("/api/me", { cookie })).status).toBe(401);
  });

  it("存在しない・別のサーバーのセッションは 404。ID が不正なら 400", async () => {
    const cookie = await h.login();
    const foreign = await h.login({ guildId: "999999999999999999" });
    const foreignId = (await list(foreign)).body.sessions[0]!.id;

    expect((await h.json("/api/sessions/9999", { method: "DELETE", cookie })).status).toBe(404);
    expect((await h.json(`/api/sessions/${foreignId}`, { method: "DELETE", cookie })).status).toBe(404);
    expect((await h.json("/api/sessions/abc", { method: "DELETE", cookie })).status).toBe(400);
    expect((await h.json("/api/me", { cookie: foreign })).status).toBe(200);
  });

  it("Origin がなければ、失効できない", async () => {
    const cookie = await h.login();
    const id = (await list(cookie)).body.sessions[0]!.id;

    expect((await h.json(`/api/sessions/${id}`, { method: "DELETE", cookie, origin: null })).status).toBe(403);
  });
});

describe("POST /api/sessions/revoke-all", () => {
  it("そのサーバーのセッションを、いま使っているものも含めてすべて失効させる（他のサーバーは影響しない）", async () => {
    const mine = await h.login();
    const other = await h.login({ userId: "admin-b" });
    const foreign = await h.login({ guildId: "999999999999999999" });

    const result = await h.json<{ revoked: number }>("/api/sessions/revoke-all", { method: "POST", cookie: mine });

    expect(result.body).toEqual({ revoked: 2 });
    expect(result.response.headers.get("set-cookie")).toMatch(/^uc_session=;/);
    expect((await h.json("/api/me", { cookie: mine })).status).toBe(401);
    expect((await h.json("/api/me", { cookie: other })).status).toBe(401);
    expect((await h.json("/api/me", { cookie: foreign })).status).toBe(200);
  });

  it("失効した後は、新しいリンクでもう一度ログインできる", async () => {
    const cookie = await h.login();
    await h.json("/api/sessions/revoke-all", { method: "POST", cookie });

    const again = await h.login({ userId: ADMIN_USER });
    expect((await h.json("/api/me", { cookie: again })).status).toBe(200);
  });
});
