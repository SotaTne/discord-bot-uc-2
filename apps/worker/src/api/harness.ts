import { createDashboardLink } from "@uc/db";
import { vi } from "vitest";
import { createApp } from "../app";
import type { AppEnv } from "../env";
import { generateToken, sha256Hex } from "../security/tokens";
import { ADMIN_USER, GUILD_ID, ROLE_NAMES, USER_NAMES, createFakeR2, createSeededDb, jst } from "../test-helpers";

export const BASE = "http://dash.test";

type CallOptions = Omit<RequestInit, "headers"> & {
  /** ログイン済みの Cookie（login() の戻り値） */
  cookie?: string | undefined;
  /** 省略すると、同じオリジン。null なら、Origin ヘッダーを付けない */
  origin?: string | null;
  headers?: Record<string, string>;
  base?: string;
};

/**
 * ダッシュボード API のテスト用の環境。
 * シード済みの DB（チーム KMU・UT、試合枠 21〜23 時）、R2 の代わり、動かせる時計を持つ。
 * ログインは、本物と同じ流れ（リンクの発行 → POST /api/login）で行う。
 */
export async function createApiHarness(extraEnv: Partial<AppEnv> = {}) {
  // チームの表示名は、Discord のロール名を使う。ロール一覧だけ返す（個別のテストは、stubGlobal で上書きできる）
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const member = /\/guilds\/[^/]+\/members\/(\d+)$/.exec(url);
    if (member) {
      const username = USER_NAMES[member[1] ?? ""];
      return username
        ? new Response(JSON.stringify({ nick: null, user: { id: member[1], username } }))
        : new Response(JSON.stringify({ message: "Unknown Member" }), { status: 404 });
    }
    return new Response(JSON.stringify(Object.entries(ROLE_NAMES).map(([id, name], position) => ({ id, name, position }))));
  });
  const seeded = await createSeededDb();
  const r2 = createFakeR2();
  const time = { now: jst("2026-10-07T15:00:00") };

  const app = createApp({ clock: { now: () => new Date(time.now) } });
  const env = {
    DB: seeded.db.$client,
    SCREENSHOTS: r2.bucket,
    DISCORD_BOT_TOKEN: "test-bot-token",
    DISCORD_API_BASE: "http://discord.mock/api/v10",
    ...extraEnv,
  } as AppEnv;

  const call = (path: string, options: CallOptions = {}): Promise<Response> => {
    const { cookie, origin, headers, base = BASE, ...init } = options;
    const requestHeaders: Record<string, string> = { ...headers };
    if (cookie) requestHeaders.Cookie = cookie;
    if (origin !== null) requestHeaders.Origin = origin ?? base;
    return Promise.resolve(app.request(`${base}${path}`, { ...init, headers: requestHeaders }, env));
  };

  /** JSON を送って、ステータスと JSON の本文を返す */
  const json = async <T = unknown>(path: string, options: Omit<CallOptions, "body"> & { body?: unknown } = {}) => {
    const { body, headers, ...rest } = options;
    const response = await call(path, {
      ...rest,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T, response };
  };

  /** multipart/form-data を POST して、ステータスと JSON の本文を返す */
  const postForm = async <T = unknown>(path: string, form: FormData, options: Omit<CallOptions, "body" | "method"> = {}) => {
    const response = await call(path, { ...options, method: "POST", body: form });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T, response };
  };

  /** ログインリンクを発行する（/uc-admin-dashboard と同じ保存のしかた） */
  async function issueLink(input: { guildId?: string; userId?: string; ttlMs?: number } = {}) {
    const token = generateToken();
    await createDashboardLink(seeded.db, {
      tokenHash: await sha256Hex(token),
      guildId: input.guildId ?? GUILD_ID,
      issuedBy: input.userId ?? ADMIN_USER,
      expiresAt: time.now.getTime() + (input.ttlMs ?? 60 * 60 * 1000),
      createdAt: time.now.getTime(),
    });
    return token;
  }

  /** ログインして、以降のリクエストに付ける Cookie を返す */
  async function login(input: { guildId?: string; userId?: string; base?: string } = {}): Promise<string> {
    const token = await issueLink(input);
    const response = await call("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      ...(input.base ? { base: input.base } : {}),
    });
    if (response.status !== 200) throw new Error(`ログインに失敗しました: ${response.status}`);
    const setCookie = response.headers.get("set-cookie") ?? "";
    return setCookie.split(";")[0] ?? "";
  }

  return { seeded, r2, time, app, env, call, json, postForm, issueLink, login };
}

export type ApiHarness = Awaited<ReturnType<typeof createApiHarness>>;
