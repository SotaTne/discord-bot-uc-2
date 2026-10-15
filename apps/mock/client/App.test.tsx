import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { USER_IDS, installFakeApi, sampleState } from "./test/fake-api";
import { renderApp } from "./test/render";

const jst = (text: string) => Date.parse(`${text}+09:00`);
const ok = { body: { ok: true, notice: "" } };
const stateRoute = (state = sampleState()) => ({ "GET /mock-api/state": { body: state } });
const message = (over: Record<string, unknown> = {}) => ({ id: "m1", channelId: "c", content: "こんにちは", createdAt: jst("2026-10-07T12:00:00"), visibleTo: null, ...over });

describe("画面の構成", () => {
  it("時計・実行者・コマンド・Discord・状態（対戦枠・チーム・マッチングログ）が出る", async () => {
    installFakeApi(stateRoute());
    renderApp();

    expect(await screen.findByLabelText("いまの時刻")).toBeTruthy();
    expect((screen.getByLabelText("いまの時刻") as HTMLInputElement).value).toBe("20:53");
    expect(screen.getByRole("heading", { name: "実行者" })).toBeTruthy();
    for (const name of ["対戦枠（今日）", "チーム", "マッチングログ"]) expect(screen.getByRole("region", { name })).toBeTruthy();
    // メッセージがなければ、その旨だけ出す
    expect(screen.getByText("まだ何もありません")).toBeTruthy();
  });

  it("実行者は、複数選べる。はじめは先頭の 1 人。実行ボタンに、だれとして実行するかが出る。だれも選ばなければ、押せない", async () => {
    installFakeApi(stateRoute());
    renderApp();
    const run = async () => (await screen.findByRole("button", { name: /で実行|実行者を選んでください/ })) as HTMLButtonElement;

    expect((await run()).textContent).toBe("alice (KMU) で実行");
    fireEvent.click(screen.getByRole("checkbox", { name: "carol (UT)" }));
    expect((await run()).textContent).toBe("alice (KMU)・carol (UT) で実行");
    fireEvent.click(screen.getByRole("checkbox", { name: "alice (KMU)" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "carol (UT)" }));

    expect((await run()).textContent).toBe("実行者を選んでください");
    expect((await run()).disabled).toBe(true);
  });

  it("コマンドは、選ぶと、そのフォームだけが出る（はじめは /uc-handup）。管理者のコマンドには、印がある", async () => {
    installFakeApi(stateRoute());
    renderApp();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("form", { name: "/uc-handup" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "/uc-admin-status" })).toBeNull();
    expect(screen.getByRole("tab", { name: /uc-admin-status/ }).textContent).toContain("管理者");

    fireEvent.click(screen.getByRole("tab", { name: /uc-admin-status/ }));

    expect(screen.getByRole("form", { name: "/uc-admin-status" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "/uc-handup" })).toBeNull();
  });

  it("入力欄は、オプションの型に合わせる: 時刻は対戦枠の選択（登録された試合時刻から）", async () => {
    installFakeApi(stateRoute());
    renderApp();
    const form = within(await screen.findByRole("form", { name: "/uc-handup" }));

    expect(within(form.getByLabelText(/^試合の開始時刻（時）/)).getAllByRole("option").map((o) => o.textContent)).toEqual(["選択", "21:00", "22:00"]);
  });

  it("worker の状態を取れないときは、理由を出す。時計・実行者・コマンドは、使える", async () => {
    installFakeApi(stateRoute(sampleState({ snapshot: null, snapshotError: "worker が 404 を返しました", clockSteps: [] })));
    renderApp();

    expect((await screen.findByRole("alert")).textContent).toContain("worker が 404 を返しました");
    expect(screen.getByLabelText("いまの時刻")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /締切/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /uc-handup/ })).toBeTruthy();
  });

  it("疑似 Discord のサーバーに接続できないときは、その旨を出す", async () => {
    installFakeApi({ "GET /mock-api/state": { status: 500, body: {} } });
    renderApp();

    expect((await screen.findByRole("alert")).textContent).toContain("接続できません");
  });
});

describe("状態", () => {
  it("今日の対戦枠が、未マッチングか、マッチング済みかを出す", async () => {
    installFakeApi(stateRoute());
    renderApp();

    const panel = within(await screen.findByRole("region", { name: "対戦枠（今日）" }));
    expect(panel.getByText("21:00").parentElement?.textContent).toContain("未マッチング");
    expect(panel.getByText("22:00").parentElement?.textContent).toContain("マッチング済み");
  });

  it("チームごとに、挙手中（対戦枠と挙手した人）・対戦数を出す", async () => {
    installFakeApi(stateRoute());
    renderApp();

    const rows = within(await screen.findByRole("region", { name: "チーム" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["KMU", "21:00 alice (KMU)", "2"],
      ["UT", "", "3"],
    ]);
  });

  it("マッチングログは、組分けと除外を出す。組めなかった対戦枠も出す", async () => {
    installFakeApi(stateRoute());
    renderApp();

    const log = within(await screen.findByRole("region", { name: "マッチングログ" }));
    expect(log.getByText("10/06 21:00").parentElement?.textContent).toContain("KMU vs UT");
    expect(log.getByText("10/06 21:00").parentElement?.textContent).toContain("除外 NGT");
    expect(log.getByText("組めず")).toBeTruthy();
  });

  it("まだ何もないときは、「まだありません」とだけ出す", async () => {
    const empty = sampleState();
    empty.snapshot!.rounds = [];
    installFakeApi(stateRoute(empty));
    renderApp();

    expect(within(await screen.findByRole("region", { name: "マッチングログ" })).getByText("まだありません")).toBeTruthy();
  });
});

describe("Discord の画面", () => {
  it("公開メッセージも、本人にだけ見える返信も、時刻順に 1 本で出す。だれに見えるかも出す", async () => {
    installFakeApi(
      stateRoute(sampleState({ messages: [message(), message({ id: "m2", content: "内緒", visibleTo: USER_IDS.admin })] as never })),
    );
    renderApp();

    const log = within(await screen.findByRole("log", { name: "Discord のメッセージ" }));
    expect(log.getByText("こんにちは").closest(".msg")?.textContent).toContain("全員");
    expect(log.getByText("内緒").closest(".msg")?.textContent).toContain("admin だけ");
    expect(log.getByText("内緒").closest(".msg")?.className).toContain("private");
  });

  it("メンションは名前で、URL はリンクで出す。HTML は、文字として出る（エスケープ）。見出し・太字・補足も、見た目にする", async () => {
    const content = "# 見出し\n<@&400000000000000001> と <@500000000000000001> と http://localhost:5173/login#token=abc\n<b>x</b> **太** \n-# 補足";
    installFakeApi(stateRoute(sampleState({ messages: [message({ content })] as never })));
    renderApp();

    const body = (await screen.findByRole("log")).querySelector(".body")!;
    expect(body.textContent).toContain("@KMU と @alice (KMU) と");
    expect(body.querySelector("a")?.getAttribute("href")).toBe("http://localhost:5173/login#token=abc");
    expect(body.textContent).toContain("<b>x</b>");
    expect(body.querySelector("b")).toBeNull();
    expect(body.querySelector(".h1")?.textContent).toBe("見出し");
    expect(body.querySelector("strong")?.textContent).toBe("太");
    expect(body.querySelector(".sub")?.textContent).toBe("補足");
    expect(body.textContent).not.toContain("**");
    expect(body.textContent).not.toContain("-#");
  });

  it("確認のボタンが出る。押すと、メッセージの ID と custom_id を送る。危険な操作は、赤いボタン", async () => {
    const api = installFakeApi({
      ...stateRoute(
        sampleState({
          messages: [message({ visibleTo: USER_IDS.admin, components: [{ type: 1, components: [{ type: 2, style: 4, label: "確認", custom_id: "sample:confirm" }] }] })] as never,
        }),
      ),
      "POST /mock-api/click": ok,
    });
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "確認" }));

    await waitFor(() => expect(api.callsTo("POST", "/mock-api/click")).toHaveLength(1));
    // 押した人（選んでいる実行者）も、送る。本人にだけ見える返信は、サーバーが、その本人として押す
    expect(api.callsTo("POST", "/mock-api/click")[0]?.form).toMatchObject({ custom_id: "sample:confirm", message_id: "m1" });
    expect(api.callsTo("POST", "/mock-api/click")[0]?.form).toHaveProperty("users");
  });
});

describe("コマンドの実行", () => {
  it("選んだ実行者と、入力した項目を、サーバーに送る。入力は消えない。成功の通知は出さない", async () => {
    const api = installFakeApi({ ...stateRoute(), "POST /mock-api/send": ok });
    renderApp();
    await screen.findByRole("form", { name: "/uc-handup" });
    fireEvent.click(screen.getByRole("checkbox", { name: "carol (UT)" }));
    fireEvent.change(screen.getByLabelText(/^試合の開始時刻（時）/), { target: { value: "21" } });

    fireEvent.click(screen.getByRole("button", { name: "alice (KMU)・carol (UT) で実行" }));

    await waitFor(() => expect(api.callsTo("POST", "/mock-api/send")).toHaveLength(1));
    expect(api.callsTo("POST", "/mock-api/send")[0]?.form).toMatchObject({ command: "uc-handup", users: `${USER_IDS.alice},${USER_IDS.carol}`, time: "21" });
    expect((screen.getByLabelText(/^試合の開始時刻（時）/) as HTMLSelectElement).value).toBe("21");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("失敗したら、理由だけを、通知に出す", async () => {
    installFakeApi({ ...stateRoute(), "POST /mock-api/send": { body: { ok: false, notice: "carol (UT): worker が 401 を返しました" } } });
    renderApp();
    await screen.findByRole("form", { name: "/uc-handup" });
    fireEvent.change(screen.getByLabelText(/^試合の開始時刻（時）/), { target: { value: "21" } });

    fireEvent.click(screen.getByRole("button", { name: "alice (KMU) で実行" }));

    expect((await screen.findByRole("alert")).textContent).toContain("worker が 401 を返しました");
  });
});

describe("時計の操作", () => {
  it("日付の前後ボタンで、日を 1 日ずつ動かす", async () => {
    const api = installFakeApi({ ...stateRoute(), "POST /mock-api/clock": ok });
    renderApp();

    fireEvent.click(await screen.findByRole("button", { name: "前の日" }));
    fireEvent.click(screen.getByRole("button", { name: "次の日" }));

    await waitFor(() => expect(api.callsTo("POST", "/mock-api/clock")).toHaveLength(2));
    expect(api.callsTo("POST", "/mock-api/clock").map((call) => call.form)).toEqual([
      { action: "day", value: "-1" },
      { action: "day", value: "1" },
    ]);
  });

  it("イベントのボタンは、時刻順。押すと、その日のその時刻へ移る。いまの時刻のイベントは、選ばれて見える", async () => {
    const api = installFakeApi({ ...stateRoute(), "POST /mock-api/clock": ok });
    renderApp();
    await screen.findByLabelText("いまの時刻");

    expect(screen.getAllByRole("button", { name: /^\d\d:\d\d / }).map((button) => button.textContent)).toEqual(["12:00 募集開始", "20:53 21時の締切", "21:00 21時の試合開始"]);
    expect(screen.getByRole("button", { name: "20:53 21時の締切" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "21:00 21時の試合開始" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "21:00 21時の試合開始" }));

    await waitFor(() => expect(api.callsTo("POST", "/mock-api/clock")).toHaveLength(1));
    expect(api.callsTo("POST", "/mock-api/clock")[0]?.form).toEqual({ action: "set", value: "2026-10-07T21:00" });
  });

  it("時刻の欄を直して確定すると、その時刻にする。変えなければ、何も送らない", async () => {
    const api = installFakeApi({ ...stateRoute(), "POST /mock-api/clock": ok });
    renderApp();
    const input = (await screen.findByLabelText("いまの時刻")) as HTMLInputElement;

    fireEvent.blur(input);
    expect(api.callsTo("POST", "/mock-api/clock")).toHaveLength(0);

    fireEvent.change(input, { target: { value: "21:30" } });
    fireEvent.blur(input);

    await waitFor(() => expect(api.callsTo("POST", "/mock-api/clock")).toHaveLength(1));
    expect(api.callsTo("POST", "/mock-api/clock")[0]?.form).toEqual({ action: "set", value: "2026-10-07T21:30" });
  });

  it("ずれを出す: 動かしているときは「本物より +8時間12分」、戻したときは「−」、本物の時刻と同じなら「本物の時刻」", async () => {
    installFakeApi(stateRoute());
    renderApp();
    expect(await screen.findByText("本物より +8時間12分")).toBeTruthy();
    cleanup();

    installFakeApi(stateRoute(sampleState({ clock: { now: jst("2026-10-07T20:53:00"), real: false, offsetMs: -90 * 60_000 } })));
    renderApp();
    expect(await screen.findByText("本物より −1時間30分")).toBeTruthy();
    cleanup();

    installFakeApi(stateRoute(sampleState({ clock: { now: jst("2026-10-07T20:53:00"), real: true, offsetMs: 0 } })));
    renderApp();
    expect(await screen.findByText("本物の時刻")).toBeTruthy();
  });

  it("止める / 再開のボタンは、ない（時計は、いつも動いている）", async () => {
    installFakeApi(stateRoute());
    renderApp();
    await screen.findByLabelText("いまの時刻");

    expect(screen.queryByRole("button", { name: /止める|再開/ })).toBeNull();
  });

  it("「現在時刻」で、本物の時刻に戻す。本物の時刻のときは、選ばれて見える", async () => {
    const api = installFakeApi({ ...stateRoute(), "POST /mock-api/clock": ok });
    renderApp();

    const now = await screen.findByRole("button", { name: "現在時刻" });
    expect(now.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(now);

    await waitFor(() => expect(api.callsTo("POST", "/mock-api/clock")).toHaveLength(1));
    expect(api.callsTo("POST", "/mock-api/clock")[0]?.form).toEqual({ action: "real" });
  });
});

describe("初期化", () => {
  it("確認してから、サーバーに初期化を送る。「キャンセル」なら、何も送らない", async () => {
    const api = installFakeApi({ ...stateRoute(), "POST /mock-api/reset": ok });
    renderApp();
    const button = await screen.findByRole("button", { name: "データを初期化" });

    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.click(button);
    expect(api.callsTo("POST", "/mock-api/reset")).toHaveLength(0);

    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    fireEvent.click(button);
    await waitFor(() => expect(api.callsTo("POST", "/mock-api/reset")).toHaveLength(1));
  });
});
