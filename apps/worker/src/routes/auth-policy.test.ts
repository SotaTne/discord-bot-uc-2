import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { AppEnv } from "../env";
import { API_PREFIX, PUBLIC_API_PATHS } from "./api";

const app = createApp();
// DB も、公開鍵もない環境。認証で止まらなければ、処理に入って、500 になる（401 / 404 にならない）
const env = {} as AppEnv;

/** 登録されている、実際のルート（middleware を除く）。パスの `:id` や `*` は、適当な値にする */
const routes = [
  ...new Map(
    app.routes
      .filter((route) => route.method !== "ALL")
      .map((route) => [`${route.method} ${route.path}`, { method: route.method, path: route.path.replace(/:\w+/g, "1").replace(/\*/g, "x") }]),
  ).values(),
];

/** 認証のないリクエストで、そのルートを呼ぶ（Origin は、同じオリジンにして、Origin の確認では、止まらないようにする） */
const callWithoutCredentials = (route: { method: string; path: string }) =>
  app.request(route.path, { method: route.method, headers: { Origin: "http://localhost" } }, env);

describe("認証の方針: すべてのルートが、認証つきか、公開と決めたものか", () => {
  it("ルートを、もれなく列挙できている（空ではなく、主なルートが入っている）", () => {
    const paths = routes.map((route) => route.path);
    expect(paths).toEqual(expect.arrayContaining(["/api/board", "/api/scores", "/api/settings", "/interactions"]));
  });

  it("/api のルートは、公開と決めたもの以外、セッションがなければ 401", async () => {
    const api = routes.filter((route) => route.path.startsWith(`${API_PREFIX}/`));
    const protectedRoutes = api.filter((route) => !PUBLIC_API_PATHS.has(route.path));
    expect(protectedRoutes.length).toBeGreaterThan(20);

    for (const route of protectedRoutes) {
      const response = await callWithoutCredentials(route);
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("公開と決めたパスは、実在する（古いパスが、許可リストに残らない）。ほかに、公開のルートは、ない", () => {
    const apiPaths = new Set(routes.filter((route) => route.path.startsWith(`${API_PREFIX}/`)).map((route) => route.path));

    for (const path of PUBLIC_API_PATHS) expect(apiPaths.has(path), path).toBe(true);
  });

  it("/interactions は、Discord の署名がなければ 401", async () => {
    for (const route of routes.filter((route) => route.path.startsWith("/interactions"))) {
      expect((await callWithoutCredentials(route)).status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("本番の入口（createApp）には、/dev/*（認証がない、開発専用のルート）が、1 つもない。開発の入口（createDevApp）だけが、足す", () => {
    expect(routes.filter((route) => route.path.startsWith("/dev"))).toEqual([]);
  });

  it("どの方針にも入らないルートは、ない（新しい入口を足したら、ここに、認証の方針を書く）", () => {
    const known = [`${API_PREFIX}/`, "/interactions"];
    const unknown = routes.filter((route) => !known.some((prefix) => route.path.startsWith(prefix)));

    expect(unknown).toEqual([]);
  });
});
