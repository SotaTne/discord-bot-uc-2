import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TEAMS, installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

const ROLES = { roles: [{ id: "400000000000000001", name: "KMU" }, { id: "400000000000000002", name: "UT" }, { id: "400000000000000003", name: "NGT" }] };

const KMU = { id: 1, name: "KMU" };
const UT = { id: 2, name: "UT" };
const handupOf = (id: number, team: { id: number; name: string }) => ({ id, team, raisedByName: "admin", createdAt: 0 });
// 今日の対戦枠: 21 時は未マッチング（KMU と UT が挙手）、22 時はマッチング済み（KMU が挙手）
const today = {
  date: "2026-10-07",
  today: "2026-10-07",
  slots: [
    { hour: 21, phase: "open", matched: false, excluded: null, handups: [handupOf(11, KMU), handupOf(12, UT)], matches: [] },
    { hour: 22, phase: "closed", matched: true, excluded: null, handups: [handupOf(13, KMU)], matches: [] },
  ],
};

const apis = () => ({
  ...loggedIn,
  "GET /api/board": { body: today },
  "GET /api/teams": { body: TEAMS },
  "GET /api/roles": { body: ROLES },
});

describe("チームの画面: 今日の挙手", () => {
  it("「挙手中（今日）」の列に、チームごとの挙手を、時刻のタグで出す。マッチング済みの対戦枠は、取り消せない", async () => {
    installFakeBackend(apis());
    renderApp("/teams");

    const kmu = (await screen.findAllByRole("row")).find((row) => within(row).queryByText("KMU") && within(row).queryByText("21:00"))!;
    expect(within(kmu).getByRole("button", { name: "KMUの21:00の挙手を取り消す" })).toBeTruthy();
    // 22 時は、マッチング済み。タグはあるが、取り消しの印はない
    expect(within(kmu).getByText("22:00")).toBeTruthy();
    expect(within(kmu).queryByRole("button", { name: "KMUの22:00の挙手を取り消す" })).toBeNull();
  });

  it("マッチング済みの対戦枠で、組まれなかったチーム（奇数で外れた）の挙手は、組まれた挙手と、色を分ける（どちらも取り消せない）", async () => {
    const board = {
      ...today,
      slots: [{ hour: 22, phase: "closed", matched: true, excluded: UT, handups: [handupOf(13, KMU), handupOf(14, UT)], matches: [] }],
    };
    installFakeBackend({ ...apis(), "GET /api/board": { body: board } });
    renderApp("/teams");

    const paired = await screen.findByTitle("マッチング済み（取り消せません）");
    const excluded = screen.getByTitle("組まれませんでした（マッチング済み。取り消せません）");
    expect(paired.textContent).toBe("22:00");
    expect(excluded.textContent).toBe("22:00");
    // 色は、Mantine のバッジの style（色の変数）に出る。同じ見た目ではないことを確かめる
    expect(excluded.getAttribute("style")).not.toBe(paired.getAttribute("style"));
    expect(screen.queryByRole("button", { name: /挙手を取り消す/ })).toBeNull();
  });

  it("タグの ✕ で、その挙手を取り消す", async () => {
    const backend = installFakeBackend({ ...apis(), "DELETE /api/handups/11": { body: { ok: true } } });
    renderApp("/teams");

    fireEvent.click(await screen.findByRole("button", { name: "KMUの21:00の挙手を取り消す" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/handups/11")).toBe(1));
  });
});

describe("チームの画面: チームの追加と削除", () => {
  it("登録済みのチームを、ロールの名前で出す（名前の列は、ない）", async () => {
    installFakeBackend(apis());
    renderApp("/teams");

    const row = (await screen.findAllByRole("button", { name: "削除" }))[0]!.closest("tr")!;
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["KMU", "21:00" + "22:00", "削除"]);
    expect(screen.queryByLabelText("チーム名")).toBeNull();
  });

  it("ロールを選んで、チームを追加できる（送るのは、ロールの ID だけ）", async () => {
    const backend = installFakeBackend({ ...apis(), "POST /api/teams": { status: 201, body: { id: 3 } } });
    renderApp("/teams");
    await screen.findByRole("option", { name: "NGT" });

    fireEvent.change(screen.getByLabelText("追加するロール"), { target: { value: "400000000000000003" } });
    fireEvent.click(screen.getAllByRole("button", { name: "チームを追加" }).at(-1)!);

    await waitFor(() => expect(backend.last("POST", "/api/teams")?.json).toEqual({ roleId: "400000000000000003" }));
  });

  it("すでにチームにしたロールは、選べない", async () => {
    installFakeBackend(apis());
    renderApp("/teams");
    await screen.findByRole("option", { name: "NGT" });

    const options = within(screen.getByLabelText("追加するロール")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["ロールを選択", "NGT"]);
  });

  it("ロールを選ぶまでは、追加できない", async () => {
    installFakeBackend(apis());
    renderApp("/teams");
    await screen.findByRole("option", { name: "NGT" });

    const add = screen.getAllByRole("button", { name: "チームを追加" }).at(-1) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("追加するロール"), { target: { value: "400000000000000003" } });
    expect(add.disabled).toBe(false);
  });

  it("すでにあるロールなら、理由を出す（別の画面で追加された場合など）", async () => {
    installFakeBackend({ ...apis(), "POST /api/teams": { status: 409, body: { error: "already_exists" } } });
    renderApp("/teams");
    await screen.findByRole("option", { name: "NGT" });

    fireEvent.change(screen.getByLabelText("追加するロール"), { target: { value: "400000000000000003" } });
    fireEvent.click(screen.getAllByRole("button", { name: "チームを追加" }).at(-1)!);

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
    fireEvent.click(screen.getAllByRole("button", { name: "チームを追加" }).at(-1)!);

    await waitFor(() => expect(backend.last("POST", "/api/teams")?.json).toEqual({ roleId: "400000000000000003" }));
  });

  it("削除は、確認してから実行する。履歴は残ることを、画面に書く", async () => {
    const backend = installFakeBackend({ ...apis(), "DELETE /api/teams/1": { body: { ok: true } } });
    renderApp("/teams");
    const row = (await screen.findAllByRole("button", { name: "削除" }))[0]!.closest("tr")!;

    fireEvent.click(within(row).getByRole("button", { name: "削除" }));
    expect(backend.count("DELETE", "/api/teams/1")).toBe(0);
    // 確認の吹き出しに、削除しても履歴は残ることを書く
    expect(screen.getByText(/過去の組分けは残ります/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "実行する" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/teams/1")).toBe(1));
  });
});
