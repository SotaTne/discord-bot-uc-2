import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SLOT_HOURS, TEAMS, installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

const TOKEN = "abcDEF0123456789_-abcDEF0123456789_-abcdefg";

/** ログイン後に開かれるトップ（挙手）の画面が使う API */
const homeApis = {
  "GET /api/handups": { body: { date: "2026-10-07", handups: [] } },
  "GET /api/slot-hours": { body: SLOT_HOURS },
  "GET /api/teams": { body: TEAMS },
};

describe("ログインの確認画面（/login#token=...）", () => {
  it("リンクを開いただけでは、トークンを送らない（先読みで使い切らない）", async () => {
    const backend = installFakeBackend({});
    renderApp(`/login#token=${TOKEN}`);

    expect(await screen.findByRole("button", { name: "ダッシュボードへ入る" })).toBeTruthy();
    expect(backend.calls).toEqual([]);
  });

  it("「ダッシュボードへ入る」を押すと、トークンを送ってログインし、トップへ移る", async () => {
    const backend = installFakeBackend({
      "POST /api/login": { body: { ok: true } },
      ...loggedIn,
      ...homeApis,
    });
    renderApp(`/login#token=${TOKEN}`);

    fireEvent.click(await screen.findByRole("button", { name: "ダッシュボードへ入る" }));

    expect(await screen.findByRole("navigation", { name: "メニュー" })).toBeTruthy();
    expect(backend.last("POST", "/api/login")?.json).toEqual({ token: TOKEN });
    expect(backend.count("POST", "/api/login")).toBe(1);
  });

  it("リンクが使用済み・期限切れなら、その旨を出して、画面に留まる", async () => {
    installFakeBackend({ "POST /api/login": { status: 401, body: { error: "invalid_or_expired" } } });
    renderApp(`/login#token=${TOKEN}`);

    fireEvent.click(await screen.findByRole("button", { name: "ダッシュボードへ入る" }));

    expect((await screen.findByRole("alert")).textContent).toContain("使用済みか、期限切れ");
    expect(screen.queryByRole("navigation", { name: "メニュー" })).toBeNull();
  });

  it("押している間は、もう一度押せない（二重に送らない）", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const backend = installFakeBackend({
      "POST /api/login": async () => {
        await gate;
        return { status: 401, body: { error: "invalid_or_expired" } };
      },
    });
    renderApp(`/login#token=${TOKEN}`);

    const button = await screen.findByRole("button", { name: "ダッシュボードへ入る" });
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(button);
    release();

    await screen.findByRole("alert");
    expect(backend.count("POST", "/api/login")).toBe(1);
  });

  it("トークンがない・短すぎるリンクは、発行し直すよう案内する（送信もしない）", async () => {
    const backend = installFakeBackend({});
    renderApp("/login#token=short");

    expect((await screen.findByRole("alert")).textContent).toContain("/uc-admin-dashboard");
    expect(screen.queryByRole("button", { name: "ダッシュボードへ入る" })).toBeNull();
    expect(backend.calls).toEqual([]);
  });
});
