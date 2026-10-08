import { createTestD1 } from "@uc/db/testing";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createApiHarness } from "../api/harness";
import { createApp } from "../app";
import type { AppEnv } from "../env";

const app = createApp();
const env = {} as AppEnv;

describe("/api", () => {
  it("GET /api/health は ok を返す", async () => {
    const response = await app.request("/api/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  describe("GET /api/health/db", () => {
    it("DB に Drizzle で接続できれば ok", async () => {
      const d1 = createTestD1() as unknown as D1Database;
      const response = await app.request("/api/health/db", {}, { DB: d1 } as AppEnv);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });

    it("マイグレーション前（テーブルがない）など、DB に問題があれば 503", async () => {
      const emptyDatabase = new DatabaseSync(":memory:");
      const d1 = createTestD1(emptyDatabase) as unknown as D1Database;
      const response = await app.request("/api/health/db", {}, { DB: d1 } as AppEnv);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false });
    });
  });

  it("存在しないパスは、ログインしていなければ 401（ルートの有無を教えない）", async () => {
    const response = await app.request("/api/unknown", {}, env);
    expect(response.status).toBe(401);
  });

  it("存在しないパスは、ログインしていれば 404", async () => {
    const h = await createApiHarness();
    const cookie = await h.login();
    expect((await h.call("/api/unknown", { cookie })).status).toBe(404);
  });

  it("Origin のない POST は、ルートがなくても先に 403 で止まる", async () => {
    const response = await app.request("/api/anything", { method: "POST" }, env);
    expect(response.status).toBe(403);
  });
});
