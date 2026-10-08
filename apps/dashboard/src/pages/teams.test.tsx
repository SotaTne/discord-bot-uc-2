import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TEAMS, installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

const win = (matchNumber: number, points: number) => ({ id: matchNumber, matchId: matchNumber, slotDate: "2026-10-0" + matchNumber, slotHour: 21, rawPoints: 10, points, matchNumber });

const scores = {
  rule: { fixedAfterMatches: 5, fixedPoints: 100 },
  teams: [
    { teamId: 1, name: "KMU", total: 250, matches: 5, wins: [win(1, 80), win(2, 70), win(3, 100)] },
    { teamId: 2, name: "UT", total: 250, matches: 2, wins: [win(1, 250)] },
    { teamId: 3, name: "NGT", total: 0, matches: 0, wins: [] },
  ],
};
const ROLES = { roles: [{ id: "400000000000000001", name: "KMU" }, { id: "400000000000000002", name: "UT" }, { id: "400000000000000003", name: "NGT" }] };

const apis = () => ({
  ...loggedIn,
  "GET /api/scores": { body: scores },
  "GET /api/teams": { body: TEAMS },
  "GET /api/roles": { body: ROLES },
});

describe("チームの画面: 得点", () => {
  const scoreRows = async () =>
    (await screen.findAllByRole("row"))
      .filter((r) => within(r).queryByText(/^\d+位$/))
      .map((r) => within(r).getAllByRole("cell").map((cell) => cell.textContent));

  it("順位・チーム・得点・試合数（対戦した組分け）・勝利数を出す（同点は同じ順位）。勝数目ごとの内訳は、出さない", async () => {
    installFakeBackend(apis());
    renderApp("/teams");

    expect(await scoreRows()).toEqual([
      ["1位", "KMU", "250 pt", "5", "3"],
      ["1位", "UT", "250 pt", "2", "1"],
      ["3位", "NGT", "0 pt", "0", "0"],
    ]);
    expect(screen.queryByText(/内訳/)).toBeNull();
    expect(screen.getByRole("columnheader", { name: "勝利数" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "試合数" })).toBeTruthy();
    // 集計の規則（N と固定点）が、表の上に出る
    expect(screen.getByText(/5試合目までは、勝つと、記録した点数で集計します。6試合目からは、勝つと100pt固定です/)).toBeTruthy();
  });

  it("試合数が N を超えたチームにだけ、「100pt固定（試合数5を超過）」の印を、試合数のセルに出す（N 以下には出さない。勝ち負けには、関係しない）", async () => {
    installFakeBackend({
      ...apis(),
      "GET /api/scores": {
        body: {
          rule: { fixedAfterMatches: 5, fixedPoints: 100 },
          teams: [
            { teamId: 1, name: "KMU", total: 150, matches: 5, wins: [win(1, 10)] },
            // 6 試合して、1 勝だけ（負けた試合も、数える）
            { teamId: 2, name: "UT", total: 100, matches: 6, wins: [win(1, 100)] },
          ],
        },
      },
    });
    renderApp("/teams");

    const rows = await scoreRows();
    expect(rows.find((cells) => cells[1] === "KMU")?.[3]).toBe("5");
    expect(rows.find((cells) => cells[1] === "UT")?.[3]).toBe("100pt固定（試合数5を超過）6");
    expect(screen.getAllByText(/超過/)).toHaveLength(1);
  });

  it("チームがなければ、その旨を出す", async () => {
    installFakeBackend({ ...apis(), "GET /api/scores": { body: { ...scores, teams: [] } }, "GET /api/teams": { body: { teams: [] } } });
    renderApp("/teams");

    expect((await screen.findAllByText("チームが登録されていません")).length).toBeGreaterThan(0);
  });
});

describe("チームの画面: チームの追加と削除", () => {
  it("登録済みのチームを、ロールの名前で出す（名前の列は、ない）", async () => {
    installFakeBackend(apis());
    renderApp("/teams");

    const row = (await screen.findAllByRole("button", { name: "削除" }))[0]!.closest("tr")!;
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["KMU", "削除"]);
    expect(screen.queryByLabelText("チーム名")).toBeNull();
  });

  it("ロールを選んで、チームを追加できる（送るのは、ロールの ID だけ）", async () => {
    const backend = installFakeBackend({ ...apis(), "POST /api/teams": { status: 201, body: { id: 3 } } });
    renderApp("/teams");
    await screen.findByRole("option", { name: "NGT" });

    fireEvent.change(screen.getByLabelText("ロール"), { target: { value: "400000000000000003" } });
    fireEvent.click(screen.getAllByRole("button", { name: "追加する" }).at(-1)!);

    await waitFor(() => expect(backend.last("POST", "/api/teams")?.json).toEqual({ roleId: "400000000000000003" }));
  });

  it("すでにチームにしたロールは、選べない", async () => {
    installFakeBackend(apis());
    renderApp("/teams");
    await screen.findByRole("option", { name: "NGT" });

    const options = within(screen.getByLabelText("ロール")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["選択してください", "NGT"]);
  });

  it("ロールを選ぶまでは、追加できない", async () => {
    installFakeBackend(apis());
    renderApp("/teams");
    await screen.findByRole("option", { name: "NGT" });

    const add = screen.getAllByRole("button", { name: "追加する" }).at(-1) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("ロール"), { target: { value: "400000000000000003" } });
    expect(add.disabled).toBe(false);
  });

  it("すでにあるロールなら、理由を出す（別の画面で追加された場合など）", async () => {
    installFakeBackend({ ...apis(), "POST /api/teams": { status: 409, body: { error: "already_exists" } } });
    renderApp("/teams");
    await screen.findByRole("option", { name: "NGT" });

    fireEvent.change(screen.getByLabelText("ロール"), { target: { value: "400000000000000003" } });
    fireEvent.click(screen.getAllByRole("button", { name: "追加する" }).at(-1)!);

    expect((await screen.findByRole("alert")).textContent).toContain("すでに登録されています");
  });

  it("Discord からロール一覧を取れないときは、ロール ID を直接入力できる", async () => {
    const backend = installFakeBackend({
      ...apis(),
      "GET /api/roles": { status: 502, body: { error: "discord_unavailable" } },
      "POST /api/teams": { status: 201, body: { id: 3 } },
    });
    renderApp("/teams");

    expect(await screen.findByText(/ロール ID を直接入力してください/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("ロール ID"), { target: { value: "400000000000000003" } });
    fireEvent.click(screen.getAllByRole("button", { name: "追加する" }).at(-1)!);

    await waitFor(() => expect(backend.last("POST", "/api/teams")?.json).toEqual({ roleId: "400000000000000003" }));
  });

  it("削除は、確認してから実行する。履歴は残ることを、画面に書く", async () => {
    const backend = installFakeBackend({ ...apis(), "DELETE /api/teams/1": { body: { ok: true } } });
    renderApp("/teams");
    const row = (await screen.findAllByRole("button", { name: "削除" }))[0]!.closest("tr")!;

    fireEvent.click(within(row).getByRole("button", { name: "削除" }));
    expect(backend.count("DELETE", "/api/teams/1")).toBe(0);
    fireEvent.click(within(row).getByRole("button", { name: "実行する" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/teams/1")).toBe(1));
    expect(screen.getByText(/過去の組分け・勝利は残ります/)).toBeTruthy();
  });
});
