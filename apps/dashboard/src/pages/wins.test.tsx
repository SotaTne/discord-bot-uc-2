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

/** 行の「操作」メニューを開いて、項目を選ぶ */
const choose = async (menuName: string, item: string) => {
  fireEvent.click(await screen.findByRole("button", { name: menuName }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
};

describe("勝利記録の画面: 絞り込みと並び替え", () => {
  const wins = [
    record({ id: 3, teamName: "UT", match: { id: 9, teamA: "UT", teamB: "NGT" }, slotDate: "2026-10-09", points: 300, recordedByName: "bob", createdAt: at("2026-10-09T22:00:00") }),
    record({ id: 2, teamName: "KMU", match: { id: 8, teamA: "KMU", teamB: "ITF" }, slotDate: "2026-10-08", points: 200, recordedByName: "alice", createdAt: at("2026-10-08T22:00:00"), active: false }),
    record({ id: 1, teamName: "KMU", match: { id: 7, teamA: "KMU", teamB: "UT" }, slotDate: "2026-10-07", points: 100, recordedByName: "alice", createdAt: at("2026-10-07T22:00:00") }),
  ];
  const ids = () => within(screen.getByRole("region", { name: "履歴" })).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]?.textContent);
  const pick = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });

  it("初期は、すべて出す（新しい順）。件数を出す", async () => {
    installFakeBackend(apis(wins));
    renderApp("/wins");

    await screen.findByLabelText("チームで絞り込み");
    expect(ids()).toEqual(["3", "2", "1"]);
    expect(screen.getByText("3件")).toBeTruthy();
  });

  it("チームで絞り込むと、勝ったチームでも、対戦相手でも、そのチームが出る行が残る", async () => {
    installFakeBackend(apis(wins));
    renderApp("/wins");
    await screen.findByLabelText("チームで絞り込み");

    pick("チームで絞り込み", "UT");

    expect(ids()).toEqual(["3", "1"]);
    expect(screen.getByText("2件")).toBeTruthy();
  });

  it("日付・記録者でも絞り込める。組み合わせると、すべてを満たす行だけ。選択肢は、記録にあるものだけ", async () => {
    installFakeBackend(apis(wins));
    renderApp("/wins");
    await screen.findByLabelText("日付で絞り込み");

    expect(within(screen.getByLabelText("日付で絞り込み")).getAllByRole("option").map((o) => o.textContent)).toEqual(["すべての日付", "2026-10-09", "2026-10-08", "2026-10-07"]);
    expect(within(screen.getByLabelText("記録者で絞り込み")).getAllByRole("option").map((o) => o.textContent)).toEqual(["すべての記録者", "alice", "bob"]);

    pick("日付で絞り込み", "2026-10-08");
    expect(ids()).toEqual(["2"]);
    pick("記録者で絞り込み", "bob");
    expect(screen.getByText("条件に合う記録がありません")).toBeTruthy();
  });

  it("「削除済みも表示」を外すと、削除済みの記録を隠す", async () => {
    installFakeBackend(apis(wins));
    renderApp("/wins");
    await screen.findByLabelText("チームで絞り込み");

    fireEvent.click(screen.getByLabelText("削除済みも表示"));

    expect(ids()).toEqual(["3", "1"]);
  });

  it("見出しを押すと、並び替えられる（点数の昇順 → 降順 → 元の並び）。絞り込みとも組み合わせられる", async () => {
    installFakeBackend(apis(wins));
    renderApp("/wins");
    await screen.findByLabelText("チームで絞り込み");
    const press = (name: string) => fireEvent.click(within(screen.getByRole("columnheader", { name })).getByRole("button"));

    press("点数");
    expect(ids()).toEqual(["1", "2", "3"]);
    press("点数");
    expect(ids()).toEqual(["3", "2", "1"]);
    pick("記録者で絞り込み", "alice");
    expect(ids()).toEqual(["2", "1"]);
    press("点数");
    expect(ids()).toEqual(["2", "1"]);
  });
});

describe("勝利記録の画面: 点数の修正", () => {
  it("「編集」で数字を直して保存できる（確認なし）。保存したあとは、表示に戻る。勝ったチームなどは送らない", async () => {
    const backend = installFakeBackend({ ...apis(), "PUT /api/wins/1/points": { body: { ok: true } } });
    renderApp("/wins");

    await choose("勝利#1の操作", "点数を編集");
    const input = screen.getByLabelText("勝利#1の点数") as HTMLInputElement;
    expect(input.value).toBe("80");
    fireEvent.change(input, { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(backend.last("PUT", "/api/wins/1/points")?.json).toEqual({ points: 95 }));
    await waitFor(() => expect(screen.queryByLabelText("勝利#1の点数")).toBeNull());
  });

  it("空・負・小数は保存できない。「キャンセル」で、何も送らずに戻る", async () => {
    const backend = installFakeBackend({ ...apis(), "PUT /api/wins/1/points": { body: { ok: true } } });
    renderApp("/wins");

    await choose("勝利#1の操作", "点数を編集");
    const input = screen.getByLabelText("勝利#1の点数");
    for (const bad of ["", "-1", "1.5"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(screen.queryByLabelText("勝利#1の点数")).toBeNull();
    expect(backend.count("PUT", "/api/wins/1/points")).toBe(0);
  });

  it("保存に失敗したら、理由を出して、入力は残す", async () => {
    installFakeBackend({ ...apis(), "PUT /api/wins/1/points": { status: 404, body: { error: "not_found" } } });
    renderApp("/wins");

    await choose("勝利#1の操作", "点数を編集");
    fireEvent.change(screen.getByLabelText("勝利#1の点数"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect((await screen.findByRole("alert")).textContent).toContain("対象が見つかりません");
    expect((screen.getByLabelText("勝利#1の点数") as HTMLInputElement).value).toBe("5");
  });
});

describe("勝利記録の画面: 履歴", () => {
  it("記録を新しい順に、対戦枠・組分け・勝ったチーム・点数・記録した人つきで出し、画像へのリンクを付ける", async () => {
    installFakeBackend(apis());
    renderApp("/wins");

    const row = (await screen.findByRole("cell", { name: "KMU vs UT" })).closest("tr")!;
    const cells = within(row).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells.slice(0, 7)).toEqual(["1", "2026-10-07 21:00", "KMU vs UT", "KMU", "80pt", "管理者さん", "10/07 22:30"]);
    // 操作は、行の「操作」メニューに、まとまっている
    expect(within(row).getByRole("button", { name: "勝利#1の操作" })).toBeTruthy();
    // 画像は、別のページには移らず、ポップアップで表示する
    expect(within(row).queryByRole("link", { name: "画像" })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "画像" }));
    expect(screen.getByRole("img", { name: "勝利#1の画像" }).getAttribute("src")).toBe("/api/screenshots/1");
  });

  it("同じ対戦枠の別の組分けは、組分けで区別できる", async () => {
    installFakeBackend(apis([record({ id: 2, teamName: "NGT", match: { id: 8, teamA: "NGT", teamB: "ITF" } }), record({ id: 1 })]));
    renderApp("/wins");

    expect(await screen.findByText("NGT vs ITF")).toBeTruthy();
    expect(screen.getByText("KMU vs UT")).toBeTruthy();
  });

  it("メニューの「勝利を削除」で、その記録を外す。削除済みの記録は、（削除済み）と出して、「勝利を元に戻す」を選べる", async () => {
    const backend = installFakeBackend({
      ...apis([record({ id: 2, active: false }), record({ id: 1 })]),
      "PUT /api/wins/1/active": { body: { ok: true } },
      "PUT /api/wins/2/active": { body: { ok: true } },
    });
    renderApp("/wins");

    await screen.findByText("KMU（削除済み）");

    await choose("勝利#1の操作", "勝利を削除");
    await waitFor(() => expect(backend.last("PUT", "/api/wins/1/active")?.json).toEqual({ active: false }));

    await choose("勝利#2の操作", "勝利を元に戻す");
    await waitFor(() => expect(backend.last("PUT", "/api/wins/2/active")?.json).toEqual({ active: true }));
  });

  it("同じ組分けに、ほかの勝利があって、元に戻せないときは、理由を出す", async () => {
    installFakeBackend({
      ...apis([record({ active: false })]),
      "PUT /api/wins/1/active": { status: 409, body: { error: "win_exists" } },
    });
    renderApp("/wins");

    await choose("勝利#1の操作", "勝利を元に戻す");

    expect((await screen.findByRole("alert")).textContent).toContain("すでに勝利が記録されています");
  });

  it("切り替えに失敗したら、理由を出す", async () => {
    installFakeBackend({ ...apis(), "PUT /api/wins/1/active": { status: 404, body: { error: "not_found" } } });
    renderApp("/wins");

    await choose("勝利#1の操作", "勝利を削除");

    expect((await screen.findByRole("alert")).textContent).toContain("対象が見つかりません");
  });

  it("記録がなければ、その旨を出す", async () => {
    installFakeBackend(apis([]));
    renderApp("/wins");

    expect(await screen.findByText("まだ記録がありません")).toBeTruthy();
  });
});

describe("勝利記録の画面: 得点をクリアする", () => {
  it("押しただけでは実行されず、確認で「削除を実行する」を押して初めて、すべての勝利の履歴を削除する", async () => {
    const backend = installFakeBackend({ ...apis(), "DELETE /api/wins": { body: { ok: true, screenshots: 0 } } });
    renderApp("/wins");

    fireEvent.click(await screen.findByRole("button", { name: "全てクリア" }));
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

  it("「キャンセル」で、実行せずに戻る", async () => {
    const backend = installFakeBackend(apis());
    renderApp("/wins");

    fireEvent.click(await screen.findByRole("button", { name: "全てクリア" }));
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(screen.queryByText("本当に実行しますか？")).toBeNull();
    expect(backend.count("DELETE", "/api/wins")).toBe(0);
  });
});
