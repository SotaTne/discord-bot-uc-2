import { render } from "@testing-library/react";
import { vi } from "vitest";
import { App, createQueryClient } from "../App";
import { createAppRouter } from "../router";

type FakeRequest = {
  method: string;
  /** /api/handups など（クエリ文字列は含まない） */
  path: string;
  query: URLSearchParams;
  /** JSON のボディ。JSON でなければ null */
  json: unknown;
  /** multipart のボディ */
  form: FormData | null;
};

type FakeResponse = { status?: number; body?: unknown } | Response;
type Handler = FakeResponse | ((request: FakeRequest) => FakeResponse | Promise<FakeResponse>);

export type RecordedCall = Pick<FakeRequest, "method" | "path" | "json" | "form"> & { query: string };

/**
 * ダッシュボードの API（worker）の代わりになる、テスト用の通信。
 * "GET /api/slots" のように、メソッドとパスで、返す内容を決める。決めていない呼び出しがあれば、テストを失敗させる。
 */
export function installFakeBackend(routes: Record<string, Handler>) {
  const handlers = new Map(Object.entries(routes));
  const calls: RecordedCall[] = [];

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://dash.test");
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = init?.body;

    const request: FakeRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      json: typeof body === "string" ? safeJson(body) : null,
      form: body instanceof FormData ? body : null,
    };
    calls.push({ method, path: url.pathname, query: url.search, json: request.json, form: request.form });

    const handler = handlers.get(`${method} ${url.pathname}`);
    if (handler === undefined) {
      throw new Error(`テストで用意していない API の呼び出しです: ${method} ${url.pathname}${url.search}`);
    }
    const result = typeof handler === "function" ? await handler(request) : handler;
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result.body ?? null), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  vi.stubGlobal("fetch", fakeFetch);

  return {
    calls,
    /** 呼び出された回数（メソッドとパスで数える） */
    count: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path).length,
    /** 途中で、返す内容を変える */
    set: (route: string, handler: Handler) => void handlers.set(route, handler),
    last: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path).at(-1),
  };
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** アプリを、指定した URL を開いた状態で描画する */
export function renderApp(path = "/") {
  const router = createAppRouter({ initialPath: path });
  render(<App router={router} queryClient={createQueryClient()} />);
  return { router };
}

/** ログイン済みの、最低限の API（/api/me） */
export const loggedIn = { "GET /api/me": { body: { guildId: "200000000000000001", userId: "500000000000000005", now: Date.parse("2026-10-07T15:00:00+09:00") } } } as const;

/** 画面のテストで使う、共通のデータ */
export const TEAMS = {
  teams: [
    { id: 1, name: "KMU", roleId: "400000000000000001" },
    { id: 2, name: "UT", roleId: "400000000000000002" },
  ],
};
export const SLOTS = {
  slots: [
    { id: 11, hour: 21 },
    { id: 12, hour: 22 },
    { id: 13, hour: 23 },
  ],
};
