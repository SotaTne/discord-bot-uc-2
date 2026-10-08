import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { originGuard } from "./origin-guard";

const app = new Hono()
  .use(originGuard)
  .get("/thing", (c) => c.json({ ok: true }))
  .post("/thing", (c) => c.json({ ok: true }))
  .delete("/thing", (c) => c.json({ ok: true }));

const send = (method: string, origin?: string) =>
  app.request("http://dashboard.example/thing", {
    method,
    ...(origin ? { headers: { Origin: origin } } : {}),
  });

describe("originGuard", () => {
  it("GET は Origin がなくても通す", async () => {
    expect((await send("GET")).status).toBe(200);
  });

  it("同じオリジンからの POST / DELETE は通す", async () => {
    expect((await send("POST", "http://dashboard.example")).status).toBe(200);
    expect((await send("DELETE", "http://dashboard.example")).status).toBe(200);
  });

  it("Origin がない POST は 403", async () => {
    expect((await send("POST")).status).toBe(403);
  });

  it("別のオリジンからの POST / DELETE は 403", async () => {
    expect((await send("POST", "https://evil.example")).status).toBe(403);
    expect((await send("DELETE", "https://evil.example")).status).toBe(403);
  });

  it("オリジンが似ていても、スキームやポートが違えば 403", async () => {
    expect((await send("POST", "https://dashboard.example")).status).toBe(403);
    expect((await send("POST", "http://dashboard.example:8080")).status).toBe(403);
  });
});
