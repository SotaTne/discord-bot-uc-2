import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SLOT_HOURS, installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

const at = (text: string) => Date.parse(`${text}+09:00`);

const session = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: "500000000000000005",
  userName: "管理者さん",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15",
  createdAt: at("2026-10-07T15:00:00"),
  expiresAt: at("2026-10-14T15:00:00"),
  current: true,
  ...over,
});

const SETTINGS = { channelId: null, recruitHour: 12, cutoffMinutes: 7, fixedAfterMatches: 5, fixedPoints: 100, revokeSessionsOnReissue: false };
/** ログイン中の端末は、設定の画面の中にある */
const apis = (sessions: unknown[] = [session()]) => ({
  ...loggedIn,
  "GET /api/sessions": { body: { sessions } },
  "GET /api/settings": { body: SETTINGS },
  "GET /api/slot-hours": { body: SLOT_HOURS },
});

describe("ログイン管理の画面", () => {
  it("ログイン中のセッションを、ユーザー・ログインした時刻・有効期限つきで出す。いまのブラウザには印を付ける", async () => {
    installFakeBackend(apis([session(), session({ id: 2, userId: "500000000000000006", userName: "副管理者", current: false })]));
    renderApp("/settings");

    const current = (await screen.findByText("管理者さん")).closest("tr")!;
    expect(within(current).getByText("このブラウザ")).toBeTruthy();
    expect(current.textContent).toContain("10/07 15:00");
    expect(current.textContent).toContain("10/14 15:00");
    expect(current.textContent).toContain("Safari・macOS");
    expect(current.textContent).not.toContain("Mozilla");

    const other = screen.getByText("副管理者").closest("tr")!;
    expect(within(other).queryByText("このブラウザ")).toBeNull();
  });

  it("セッションを1つ失効させて、一覧を取り直す", async () => {
    const backend = installFakeBackend({
      ...apis([session(), session({ id: 2, userId: "500000000000000006", userName: "副管理者", current: false })]),
      "DELETE /api/sessions/2": { body: { ok: true } },
    });
    renderApp("/settings");

    fireEvent.click(await screen.findByRole("button", { name: "副管理者のログインを失効させる" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/sessions/2")).toBe(1));
    await waitFor(() => expect(backend.count("GET", "/api/sessions")).toBe(2));
  });

  it("すべての失効は、確認してから実行する", async () => {
    const backend = installFakeBackend({ ...apis(), "POST /api/sessions/revoke-all": { body: { revoked: 1 } } });
    renderApp("/settings");

    fireEvent.click(await screen.findByRole("button", { name: "すべてのログインを失効させる" }));
    expect(backend.count("POST", "/api/sessions/revoke-all")).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "すべて失効させる" }));

    await waitFor(() => expect(backend.count("POST", "/api/sessions/revoke-all")).toBe(1));
  });

  it("失効に失敗したら、理由を出す", async () => {
    installFakeBackend({ ...apis(), "DELETE /api/sessions/1": { status: 404, body: { error: "not_found" } } });
    renderApp("/settings");

    fireEvent.click(await screen.findByRole("button", { name: "管理者さんのログインを失効させる" }));

    expect((await screen.findByRole("alert")).textContent).toContain("対象が見つかりません");
  });
});
