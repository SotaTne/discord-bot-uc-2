import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SLOTS, TEAMS, installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

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
const match = (over: Record<string, unknown> = {}) => ({ id: 7, teamA: KMU, teamB: UT, matchNumberA: 1, matchNumberB: 1, win: null, deletedWins: 0, ...over });
const win = (over: Record<string, unknown> = {}) => ({
  id: 3,
  team: UT,
  points: 452,
  recordedByName: "管理者さん",
  createdAt: at("2026-10-07T21:30:00"),
  hasScreenshot: true,
  ...over,
});

const rule = { fixedAfterMatches: 5, fixedPoints: 100 };
const board = (slots: unknown[], date = "2026-10-07", today = "2026-10-07") => ({ body: { date, today, rule, slots } });
const apis = (slots: unknown[] = [slot()]) => ({
  ...loggedIn,
  "GET /api/board": board(slots),
  "GET /api/teams": { body: TEAMS },
  "GET /api/slots": { body: SLOTS },
});
/** 行の「操作」メニューを開いて、項目を選ぶ */
const choose = async (menuName: string, item: string) => {
  fireEvent.click(await screen.findByRole("button", { name: menuName }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
};
/** 勝利がまだない組分けの「勝利を追加」を押して、入力のダイアログを開く */
const openAddWin = async (label: string) => {
  fireEvent.click(await screen.findByRole("button", { name: `${label}の勝利を追加` }));
  return within(await screen.findByRole("form", { name: `${label}の勝利を追加` }));
};
const card = async (name: string) => within(await screen.findByRole("region", { name }));

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
    await screen.findAllByText("KMU vs UT");
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

describe("対戦枠の画面: 組分けと勝利", () => {
  it("組分け（AA vs BB）を出し、組まれなかったチームも出す", async () => {
    installFakeBackend(apis([slot({ matched: true, matches: [match()], excluded: { id: 3, name: "NGT" } })]));
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    expect(within21.getByText("KMU vs UT")).toBeTruthy();
    expect(within21.getByText("組まれなかったチーム: NGT")).toBeTruthy();
  });

  it("勝利がまだなら、その行から記録できる（勝ったチーム・点数・画像）。画像つきのフォームで、その組分けに送る", async () => {
    const backend = installFakeBackend({ ...apis([slot({ matches: [match()] })]), "POST /api/matches/7/wins": { status: 201, body: { id: 3 } } });
    renderApp("/");

    // 表には入力欄を並べず、「勝利を追加」を押すと、入力のダイアログが開く
    const form = await openAddWin("KMU vs UT");
    const button = form.getByRole("button", { name: "追加" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(within(form.getByLabelText("勝ったチーム")).getAllByRole("option").map((o) => o.textContent)).toEqual(["選択してください", "KMU", "UT"]);

    fireEvent.change(form.getByLabelText("勝ったチーム"), { target: { value: "2" } });
    fireEvent.change(form.getByLabelText("点数"), { target: { value: "452" } });
    fireEvent.change(form.getByLabelText("画像"), { target: { files: [new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" })] } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(backend.count("POST", "/api/matches/7/wins")).toBe(1));
    const sent = backend.last("POST", "/api/matches/7/wins")?.form;
    expect(sent?.get("teamId")).toBe("2");
    expect(sent?.get("points")).toBe("452");
    expect((sent?.get("image") as File).name).toBe("shot.png");
    await waitFor(() => expect(backend.count("GET", "/api/board")).toBe(2));
  });

  it("N 試合を超える試合で勝つチームを選ぶと、点数の入力は要らず、固定点で登録されることを案内する", async () => {
    const backend = installFakeBackend({
      ...apis([slot({ matches: [match({ matchNumberA: 3, matchNumberB: 6 })] })]),
      "POST /api/matches/7/wins": { status: 201, body: { id: 3, points: 100 } },
    });
    renderApp("/");
    const form = await openAddWin("KMU vs UT");
    fireEvent.change(form.getByLabelText("画像"), { target: { files: [new File([new Uint8Array([1])], "a.png", { type: "image/png" })] } });

    // KMU は 3 試合目（N=5 以内）: 点数を入力する
    fireEvent.change(form.getByLabelText("勝ったチーム"), { target: { value: "1" } });
    expect((form.getByLabelText("点数") as HTMLInputElement).disabled).toBe(false);
    expect((form.getByRole("button", { name: "追加" }) as HTMLButtonElement).disabled).toBe(true);

    // UT は 6 試合目（N=5 を超える）: 入力は要らない。固定点で登録される
    fireEvent.change(form.getByLabelText("勝ったチーム"), { target: { value: "2" } });
    expect((form.getByLabelText("点数") as HTMLInputElement).disabled).toBe(true);
    expect(form.getByText(/固定点の 100pt で登録されます/)).toBeTruthy();
    fireEvent.click(form.getByRole("button", { name: "追加" }));

    await waitFor(() => expect(backend.count("POST", "/api/matches/7/wins")).toBe(1));
    expect(backend.last("POST", "/api/matches/7/wins")?.form?.get("points")).toBe("100");
  });

  it("点数が上限（100000）を超えると、追加できない", async () => {
    installFakeBackend(apis([slot({ matches: [match()] })]));
    renderApp("/");
    const form = await openAddWin("KMU vs UT");
    fireEvent.change(form.getByLabelText("勝ったチーム"), { target: { value: "1" } });
    fireEvent.change(form.getByLabelText("画像"), { target: { files: [new File([new Uint8Array([1])], "a.png", { type: "image/png" })] } });
    const add = form.getByRole("button", { name: "追加" }) as HTMLButtonElement;

    fireEvent.change(form.getByLabelText("点数"), { target: { value: "100001" } });
    expect(add.disabled).toBe(true);
    fireEvent.change(form.getByLabelText("点数"), { target: { value: "100000" } });
    expect(add.disabled).toBe(false);
  });

  it("勝利があれば、勝ったチーム・点数・記録した人・画像を出す。記録フォームは出さない", async () => {
    installFakeBackend(apis([slot({ matched: true, matches: [match({ win: win() })] })]));
    renderApp("/");

    const within21 = await card("21:00の対戦枠");
    // 組分けの 1 行に、勝利チーム・点数・記録・画像が並ぶ
    expect(within21.getByText("452pt").closest("tr")!.textContent).toContain("UT");
    expect(within21.getByText("452pt")).toBeTruthy();
    expect(within21.getByText(/管理者さん・10\/07 21:30/)).toBeTruthy();
    // 画像は、別のページには移らず、ポップアップで表示する
    expect(within21.queryByRole("link", { name: "画像" })).toBeNull();
    fireEvent.click(within21.getByRole("button", { name: "画像" }));
    expect(screen.getByRole("img", { name: "勝利#3の画像" }).getAttribute("src")).toBe("/api/screenshots/3");
    expect(within21.queryByRole("button", { name: /の勝利を追加/ })).toBeNull();
  });

  it("メニューの「勝利を削除」で、勝利を外す（外したあと、記録し直せる）", async () => {
    const backend = installFakeBackend({
      ...apis([slot({ matched: true, matches: [match({ win: win() })] })]),
      "PUT /api/wins/3/active": { body: { ok: true } },
    });
    renderApp("/");

    await choose("KMU vs UTの操作", "勝利を削除");

    await waitFor(() => expect(backend.last("PUT", "/api/wins/3/active")?.json).toEqual({ active: false }));
    await waitFor(() => expect(backend.count("GET", "/api/board")).toBe(2));
  });

  it("記録に失敗したら、理由を出す", async () => {
    installFakeBackend({
      ...apis([slot({ matches: [match()] })]),
      "POST /api/matches/7/wins": { status: 409, body: { error: "win_exists" } },
    });
    renderApp("/");

    const form = await openAddWin("KMU vs UT");
    fireEvent.change(form.getByLabelText("勝ったチーム"), { target: { value: "1" } });
    fireEvent.change(form.getByLabelText("点数"), { target: { value: "10" } });
    fireEvent.change(form.getByLabelText("画像"), { target: { files: [new File([new Uint8Array([1])], "a.png", { type: "image/png" })] } });
    fireEvent.click(form.getByRole("button", { name: "追加" }));

    expect((await screen.findAllByRole("alert"))[0]?.textContent).toContain("すでに勝利が記録されています");
  });

  it("勝利のある組分けを削除するときは、勝利も消えることを、確認に出す（削除済みの勝利も数える）", async () => {
    installFakeBackend(apis([slot({ matches: [match({ win: win(), deletedWins: 1 })] })]));
    renderApp("/");
    const within21 = await card("21:00の対戦枠");

    await choose("KMU vs UTの操作", "組分けを削除");

    expect(screen.getByRole("dialog", { name: "KMU vs UTの組分けを削除" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "勝利2件も削除して、実行する" })).toBeTruthy();
  });

  it("組分けの削除は、確認してから実行する", async () => {
    const backend = installFakeBackend({ ...apis([slot({ matches: [match()] })]), "DELETE /api/matches/7": { body: { ok: true } } });
    renderApp("/");
    const within21 = await card("21:00の対戦枠");

    await choose("KMU vs UTの操作", "組分けを削除");
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

  it("マッチング済みの対戦枠には「やり直す」が出る（確定は出ない）。消える組分けと勝利の件数を、確認に出す", async () => {
    const backend = installFakeBackend({
      ...apis([slot({ matched: true, matches: [match({ win: win() }), match({ id: 8, deletedWins: 1 })] })]),
      "POST /api/match-slots/reopen": { body: { ok: true, deletedMatches: 2, deletedWins: 2 } },
    });
    renderApp("/");
    const within21 = await card("21:00の対戦枠");
    expect(within21.queryByRole("button", { name: "マッチング処理を実行する" })).toBeNull();

    fireEvent.click(await within21.findByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("dialog", { name: "やり直す" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "組分け2件と勝利2件を削除して、やり直す" }));

    await waitFor(() => expect(backend.count("POST", "/api/match-slots/reopen")).toBe(1));
    expect(backend.last("POST", "/api/match-slots/reopen")?.json).toEqual({ slotHour: 21, slotDate: "2026-10-07" });
  });

  it("組分けも勝利もない対戦枠は、件数を出さずに「やり直しを実行する」だけ", async () => {
    installFakeBackend(apis([slot({ matched: true })]));
    renderApp("/");
    const within21 = await card("21:00の対戦枠");

    fireEvent.click(await within21.findByRole("button", { name: "やり直す" }));
    expect(screen.getByRole("button", { name: "やり直しを実行する" })).toBeTruthy();
  });
});
