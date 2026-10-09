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

const KMU = { id: 1, name: "KMU" };
const UT = { id: 2, name: "UT" };
const handupOf = (id: number, team: { id: number; name: string }) => ({ id, team, raisedByName: "admin", createdAt: 0 });
// 今日の対戦枠: 21 時は未マッチング（KMU と UT が挙手）、22 時はマッチング済み（KMU が挙手）
const today = {
  date: "2026-10-07",
  today: "2026-10-07",
  rule: { fixedAfterMatches: 5, fixedPoints: 100 },
  slots: [
    { hour: 21, phase: "open", matched: false, excluded: null, handups: [handupOf(11, KMU), handupOf(12, UT)], matches: [] },
    { hour: 22, phase: "closed", matched: true, excluded: null, handups: [handupOf(13, KMU)], matches: [] },
  ],
};

const apis = () => ({
  ...loggedIn,
  "GET /api/board": { body: today },
  "GET /api/scores": { body: scores },
  "GET /api/teams": { body: TEAMS },
  "GET /api/roles": { body: ROLES },
});

const history = (over: Record<string, unknown> = {}) => ({
  team: KMU,
  rule: { fixedAfterMatches: 1, fixedPoints: 100 },
  matches: [
    {
      matchId: 1, slotDate: "2026-10-05", slotHour: 21, opponent: UT, matchNumber: 1, result: "win",
      win: { id: 5, winner: KMU, points: 80, countedPoints: 80, hasScreenshot: true }, deletedWins: 0,
    },
    {
      matchId: 2, slotDate: "2026-10-06", slotHour: 22, opponent: UT, matchNumber: 2, result: "win",
      win: { id: 6, winner: KMU, points: 30, countedPoints: 100, hasScreenshot: false }, deletedWins: 1,
    },
    { matchId: 3, slotDate: "2026-10-07", slotHour: 21, opponent: { id: 3, name: "NGT" }, matchNumber: 3, result: "loss", win: { id: 7, winner: { id: 3, name: "NGT" }, points: 70, countedPoints: 100, hasScreenshot: true }, deletedWins: 0 },
    { matchId: 4, slotDate: "2026-10-07", slotHour: 22, opponent: UT, matchNumber: 4, result: "none", win: null, deletedWins: 0 },
  ],
  ...over,
});

describe("チームの画面: 今日の挙手", () => {
  it("得点表の「挙手中（今日）」に、チームごとの挙手を、時刻のタグで出す。マッチング済みの対戦枠は、取り消せない", async () => {
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

  it("タグの ✕ で、その挙手を取り消す（行は開かない）", async () => {
    const backend = installFakeBackend({ ...apis(), "DELETE /api/handups/11": { body: { ok: true } } });
    renderApp("/teams");

    fireEvent.click(await screen.findByRole("button", { name: "KMUの21:00の挙手を取り消す" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/handups/11")).toBe(1));
    expect(screen.queryByRole("region", { name: "KMUの詳細" })).toBeNull();
  });

  it("タグの周りの空白（挙手の列の、タグ以外の場所）を押しても、行を押したことになり、詳細が開く", async () => {
    installFakeBackend(apis());
    renderApp("/teams");

    const kmu = (await screen.findAllByRole("row")).find((row) => within(row).queryByText("KMU") && within(row).queryByText("21:00"))!;
    // タグを並べる箱は、列の幅いっぱいに広がる。その空白を押す（タグそのものではなく、箱を押す）
    fireEvent.click(within(kmu).getByText("22:00").closest(".mantine-Group-root")!);

    expect(await screen.findByRole("region", { name: "KMUの詳細" })).toBeTruthy();
  });
});

describe("チームの画面: チームの詳細（行を押すと、その行の下に、全組分けと結果を開く）", () => {
  it("チームの名前を押すと、その行の下に詳細が開く。全組分けを、古い順に、相手・結果・点数つきで出す", async () => {
    const backend = installFakeBackend({ ...apis(), "GET /api/teams/1/history": { body: history() } });
    renderApp("/teams");

    fireEvent.click(await screen.findByRole("button", { name: "KMUの詳細を開く" }));

    const drawer = within(await screen.findByRole("region", { name: "KMUの詳細" }));
    expect(backend.count("GET", "/api/teams/1/history")).toBe(1);
    expect(screen.getByRole("button", { name: "KMUの詳細を閉じる" }).getAttribute("aria-expanded")).toBe("true");
    // 詳細は、KMU の行のすぐ下の行に出る
    const detailRow = screen.getByRole("region", { name: "KMUの詳細" }).closest("tr")!;
    expect(detailRow.previousElementSibling?.textContent).toContain("KMU");
    const rows = (await drawer.findAllByRole("row")).slice(1).map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["1試合目", "10/05 21:00", "UT", "勝利", "80pt", "画像"],
      // 記録した点数と、集計に使われる点数が違うときは、両方を出す。削除した勝利の件数も出す
      ["2試合目", "10/06 22:00", "UT", "勝利削除済み 1件", "30 → 100pt", "—"],
      // 敗北の試合は、相手の勝利の画像（結果の証拠）が見られる。点数は、そのチームのものではないので、出さない
      ["3試合目", "10/07 21:00", "NGT", "敗北", "—", "画像"],
      ["4試合目", "10/07 22:00", "UT", "未記録", "—", "—"],
    ]);
    // 日時は、その日の対戦枠のページへのリンク
    expect(drawer.getByRole("link", { name: "10/05 21:00" }).getAttribute("href")).toBe("/?date=2026-10-05");
  });

  it("同じ行をもう一度押すと、閉じる", async () => {
    installFakeBackend({ ...apis(), "GET /api/teams/1/history": { body: history() } });
    renderApp("/teams");

    fireEvent.click(await screen.findByRole("button", { name: "KMUの詳細を開く" }));
    expect(await screen.findByRole("region", { name: "KMUの詳細" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "KMUの詳細を閉じる" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "KMUの詳細" })).toBeNull());
  });

  it("いくつのチームでも、同時に開ける。1 つ閉じても、ほかは開いたまま", async () => {
    installFakeBackend({
      ...apis(),
      "GET /api/teams/1/history": { body: history() },
      "GET /api/teams/3/history": { body: history({ team: { id: 3, name: "NGT" }, matches: [] }) },
    });
    renderApp("/teams");
    fireEvent.click(await screen.findByRole("button", { name: "KMUの詳細を開く" }));
    fireEvent.click(screen.getByRole("button", { name: "NGTの詳細を開く" }));
    expect(await screen.findByRole("region", { name: "KMUの詳細" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "NGTの詳細" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "KMUの詳細を閉じる" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "KMUの詳細" })).toBeNull());
    expect(screen.getByRole("region", { name: "NGTの詳細" })).toBeTruthy();
  });

  it("組分けがなければ、その旨を出す", async () => {
    installFakeBackend({ ...apis(), "GET /api/teams/3/history": { body: history({ team: { id: 3, name: "NGT" }, matches: [] }) } });
    renderApp("/teams");
    fireEvent.click(await screen.findByRole("button", { name: "NGTの詳細を開く" }));

    expect(await screen.findByText("まだ組分けがありません")).toBeTruthy();
  });
});

describe("チームの画面: 得点表の並び替え", () => {
  // 得点表（「チームの管理」の表とは別）の中だけを見る
  const board = () => within(screen.getByRole("region", { name: "得点" }));
  const rows = () => board().getAllByRole("row").slice(1);
  const names = () => rows().map((row) => within(row).getAllByRole("cell")[1]?.textContent);
  const header = (name: string) => board().getByRole("columnheader", { name });
  const press = (name: string) => fireEvent.click(within(header(name)).getByRole("button"));

  it("最初は、得点の高い順（同点は元の並び）。見出しに、並びの印は付かない", async () => {
    installFakeBackend(apis());
    renderApp("/teams");
    await screen.findByRole("region", { name: "得点" });
    await board().findByRole("columnheader", { name: "チーム" });

    expect(names()).toEqual(["KMU", "UT", "NGT"]);
    expect(header("得点").getAttribute("aria-sort")).toBe("none");
  });

  it("見出しを押すたびに、昇順 → 降順 → 元の並び、と切り替わる（チーム名）", async () => {
    installFakeBackend(apis());
    renderApp("/teams");
    await screen.findByRole("region", { name: "得点" });
    await board().findByRole("columnheader", { name: "チーム" });

    press("チーム");
    expect(names()).toEqual(["KMU", "NGT", "UT"]);
    expect(header("チーム").getAttribute("aria-sort")).toBe("ascending");

    press("チーム");
    expect(names()).toEqual(["UT", "NGT", "KMU"]);
    expect(header("チーム").getAttribute("aria-sort")).toBe("descending");

    press("チーム");
    expect(names()).toEqual(["KMU", "UT", "NGT"]);
    expect(header("チーム").getAttribute("aria-sort")).toBe("none");
  });

  it("試合数・勝利数・得点でも並べ替えられる。別の列を押すと、その列の昇順から。順位の表示は、並び替えても、変わらない", async () => {
    installFakeBackend(apis());
    renderApp("/teams");
    await screen.findByRole("region", { name: "得点" });
    await board().findByRole("columnheader", { name: "チーム" });

    press("試合数");
    expect(names()).toEqual(["NGT", "UT", "KMU"]);
    press("勝利数");
    expect(names()).toEqual(["NGT", "UT", "KMU"]);
    expect(header("試合数").getAttribute("aria-sort")).toBe("none");
    press("勝利数");
    expect(names()).toEqual(["KMU", "UT", "NGT"]);
    // 順位は、得点で決まる（KMU と UT は同点の 1 位）
    const ranks = rows().map((row) => within(row).getAllByRole("cell")[0]?.textContent);
    expect(ranks).toEqual(["1位", "1位", "3位"]);
  });
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
      ["1位", "KMU", "21:0022:00", "250pt", "5", "3"],
      ["1位", "UT", "21:00", "250pt", "2", "1"],
      ["3位", "NGT", "—", "0pt", "0", "0"],
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
    expect(rows.find((cells) => cells[1] === "KMU")?.[4]).toBe("5");
    expect(rows.find((cells) => cells[1] === "UT")?.[4]).toBe("100pt固定（試合数5を超過）6");
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
    expect(screen.getByText(/過去の組分けと勝利は残ります/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "実行する" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/teams/1")).toBe(1));
  });
});
