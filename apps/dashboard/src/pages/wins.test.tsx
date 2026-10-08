import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

const at = (text: string) => Date.parse(`${text}+09:00`);

const record = (over: Record<string, unknown> = {}) => ({
  id: 1,
  teamId: 1,
  teamName: "KMU",
  match: { id: 7, teamA: "KMU", teamB: "UT" },
  slotDate: "2026-10-07",
  slotHour: 21,
  points: 80,
  active: true,
  recordedBy: "500000000000000005",
  recordedByName: "管理者さん",
  createdAt: at("2026-10-07T22:30:00"),
  hasScreenshot: true,
  ...over,
});

const apis = (wins: unknown[] = [record()]) => ({ ...loggedIn, "GET /api/wins": { body: { wins } } });

describe("勝利の画面: 点数の修正", () => {
  it("「直す」で数字を直して保存できる（確認なし）。保存したあとは、表示に戻る。勝ったチームなどは送らない", async () => {
    const backend = installFakeBackend({ ...apis(), "PUT /api/wins/1/points": { body: { ok: true } } });
    renderApp("/wins");

    fireEvent.click(await screen.findByRole("button", { name: "勝利#1の点数を直す" }));
    const input = screen.getByLabelText("勝利#1の点数") as HTMLInputElement;
    expect(input.value).toBe("80");
    fireEvent.change(input, { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(backend.last("PUT", "/api/wins/1/points")?.json).toEqual({ points: 95 }));
    await waitFor(() => expect(screen.queryByLabelText("勝利#1の点数")).toBeNull());
  });

  it("空・負・小数は保存できない。「やめる」で、何も送らずに戻る", async () => {
    const backend = installFakeBackend({ ...apis(), "PUT /api/wins/1/points": { body: { ok: true } } });
    renderApp("/wins");

    fireEvent.click(await screen.findByRole("button", { name: "勝利#1の点数を直す" }));
    const input = screen.getByLabelText("勝利#1の点数");
    for (const bad of ["", "-1", "1.5"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));

    expect(screen.queryByLabelText("勝利#1の点数")).toBeNull();
    expect(backend.count("PUT", "/api/wins/1/points")).toBe(0);
  });

  it("保存に失敗したら、理由を出して、入力は残す", async () => {
    installFakeBackend({ ...apis(), "PUT /api/wins/1/points": { status: 404, body: { error: "not_found" } } });
    renderApp("/wins");

    fireEvent.click(await screen.findByRole("button", { name: "勝利#1の点数を直す" }));
    fireEvent.change(screen.getByLabelText("勝利#1の点数"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect((await screen.findByRole("alert")).textContent).toContain("対象が見つかりません");
    expect((screen.getByLabelText("勝利#1の点数") as HTMLInputElement).value).toBe("5");
  });
});

describe("勝利の画面: 履歴", () => {
  it("記録を新しい順に、枠・組分け・勝ったチーム・点数・記録した人つきで出し、画像へのリンクを付ける", async () => {
    installFakeBackend(apis());
    renderApp("/wins");

    const row = (await screen.findByRole("cell", { name: "KMU vs UT" })).closest("tr")!;
    const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells.slice(0, 7)).toEqual(["1", "2026-10-07 21:00", "KMU vs UT", "KMU", "80pt", "管理者さん", "10/07 22:30"]);
    // 点数を直す・削除は、同じ列に並ぶ
    const actions = within(row).getByRole("button", { name: "勝利#1の点数を直す" }).closest("td")!;
    expect(within(actions).getByRole("button", { name: "削除" })).toBeTruthy();
    // 画像は、別のページには移らず、ポップアップで表示する
    expect(within(row).queryByRole("link", { name: "見る" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "見る" }));
    expect(screen.getByRole("img", { name: "勝利#1のスクリーンショット" }).getAttribute("src")).toBe("/api/screenshots/1");
  });

  it("同じ枠の別の組分けは、組分けで区別できる", async () => {
    installFakeBackend(apis([record({ id: 2, teamName: "NGT", match: { id: 8, teamA: "NGT", teamB: "ITF" } }), record({ id: 1 })]));
    renderApp("/wins");

    expect(await screen.findByText("NGT vs ITF")).toBeTruthy();
    expect(screen.getByText("KMU vs UT")).toBeTruthy();
  });

  it("「削除」で、その記録を外す。削除済みの記録は、（削除済み）と出して、「元に戻す」ボタンを出す", async () => {
    const backend = installFakeBackend({
      ...apis([record({ id: 2, active: false }), record({ id: 1 })]),
      "PUT /api/wins/1/active": { body: { ok: true } },
      "PUT /api/wins/2/active": { body: { ok: true } },
    });
    renderApp("/wins");

    const removed = (await screen.findByText("KMU（削除済み）")).closest("tr")!;
    expect(within(removed).getByRole("button", { name: "元に戻す" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    await waitFor(() => expect(backend.last("PUT", "/api/wins/1/active")?.json).toEqual({ active: false }));

    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    await waitFor(() => expect(backend.last("PUT", "/api/wins/2/active")?.json).toEqual({ active: true }));
  });

  it("同じ組分けに、ほかの勝利があって、元に戻せないときは、理由を出す", async () => {
    installFakeBackend({
      ...apis([record({ active: false })]),
      "PUT /api/wins/1/active": { status: 409, body: { error: "win_exists" } },
    });
    renderApp("/wins");

    fireEvent.click(await screen.findByRole("button", { name: "元に戻す" }));

    expect((await screen.findByRole("alert")).textContent).toContain("すでに勝利が記録されています");
  });

  it("切り替えに失敗したら、理由を出す", async () => {
    installFakeBackend({ ...apis(), "PUT /api/wins/1/active": { status: 404, body: { error: "not_found" } } });
    renderApp("/wins");

    fireEvent.click(await screen.findByRole("button", { name: "削除" }));

    expect((await screen.findByRole("alert")).textContent).toContain("対象が見つかりません");
  });

  it("記録がなければ、その旨を出す", async () => {
    installFakeBackend(apis([]));
    renderApp("/wins");

    expect(await screen.findByText("まだ記録がありません")).toBeTruthy();
  });
});

describe("勝利の画面: 得点をクリアする", () => {
  it("押しただけでは実行されず、確認で「削除を実行する」を押して初めて、すべての勝利の履歴を削除する", async () => {
    const backend = installFakeBackend({ ...apis(), "DELETE /api/wins": { body: { ok: true, screenshots: 0 } } });
    renderApp("/wins");

    fireEvent.click(await screen.findByRole("button", { name: "クリアする" }));
    expect(backend.count("DELETE", "/api/wins")).toBe(0);
    expect(screen.getByText("本当に実行しますか？")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "削除を実行する" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/wins")).toBe(1));
    expect((await screen.findByText("得点と履歴を削除しました")).getAttribute("role")).toBe("status");
  });

  it("元に戻せないことを伝える。チームの選択はない", async () => {
    installFakeBackend(apis());
    renderApp("/wins");

    expect(await screen.findByText(/元に戻せません/)).toBeTruthy();
    expect(screen.queryByLabelText("対象")).toBeNull();
  });

  it("「やめる」で、実行せずに戻る", async () => {
    const backend = installFakeBackend(apis());
    renderApp("/wins");

    fireEvent.click(await screen.findByRole("button", { name: "クリアする" }));
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));

    expect(screen.queryByText("本当に実行しますか？")).toBeNull();
    expect(backend.count("DELETE", "/api/wins")).toBe(0);
  });
});
