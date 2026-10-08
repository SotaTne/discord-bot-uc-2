import { findActiveSession } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../security/tokens";
import { ADMIN_USER, GUILD_ID, jst } from "../test-helpers";
import { createApiHarness, type ApiHarness } from "./harness";

let h: ApiHarness;
beforeEach(async () => {
  h = await createApiHarness();
});

const login = (token: string, options: Parameters<ApiHarness["json"]>[1] = {}) =>
  h.json("/api/login", { method: "POST", body: { token }, ...options });

describe("POST /api/login", () => {
  it("有効なリンクで、セッションの Cookie を発行する（HttpOnly・SameSite=Strict・7日）", async () => {
    const result = await login(await h.issueLink());

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    const cookie = result.response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^uc_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=604800");
    // 開発中の http では Secure を付けない
    expect(cookie).not.toContain("Secure");
  });

  it("https では、__Host- プレフィックスと Secure を付ける", async () => {
    const base = "https://dash.example";
    const token = await h.issueLink();
    const response = await h.call("/api/login", {
      base,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-uc_session=/);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Domain");
  });

  it("セッションは、ログインしたサーバーとユーザーのものになり、トークン自体は保存しない（ハッシュだけ）", async () => {
    const cookie = await h.login();
    const sessionToken = cookie.split("=")[1] ?? "";

    const session = await findActiveSession(h.seeded.db, await sha256Hex(sessionToken), h.time.now.getTime());

    expect(session).toMatchObject({ guildId: GUILD_ID, userId: ADMIN_USER });
    expect(JSON.stringify(await h.seeded.db.query.sessions.findMany())).not.toContain(sessionToken);
  });

  it("リンクは1回しか使えない。2回目は拒否される", async () => {
    const token = await h.issueLink();

    expect((await login(token)).status).toBe(200);
    const second = await login(token);

    expect(second.status).toBe(401);
    expect(second.body).toEqual({ error: "invalid_or_expired" });
    expect(second.response.headers.get("set-cookie")).toBeNull();
  });

  it("有効期限（1時間）を過ぎたリンクは、使えない", async () => {
    const token = await h.issueLink();
    h.time.now = new Date(h.time.now.getTime() + 60 * 60 * 1000);

    expect((await login(token)).status).toBe(401);
  });

  it("有効期限の直前なら、使える", async () => {
    const token = await h.issueLink();
    h.time.now = new Date(h.time.now.getTime() + 60 * 60 * 1000 - 1);

    expect((await login(token)).status).toBe(200);
  });

  it("存在しないトークンは、使用済み・期限切れと同じ応答になる（区別を教えない）", async () => {
    const result = await login("x".repeat(43));
    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "invalid_or_expired" });
  });

  it("形式が違う（短すぎる）トークンは 400", async () => {
    expect((await login("short")).status).toBe(400);
  });

  it("Origin がない・別のオリジンからは、ログインできない（リンクも消費されない）", async () => {
    const token = await h.issueLink();

    expect((await login(token, { origin: null })).status).toBe(403);
    expect((await login(token, { origin: "https://evil.example" })).status).toBe(403);
    expect((await login(token)).status).toBe(200);
  });

  it("同時に2回ログインしても、成功するのは1回だけ", async () => {
    const token = await h.issueLink();

    const results = await Promise.all([login(token), login(token)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await h.seeded.db.query.sessions.findMany()).toHaveLength(1);
  });
});

describe("セッションが必要な API", () => {
  it("Cookie がなければ 401。形式が不正な Cookie も 401", async () => {
    expect((await h.json("/api/me")).status).toBe(401);
    expect((await h.json("/api/me", { cookie: "uc_session=nonsense" })).status).toBe(401);
  });

  it("ログイン後は、サーバーとユーザーが分かる", async () => {
    const cookie = await h.login();
    expect(await h.json("/api/me", { cookie })).toMatchObject({
      status: 200,
      body: { guildId: GUILD_ID, userId: ADMIN_USER },
    });
  });

  it("サーバーの現在時刻（epoch ミリ秒）も返す。動かせる時計に従う", async () => {
    const cookie = await h.login();
    h.time.now = new Date("2026-10-07T21:30:00+09:00");
    const { body } = await h.json<{ now: number }>("/api/me", { cookie });
    expect(body.now).toBe(h.time.now.getTime());
  });

  it("/api/health は、ログインなしでも使える", async () => {
    expect((await h.json("/api/health")).status).toBe(200);
  });

  it("セッションは、発行から7日で切れる（使っても延びない）", async () => {
    const cookie = await h.login();
    const day = 24 * 60 * 60 * 1000;
    const start = h.time.now.getTime();

    h.time.now = new Date(start + 3 * day);
    expect((await h.json("/api/me", { cookie })).status).toBe(200);

    h.time.now = new Date(start + 7 * day - 1);
    expect((await h.json("/api/me", { cookie })).status).toBe(200);

    h.time.now = new Date(start + 7 * day);
    expect((await h.json("/api/me", { cookie })).status).toBe(401);
  });

  it("ほかの時刻の設定に影響されない（時計は注入されている）", async () => {
    const cookie = await h.login();
    h.time.now = jst("2030-01-01T00:00:00");
    expect((await h.json("/api/me", { cookie })).status).toBe(401);
  });
});

describe("POST /api/logout", () => {
  it("セッションを失効させて、Cookie を消す。以降、そのセッションは使えない", async () => {
    const cookie = await h.login();

    const result = await h.json("/api/logout", { method: "POST", cookie });

    expect(result.status).toBe(200);
    expect(result.response.headers.get("set-cookie")).toMatch(/^uc_session=;/);
    expect((await h.json("/api/me", { cookie })).status).toBe(401);
  });

  it("ログインしていなくても、エラーにならない", async () => {
    expect((await h.json("/api/logout", { method: "POST" })).status).toBe(200);
  });

  it("Origin がなければ 403", async () => {
    const cookie = await h.login();
    expect((await h.json("/api/logout", { method: "POST", cookie, origin: null })).status).toBe(403);
    expect((await h.json("/api/me", { cookie })).status).toBe(200);
  });
});
