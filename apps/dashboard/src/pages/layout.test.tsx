import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SLOTS, TEAMS, installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

const homeApis = {
  "GET /api/board": { body: { date: "2026-10-07", today: "2026-10-07", slots: [] } },
  "GET /api/slots": { body: SLOTS },
  "GET /api/teams": { body: TEAMS },
};

describe("ログイン済みの画面の枠（レイアウト）", () => {
  it("ログインしていなければ、入り方を案内する（メニューは出さない）", async () => {
    installFakeBackend({ "GET /api/me": { status: 401, body: { error: "unauthorized" } } });
    renderApp("/");

    expect((await screen.findByRole("alert")).textContent).toContain("/uc-admin-dashboard");
    expect(screen.queryByRole("navigation", { name: "メニュー" })).toBeNull();
  });

  it("ログインしていれば、メニューと、開いたページが出る", async () => {
    installFakeBackend({ ...loggedIn, ...homeApis });
    renderApp("/");

    const nav = await screen.findByRole("navigation", { name: "メニュー" });
    expect(Array.from(nav.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["対戦枠", "チーム", "勝利記録", "設定"]);
    expect(await screen.findByRole("heading", { name: "10/07（水）" })).toBeTruthy();
  });

  it("ヘッダーに、いまの日付・曜日・時刻（JST）を出す。サーバーの時計に従う", async () => {
    installFakeBackend({ ...loggedIn, ...homeApis });
    renderApp("/");

    // loggedIn のサーバーの時計は、2026-10-07 15:00（JST）
    expect((await screen.findByLabelText("現在の日時")).textContent).toBe("10/07（水） 15:00");
  });

  it("メニューから、ほかのページへ移れる", async () => {
    installFakeBackend({
      ...loggedIn,
      ...homeApis,
      "GET /api/scores": { body: { rule: { fixedAfterMatches: 5, fixedPoints: 100 }, teams: [] } },
    });
    renderApp("/");

    fireEvent.click(await screen.findByRole("link", { name: "チーム" }));

    expect(await screen.findByRole("heading", { name: "得点" })).toBeTruthy();
  });

  it("ログアウトすると、サーバーに伝えて、ログイン画面へ移る（取得済みのデータも捨てる）", async () => {
    const backend = installFakeBackend({ ...loggedIn, ...homeApis, "POST /api/logout": { body: { ok: true } } });
    renderApp("/");

    fireEvent.click(await screen.findByRole("button", { name: "ログアウト" }));

    expect((await screen.findByRole("alert")).textContent).toContain("ログインリンクが正しくありません");
    expect(backend.count("POST", "/api/logout")).toBe(1);
  });

  it("ログイン状態を確認できないほかのエラーは、そのまま表示する", async () => {
    installFakeBackend({ "GET /api/me": { status: 500, body: { error: "boom" } } });
    renderApp("/");

    expect((await screen.findByRole("alert")).textContent).toContain("エラーが発生しました（500）");
  });
});
