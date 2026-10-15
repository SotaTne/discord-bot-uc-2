import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SLOT_HOURS, TEAMS, installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

const at = (text: string) => Date.parse(`${text}+09:00`);
const KMU = { id: 1, name: "KMU" };
const UT = { id: 2, name: "UT" };

const slot = (over: Record<string, unknown> = {}) => ({
  hour: 21,
  phase: "open",
  matched: false,
  excluded: null,
  handups: [],
  matches: [],
  ...over,
});
const handup = (over: Record<string, unknown> = {}) => ({ id: 1, team: KMU, raisedByName: "alice", createdAt: at("2026-10-07T15:00:00"), ...over });
const match = (over: Record<string, unknown> = {}) => ({ id: 7, teamA: KMU, teamB: UT, matchNumberA: 3, matchNumberB: 5, host: UT, ...over });
const board = (slots: unknown[], date = "2026-10-07", today = "2026-10-07") => ({ body: { date, today, slots } });
const apis = (slots: unknown[] = [slot()]) => ({
  ...loggedIn,
  "GET /api/board": board(slots),
  "GET /api/teams": { body: TEAMS },
  "GET /api/slot-hours": { body: SLOT_HOURS },
});
const card = async (name: string) => within(await screen.findByRole("region", { name }));

describe("対戦枠の画面: 削除した試合時刻の対戦枠（状態は、未マッチング / マッチング済み / 削除済みの 3 つ）", () => {
  it("削除済みの対戦枠は、状態が「削除済み」の 1 つだけ（色も違う）。「マッチング済み」「未マッチング」の表示は、出ない", async () => {
    // 組分けのない（3 チームとも空いている）対戦枠。組分けの追加欄は、空いているチームが 2 つ以上あるときだけ出る
    installFakeBackend(apis([slot({ hour: 21, deleted: true, matched: true }), slot({ hour: 22 })]));
    renderApp("/");

    const deleted = await card("21:00の対戦枠");
    expect(deleted.getByText("削除済み")).toBeTruthy();
    expect(deleted.queryByText("マッチング済み")).toBeNull();
    expect(deleted.queryByText("未マッチング")).toBeNull();
    expect(screen.getByRole("region", { name: "21:00の対戦枠" }).className).toContain("slot-deleted");
    // ふつうの対戦枠には、印も、色もない
    const normal = await card("22:00の対戦枠");
    expect(normal.queryByText("削除済み")).toBeNull();
    expect(screen.getByRole("region", { name: "22:00の対戦枠" }).className).not.toContain("slot-deleted");
    expect(await normal.findByRole("button", { name: "組分けを追加" })).toBeTruthy();
    // 削除済みでも、組分けは、追加できる
    expect(await deleted.findByRole("button", { name: "組分けを追加" })).toBeTruthy();
  });

  it("削除済みの対戦枠には、「マッチング処理を実行する」も、「やり直す」も出ない（マッチング済みでも、未マッチングでも）。挙手の追加も、できない", async () => {
    installFakeBackend(
      apis([
        slot({ hour: 21, deleted: true, matched: true, matches: [match()] }),
        slot({ hour: 22, deleted: true, matched: false, handups: [handup()] }),
        slot({ hour: 23 }),
      ]),
    );
    renderApp("/");

    // ふつうの対戦枠（23 時）には、出る。出たあとで、削除済みの対戦枠に無いことを確かめる
    expect(await (await card("23:00の対戦枠")).findByRole("button", { name: "マッチング処理を実行する" })).toBeTruthy();
    expect(await (await card("23:00の対戦枠")).findByRole("button", { name: "挙手を追加" })).toBeTruthy();
    for (const name of ["21:00の対戦枠", "22:00の対戦枠"]) {
      const deleted = await card(name);
      expect(deleted.queryByRole("button", { name: "マッチング処理を実行する" })).toBeNull();
      expect(deleted.queryByRole("button", { name: "やり直す" })).toBeNull();
      expect(deleted.queryByRole("button", { name: "挙手を追加" })).toBeNull();
    }
  });

  it("削除済み・未マッチングの対戦枠では、挙手の取り消しが、できる（後始末のため）。組分けの操作も、できる", async () => {
    installFakeBackend(apis([slot({ hour: 21, deleted: true, matched: false, handups: [handup()], matches: [match()] })]));
    renderApp("/");

    const deleted = await card("21:00の対戦枠");
    expect(deleted.getByRole("button", { name: "KMUの21:00の挙手を取り消す" })).toBeTruthy();
    expect(deleted.getByRole("button", { name: "KMU vs UTを削除" })).toBeTruthy();
  });
});

describe("対戦枠の画面: 日付", () => {
  it("今日の対戦枠が、対戦枠ごとのカードで並ぶ。日付と曜日が出る", async () => {
    installFakeBackend(apis([slot({ hour: 21 }), slot({ hour: 22 })]));
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "10/07（水）" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "21:00の対戦枠" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "22:00の対戦枠" })).toBeTruthy();
  });

  it("◀ ▶ で日を移れる。今日でないときだけ、「今日」で戻れる", async () => {
    const backend = installFakeBackend({
      ...apis(),
      "GET /api/board": (request) => {
        const date = request.query.get("date") ?? "2026-10-07";
        return board([slot()], date);
      },
    });
    renderApp("/");
    await screen.findByRole("heading", { name: "10/07（水）" });
    expect(screen.queryByRole("button", { name: "今日" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "次の日" }));
    expect(await screen.findByRole("heading", { name: "10/08（木）" })).toBeTruthy();
    expect(backend.last("GET", "/api/board")?.query).toBe("?date=2026-10-08");

    fireEvent.click(screen.getByRole("button", { name: "前の日" }));
    fireEvent.click(screen.getByRole("button", { name: "前の日" }));
    expect(await screen.findByRole("heading", { name: "10/06（火）" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    expect(await screen.findByRole("heading", { name: "10/07（水）" })).toBeTruthy();
    // 今日の分は、取ってあるものを出す（5秒たつと、自動で、取り直される）。今日に戻ったので、「今日」のボタンは消える
    expect(screen.queryByRole("button", { name: "今日" })).toBeNull();
  });

  it("試合の時刻が登録されていなければ、その旨を出す", async () => {
    installFakeBackend(apis([]));
    renderApp("/");

    expect(await screen.findByText(/試合時刻が登録されていません/)).toBeTruthy();
  });
});

describe("対戦枠の画面: 受付の段階", () => {
  it.each([
    ["before-open", false, "募集開始前"],
    ["open", false, "受付中"],
    ["closed", false, "締切"],
    ["closed", true, "マッチング済み"],
  ])("段階 %s・マッチング済み %s は「%s」と出る", async (phase, matched, label) => {
    installFakeBackend(apis([slot({ phase, matched })]));
    renderApp("/");

    expect((await card("21:00の対戦枠")).getByText(label)).toBeTruthy();
  });
});

describe("対戦枠の画面: 挙手", () => {
  it("挙手したチームを、人と時刻つきで出す。取り消せる", async () => {
    const backend = installFakeBackend({ ...apis([slot({ handups: [handup()] })]), "DELETE /api/handups/1": { body: { ok: true } } });
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    expect(within21.getAllByText("KMU").length).toBeGreaterThan(0);
    // チーム名の下に、誰がいつ挙手したかが出る
    expect(within21.getByText(/alice・10\/07 15:00/)).toBeTruthy();

    fireEvent.click(within21.getByRole("button", { name: "KMUの21:00の挙手を取り消す" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/handups/1")).toBe(1));
    await waitFor(() => expect(backend.count("GET", "/api/board")).toBe(2));
  });

  it("まだ挙手していないチームを選んで、代理で挙手できる（その日・その対戦枠で）", async () => {
    const backend = installFakeBackend({ ...apis([slot({ handups: [handup()] })]), "POST /api/handups": { status: 201, body: { id: 9 } } });
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    const options = within(await within21.findByLabelText("挙手するチーム")).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["チームを選択", "UT"]);

    fireEvent.change(await within21.findByLabelText("挙手するチーム"), { target: { value: "2" } });
    fireEvent.click((await within21.findByRole("button", { name: "挙手を追加" })));

    await waitFor(() => expect(backend.last("POST", "/api/handups")?.json).toEqual({ teamId: 2, slotHour: 21, slotDate: "2026-10-07" }));
  });

  it("マッチング済みの対戦枠では、挙手の追加も取り消しも出さない", async () => {
    installFakeBackend(apis([slot({ matched: true, handups: [handup()], matches: [match()] })]));
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    expect(within21.getAllByText("KMU").length).toBeGreaterThan(0);
    // 挙手を追加する欄は、チームの一覧を取るまで出ない。取れたあとも、出さない
    await screen.findAllByText("KMU（3試合目） vs UT（5試合目）");
    expect(within21.queryByRole("button", { name: /挙手を取り消す/ })).toBeNull();
    expect(within21.queryByLabelText("挙手するチーム")).toBeNull();
  });

  it("追加に失敗したら、理由を出す", async () => {
    installFakeBackend({ ...apis(), "POST /api/handups": { status: 409, body: { error: "already_raised" } } });
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    fireEvent.change(await within21.findByLabelText("挙手するチーム"), { target: { value: "1" } });
    fireEvent.click((await within21.findByRole("button", { name: "挙手を追加" })));

    expect((await within21.findByRole("alert")).textContent).toContain("すでに挙手しています");
  });
});

describe("対戦枠の画面: 組分けの追加", () => {
  it("2チームを選んで、組分けを追加できる（挙手は、自動で付く）", async () => {
    const backend = installFakeBackend({ ...apis(), "POST /api/matches": { status: 201, body: { id: 7 } } });
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    fireEvent.change(await within21.findByLabelText("1チーム目"), { target: { value: "1" } });
    fireEvent.change(await within21.findByLabelText("2チーム目"), { target: { value: "2" } });
    fireEvent.click((await within21.findByRole("button", { name: "組分けを追加" })));

    await waitFor(() =>
      expect(backend.last("POST", "/api/matches")?.json).toEqual({ teamAId: 1, teamBId: 2, slotHour: 21, slotDate: "2026-10-07" }),
    );
    await waitFor(() => expect(backend.count("GET", "/api/board")).toBe(2));
  });

  it("1チーム目に選んだチームは、2チーム目の選択肢から外れる。2チームそろうまで、追加できない", async () => {
    installFakeBackend(apis());
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    const add = (await within21.findByRole("button", { name: "組分けを追加" })) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    fireEvent.change(await within21.findByLabelText("1チーム目"), { target: { value: "1" } });
    expect(within(await within21.findByLabelText("2チーム目")).getAllByRole("option").map((o) => o.textContent)).toEqual(["チームを選択", "UT"]);
    expect(add.disabled).toBe(true);

    fireEvent.change(await within21.findByLabelText("2チーム目"), { target: { value: "2" } });
    expect(add.disabled).toBe(false);
  });

  it("すでに組分けに入っているチームは、選べない。選べるチームが2つ未満なら、追加の欄を出さない", async () => {
    installFakeBackend(apis([slot({ matches: [match()] })]));
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    expect(within21.queryByLabelText("2チーム目")).toBeNull();
  });

  it("追加に失敗したら、理由を出す", async () => {
    installFakeBackend({ ...apis(), "POST /api/matches": { status: 409, body: { error: "team_already_matched" } } });
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    fireEvent.change(await within21.findByLabelText("1チーム目"), { target: { value: "1" } });
    fireEvent.change(await within21.findByLabelText("2チーム目"), { target: { value: "2" } });
    fireEvent.click((await within21.findByRole("button", { name: "組分けを追加" })));

    expect((await within21.findByRole("alert")).textContent).toContain("すでに別の組分けに入っています");
  });
});

describe("対戦枠の画面: 組分け", () => {
  it("組分け（AA vs BB）を出し、組まれなかったチームも出す", async () => {
    installFakeBackend(apis([slot({ matched: true, matches: [match()], excluded: { id: 3, name: "NGT" } })]));
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    expect(within21.getByText("KMU（3試合目） vs UT（5試合目）")).toBeTruthy();
    expect(within21.getByText("主催: UT")).toBeTruthy();
    expect(within21.getByText("組まれなかったチーム: NGT")).toBeTruthy();
  });

  it("組分けの削除は、確認してから実行する", async () => {
    const backend = installFakeBackend({ ...apis([slot({ matches: [match()] })]), "DELETE /api/matches/7": { body: { ok: true } } });
    renderApp("/");
    const within21 = await card("21:00の対戦枠");

    fireEvent.click(await screen.findByRole("button", { name: "KMU vs UTを削除" }));
    expect(backend.count("DELETE", "/api/matches/7")).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "削除を実行する" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/matches/7")).toBe(1));
    await waitFor(() => expect(backend.count("GET", "/api/board")).toBe(2));
  });
});

describe("対戦枠の画面: マッチングの確定とやり直し", () => {
  it("未マッチングの対戦枠には「マッチング処理を実行する」が出る。確認してから実行して、日付も送る", async () => {
    const backend = installFakeBackend({ ...apis([slot()]), "POST /api/match-slots/confirm": { body: { ok: true } } });
    renderApp("/");
    const within21 = await card("21:00の対戦枠");

    fireEvent.click(await within21.findByRole("button", { name: "マッチング処理を実行する" }));
    expect(backend.count("POST", "/api/match-slots/confirm")).toBe(0);
    // 重い操作は、画面の中央のダイアログで確認する（対戦枠の外に出る）
    expect(screen.getByRole("dialog", { name: "マッチング処理を実行する" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "実行して、投稿する" }));

    await waitFor(() => expect(backend.count("POST", "/api/match-slots/confirm")).toBe(1));
    expect(backend.last("POST", "/api/match-slots/confirm")?.json).toEqual({ slotHour: 21, slotDate: "2026-10-07" });
    expect(within21.queryByRole("button", { name: "やり直す" })).toBeNull();
  });

  it("マッチング済みの対戦枠には「やり直す」が出る（確定は出ない）。消える組分けの件数を、確認に出す", async () => {
    const backend = installFakeBackend({
      ...apis([slot({ matched: true, matches: [match(), match({ id: 8 })] })]),
      "POST /api/match-slots/reopen": { body: { ok: true, deletedMatches: 2 } },
    });
    renderApp("/");
    const within21 = await card("21:00の対戦枠");
    expect(within21.queryByRole("button", { name: "マッチング処理を実行する" })).toBeNull();

    fireEvent.click(await within21.findByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("dialog", { name: "やり直す" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "組分け2件を削除して、やり直す" }));

    await waitFor(() => expect(backend.count("POST", "/api/match-slots/reopen")).toBe(1));
    // 投稿のチェックは、初期はオン
    expect(backend.last("POST", "/api/match-slots/reopen")?.json).toEqual({ slotHour: 21, slotDate: "2026-10-07", notify: true });
  });

  it("やり直しのダイアログに、「Discord に、マッチングのキャンセルを投稿する」のチェックが出る（初期はオン）。外すと、投稿しないことを送る", async () => {
    const backend = installFakeBackend({
      ...apis([slot({ matched: true, matches: [match()] })]),
      "POST /api/match-slots/reopen": { body: { ok: true, deletedMatches: 1, notified: false, notifyFailed: false } },
    });
    renderApp("/");
    const within21 = await card("21:00の対戦枠");
    fireEvent.click(await within21.findByRole("button", { name: "やり直す" }));

    const check = screen.getByLabelText(/マッチングのキャンセルを投稿する/) as HTMLInputElement;
    expect(check.checked).toBe(true);
    fireEvent.click(check);
    fireEvent.click(screen.getByRole("button", { name: "組分け1件を削除して、やり直す" }));

    await waitFor(() => expect(backend.last("POST", "/api/match-slots/reopen")?.json).toEqual({ slotHour: 21, slotDate: "2026-10-07", notify: false }));
  });

  it("組分けも除外チームもない対戦枠の、やり直しのダイアログには、投稿のチェックは出ない", async () => {
    installFakeBackend(apis([slot({ matched: true })]));
    renderApp("/");
    const within21 = await card("21:00の対戦枠");

    fireEvent.click(await within21.findByRole("button", { name: "やり直す" }));

    expect(screen.queryByLabelText(/マッチングのキャンセルを投稿する/)).toBeNull();
  });

  it("投稿に失敗したときは、やり直しはできたことと、投稿に失敗したことを出す", async () => {
    installFakeBackend({
      ...apis([slot({ matched: true, matches: [match()] })]),
      "POST /api/match-slots/reopen": { body: { ok: true, deletedMatches: 1, notified: false, notifyFailed: true } },
    });
    renderApp("/");
    const within21 = await card("21:00の対戦枠");
    fireEvent.click(await within21.findByRole("button", { name: "やり直す" }));
    fireEvent.click(screen.getByRole("button", { name: "組分け1件を削除して、やり直す" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Discord への投稿に失敗しました");
  });

  it("組分けもない対戦枠は、件数を出さずに「やり直しを実行する」だけ", async () => {
    installFakeBackend(apis([slot({ matched: true })]));
    renderApp("/");
    const within21 = await card("21:00の対戦枠");

    fireEvent.click(await within21.findByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("button", { name: "やり直しを実行する" })).toBeTruthy();
  });
});
