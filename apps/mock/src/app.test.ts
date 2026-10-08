import type { Interaction } from "@uc/discord";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { parseJstDateTime } from "./app";
import { createTestMock, jst, makeSnapshot } from "./test-fixtures";
import { renderMentions, toJstInputValue } from "./ui/format";
import { clockSteps } from "./ui/clock-steps";

const ALICE = "500000000000000001";
const CAROL = "500000000000000003";
const ADMIN = "500000000000000005";

type Mock = Awaited<ReturnType<typeof createTestMock>>;

const pageOf = async (mock: Mock) => new JSDOM(await (await mock.app.request("/")).text()).window.document;
const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const post = (app: Mock["app"], path: string, fields: Record<string, string | File>) =>
  app.request(path, { method: "POST", body: form(fields), headers: { "X-Mock-Ajax": "1" } });
const json = async (response: Response) => (await response.json()) as { ok: boolean; notice: string };
const rowsOf = (section: Element) =>
  Array.from(section.querySelectorAll("tbody tr")).map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.replace(/\s+/g, " ").trim()));
const sectionOf = (page: Document, title: string) =>
  Array.from(page.querySelectorAll("#state section")).find((section) => section.querySelector("h2")?.textContent === title)!;

describe("画面の構成", () => {
  it("実行者は、フォームの外にある。複数選べて、はじめは先頭の1人", async () => {
    const page = await pageOf(await createTestMock());

    const users = Array.from(page.querySelectorAll<HTMLInputElement>("#users input[type=checkbox]"));
    expect(users.map((input) => input.dataset.name)).toEqual(["alice (KMU)", "bob (KMU)", "carol (UT)", "dave (NGT)", "admin"]);
    expect(users.filter((input) => input.checked).map((input) => input.value)).toEqual([ALICE]);
    expect(page.querySelectorAll("form [name=user], form [name=users]")).toHaveLength(0);
  });

  it("コマンドは、選ぶと、そのフォームだけが出る（はじめは /uc-handup）。管理者のコマンドには印が付く", async () => {
    const page = await pageOf(await createTestMock());

    const tabs = Array.from(page.querySelectorAll(".tab"));
    expect(tabs.map((tab) => tab.getAttribute("data-cmd"))).toEqual([
      "uc-handup", "uc-handdown", "uc-status", "uc-teams", "uc-admin-status", "uc-admin-win", "uc-admin-score-clear", "uc-admin-dashboard",
    ]);
    expect(tabs.filter((tab) => tab.querySelector("small")).map((tab) => tab.getAttribute("data-cmd"))).toEqual([
      "uc-admin-status", "uc-admin-win", "uc-admin-score-clear", "uc-admin-dashboard",
    ]);
    expect(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.getAttribute("data-cmd"))).toEqual(["uc-handup"]);
    expect(Array.from(page.querySelectorAll("form[data-send]:not([hidden])")).map((f) => f.id)).toEqual(["cmd-uc-handup"]);
  });

  it("入力欄は、オプションの型に合わせる: 時刻は対戦枠の選択、チームはロールの選択、点数は数値、画像はファイル、日付は日付", async () => {
    const win = (await pageOf(await createTestMock())).querySelector("#cmd-uc-admin-win")!;

    const optionsOf = (name: string) => Array.from(win.querySelectorAll(`select[name=${name}] option`)).map((o) => o.textContent);
    expect(optionsOf("time")).toEqual(["選択", "21:00", "22:00", "23:00"]);
    expect(optionsOf("team-role")).toEqual(["選択", "KMU", "UT", "NGT", "ITF"]);
    expect(win.querySelector("input[name=point]")?.getAttribute("type")).toBe("number");
    expect(win.querySelector("input[name=image]")?.getAttribute("type")).toBe("file");
    expect(win.querySelector("input[name=date]")?.getAttribute("type")).toBe("date");
    expect(win.querySelector("input[name=date]")?.hasAttribute("required")).toBe(false);
  });

  it("オプションのないコマンド（得点クリアを含む）には、入力欄がない", async () => {
    const page = await pageOf(await createTestMock());

    expect(page.querySelectorAll("#cmd-uc-admin-score-clear input:not([type=hidden]), #cmd-uc-admin-score-clear select")).toHaveLength(0);
    expect(page.querySelectorAll("#cmd-uc-status input:not([type=hidden]), #cmd-uc-status select")).toHaveLength(0);
  });

  it("時刻の選択肢は、worker に登録されている試合時刻から作る。状態を取れないときは、既定の 21・22・23 時", async () => {
    const options = (page: Document) => Array.from(page.querySelectorAll("#cmd-uc-handup select[name=time] option")).map((o) => o.textContent);

    expect(options(await pageOf(await createTestMock({ snapshot: makeSnapshot({ slots: [20, 21] }) })))).toEqual(["選択", "20:00", "21:00"]);
    expect(options(await pageOf(await createTestMock({ stateStatus: 500 })))).toEqual(["選択", "21:00", "22:00", "23:00"]);
  });

  it("使い方の説明文や、cron の操作・予定の表は、置かない", async () => {
    const text = (await pageOf(await createTestMock())).querySelector("main")?.textContent ?? "";

    expect(text).not.toContain("cron");
    expect(text).not.toContain("説明");
    expect((await pageOf(await createTestMock())).querySelectorAll("table")).toHaveLength(1);
  });
});

describe("時計", () => {
  const clockAt = async (text: string | null, options: Parameters<typeof createTestMock>[0] = {}) => {
    const mock = await createTestMock(options);
    if (text) mock.state.setClock(jst(text));
    return (await pageOf(mock)).querySelector("#clock")!;
  };
  const steps = (clock: Element) => Array.from(clock.querySelectorAll(".steps .step")).map((t) => [t.textContent, t.getAttribute("aria-pressed")]);

  it("日付（前後ボタン）と、直せる時刻と、イベントのボタンがある。カレンダーはない", async () => {
    const clock = await clockAt("2026-10-07T20:00:00");

    expect(clock.querySelector(".daybar b")?.textContent).toBe("10/07（水）");
    expect(clock.querySelector<HTMLInputElement>("#clock-time")?.value).toBe("20:00");
    expect(clock.querySelector<HTMLInputElement>("#clock-time")?.dataset.date).toBe("2026-10-07");
    expect(clock.querySelectorAll(".day[aria-label]")).toHaveLength(2);
    expect(clock.querySelector('input[type="date"], input[type="datetime-local"], input[type="range"]')).toBeNull();
  });

  it("イベントのボタンは時刻順。押すと、その時刻へ移る。いまのイベントは、選ばれて見える", async () => {
    const clock = await clockAt("2026-10-07T20:53:00");

    expect(steps(clock)).toEqual([
      ["12:00 募集開始", "false"],
      ["20:53 21時の締切", "true"],
      ["21:00 21時の試合開始", "false"],
      ["21:53 22時の締切", "false"],
      ["22:00 22時の試合開始", "false"],
      ["23:00 23時の試合開始", "false"],
    ]);
    expect(JSON.parse(clock.querySelectorAll(".steps .step")[3]!.getAttribute("data-fields")!)).toEqual({ action: "set", value: "2026-10-07T21:53" });
  });

  it("現在時刻のときは「現在時刻」が選ばれて見える。ほかの時刻では、選ばれない", async () => {
    expect((await clockAt(null)).querySelector(".now-button")?.getAttribute("aria-pressed")).toBe("true");
    expect((await clockAt("2026-10-07T20:00:00")).querySelector(".now-button")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("状態を取れないときは、イベントのボタンはなく、時刻と「現在時刻」は使える", async () => {
    const clock = await clockAt(null, { stateStatus: 500 });

    expect(clock.querySelectorAll(".steps .step")).toHaveLength(0);
    expect(clock.querySelector("#clock-time")).not.toBeNull();
  });

  it("イベントは、募集開始・各対戦枠の締切・各対戦枠の試合開始。時刻順", () => {
    const steps = clockSteps(makeSnapshot());

    expect(steps.map((step) => step.at)).toEqual([
      jst("2026-10-07T12:00:00"), jst("2026-10-07T20:53:00"), jst("2026-10-07T21:00:00"),
      jst("2026-10-07T21:53:00"), jst("2026-10-07T22:00:00"), jst("2026-10-07T23:00:00"),
    ]);
    expect(steps.map((step) => step.label).filter((label) => label.includes("試合開始"))).toEqual([
      "21:00 21時の試合開始", "22:00 22時の試合開始", "23:00 23時の試合開始",
    ]);
    expect(clockSteps(null)).toEqual([]);
  });
});

describe("状態", () => {
  it("今日の対戦枠が、未マッチングか、マッチング済みかを出す", async () => {
    const page = await pageOf(await createTestMock());

    expect(Array.from(sectionOf(page, "対戦枠（今日）").querySelectorAll(".fixture")).map((f) => [f.textContent, f.classList.contains("matched")])).toEqual([
      ["21:00 未マッチング", false],
      ["22:00 マッチング済み", true],
      ["23:00 未マッチング", false],
    ]);
  });

  it("チームごとに、挙手中（対戦枠と挙手した人）・対戦数・勝利数・得点を出す。挙手のないチームは、空", async () => {
    const page = await pageOf(await createTestMock());

    expect(rowsOf(sectionOf(page, "チーム"))).toEqual([
      ["KMU", "21:00 alice (KMU)", "2", "1", "80"],
      ["UT", "", "3", "4", "310"],
    ]);
  });

  it("マッチングログは、組分けと除外を出す。組めなかった対戦枠も出す", async () => {
    const [first, second] = Array.from(sectionOf(await pageOf(await createTestMock()), "マッチングログ").querySelectorAll("li"));
    const lines = (item: Element | undefined) => Array.from(item?.querySelectorAll("div") ?? []).map((line) => line.textContent);

    expect(first?.querySelector(".when")?.textContent).toBe("10/06 21:00");
    expect(lines(first)).toEqual(["KMU vs UT", "除外 NGT"]);
    expect(second?.querySelector(".when")?.textContent).toBe("10/06 22:00");
    expect(second?.textContent).toContain("組めず");
    expect(lines(second)).toEqual(["除外 UT"]);
  });

  it("勝利ログは、対戦枠・組分け・勝ったチーム・点数（入力 → 集計）・何試合目・画像を出す", async () => {
    const [first] = Array.from(sectionOf(await pageOf(await createTestMock()), "勝利ログ").querySelectorAll("li"));

    expect(first?.querySelector(".when")?.textContent).toBe("10/06 21:00");
    expect(Array.from(first?.querySelectorAll("div") ?? []).map((line) => line.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "KMU vs UT",
      "UT の勝利 30 → 100pt · 6試合目 画像",
    ]);
    expect(first?.querySelector("a")?.getAttribute("href")).toBe("/ui/screenshot/2");
  });

  it("無効にした記録は、薄く表示して、（無効）と出す。何試合目かは出さない", async () => {
    const items = Array.from(sectionOf(await pageOf(await createTestMock()), "勝利ログ").querySelectorAll("li"));

    expect(items[0]?.className).toBe("");
    expect(items[1]?.className).toBe("dim");
    expect(items[1]?.textContent).toContain("（無効）");
    expect(items[1]?.textContent).not.toContain("試合目");
    expect(items[1]?.querySelector("a")).toBeNull();
  });

  it("まだ何もないときは、「まだありません」とだけ出す", async () => {
    const empty = makeSnapshot({ handups: [], rounds: [], wins: [] });
    const page = await pageOf(await createTestMock({ snapshot: empty }));

    expect(sectionOf(page, "マッチングログ").textContent).toContain("まだありません");
    expect(sectionOf(page, "勝利ログ").textContent).toContain("まだありません");
  });

  it("worker から状態を取れないときは、理由を出す", async () => {
    const text = (await pageOf(await createTestMock({ stateStatus: 404 }))).querySelector("#state")?.textContent ?? "";

    expect(text).toContain("worker の状態を取得できません");
    expect(text).toContain("404");
  });

  it("疑似時計の時刻で、状態を取りに行く（X-Dev-Now）", async () => {
    const mock = await createTestMock();
    mock.state.setClock(jst("2026-10-07T20:53:00"));
    await pageOf(mock);

    expect(mock.worker.callsTo("/dev/state")[0]?.headers["X-Dev-Now"]).toBe(new Date(jst("2026-10-07T20:53:00")).toISOString());
    expect(mock.worker.callsTo("/dev/state")[0]?.search).toBe("?guildId=200000000000000001");
  });
});

describe("Discord の画面", () => {
  it("公開メッセージも、本人にだけ見える返信も、時刻順に1本で出す。だれに見えるかも出す", async () => {
    const mock = await createTestMock();
    mock.state.setClock(jst("2026-10-07T20:53:00"));
    mock.state.addMessage({ channelId: mock.state.channelId, content: "# 募集を開始します" });
    mock.state.addMessage({ channelId: mock.state.channelId, content: "aliceだけ", visibleTo: ALICE });

    const messages = Array.from((await pageOf(mock)).querySelectorAll("#feed .msg"));

    expect(messages.map((m) => m.querySelector(".meta")?.textContent)).toEqual(["20:53 · 全員", "20:53 · alice (KMU) だけ"]);
    expect(messages.map((m) => m.classList.contains("private"))).toEqual([false, true]);
  });

  it("何もないときは、その旨だけ出す", async () => {
    expect((await pageOf(await createTestMock())).querySelector("#feed")?.textContent).toContain("まだ何もありません");
  });

  it("メンションは名前で、URL はリンクで出す。それ以外の HTML は、エスケープされる", async () => {
    const mock = await createTestMock();
    const kmu = mock.state.findRole("KMU")!;
    mock.state.addMessage({ channelId: mock.state.channelId, content: `<@&${kmu.id}> http://localhost:5173/login#token=abc <b>bold</b>` });
    const html = await (await mock.app.request("/")).text();

    expect(html).toContain('<a href="http://localhost:5173/login#token=abc"');
    expect(html).toContain("@KMU");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toContain("<b>bold</b>");
  });

  it("見出しと太字は、記号のままでなく、見た目にする", async () => {
    const mock = await createTestMock();
    mock.state.addMessage({ channelId: mock.state.channelId, content: "## 試合 (時間:21時) の組分け:\n- **KMU** vs **UT**\n\n<script>x</script>" });

    const body = (await pageOf(mock)).querySelector("#feed .msg .body")!;

    expect(body.querySelector(".h.h2")?.textContent).toBe("試合 (時間:21時) の組分け:");
    expect(Array.from(body.querySelectorAll("strong")).map((s) => s.textContent)).toEqual(["KMU", "UT"]);
    expect(body.textContent).not.toContain("**");
    expect(body.querySelector("script")).toBeNull();
  });

  it("確認のボタンが出て、押す操作（custom_id とメッセージ）を持つ。危険な操作は、赤いボタン", async () => {
    const mock = await createTestMock();
    const message = mock.state.addMessage({
      channelId: mock.state.channelId,
      content: "クリアしますか",
      visibleTo: ADMIN,
      components: [{ type: 1, components: [{ type: 2, style: 4, label: "全てクリア", custom_id: "score-clear:confirm" }] }],
    });

    const button = (await pageOf(mock)).querySelector("#feed button[data-post]")!;

    expect(button.textContent).toBe("全てクリア");
    expect(button.className).toContain("danger");
    expect(JSON.parse(button.getAttribute("data-fields")!)).toEqual({ custom_id: "score-clear:confirm", message_id: message.id });
  });
});

describe("GET /ui/fragments（自動で書き換わる表示）", () => {
  it("時計・Discord・状態を返す。状態を取るたびに、worker に問い合わせる", async () => {
    const mock = await createTestMock();
    mock.state.addMessage({ channelId: mock.state.channelId, content: "aliceだけ", visibleTo: ALICE });

    const body = (await (await mock.app.request("/ui/fragments")).json()) as Record<string, string>;
    await mock.app.request("/ui/fragments");

    expect(Object.keys(body).sort()).toEqual(["clock", "feed", "state"]);
    expect(body.feed).toContain("aliceだけ");
    expect(body.state).toContain("チーム");
    expect(mock.worker.callsTo("/dev/state")).toHaveLength(2);
  });
});

describe("コマンドの実行（POST /ui/send）", () => {
  it("フォームの項目を、コマンドのオプションにして worker に送る（選択した対戦枠は数値になる）", async () => {
    const mock = await createTestMock();

    const result = await json(await post(mock.app, "/ui/send", { users: ALICE, command: "uc-handup", time: "21" }));

    expect(result).toEqual({ ok: true, notice: "" });
    const interaction = JSON.parse(mock.worker.callsTo("/interactions")[0]!.body) as Interaction;
    expect(interaction.data).toEqual({ name: "uc-handup", options: [{ name: "time", type: 4, value: 21 }] });
    expect(interaction.member?.user.id).toBe(ALICE);
  });

  it("実行者が複数なら、選んだ順に、1人ずつ実行する。返信は、それぞれの本人にだけ見える", async () => {
    const mock = await createTestMock({ interaction: { type: 4, data: { content: "受け付けました", flags: 64 } } });

    await post(mock.app, "/ui/send", { users: `${CAROL},${ALICE}`, command: "uc-handup", time: "21" });

    const senders = mock.worker.callsTo("/interactions").map((call) => (JSON.parse(call.body) as Interaction).member?.user.id);
    expect(senders).toEqual([CAROL, ALICE]);
    expect(mock.state.messages).toMatchObject([
      { content: "受け付けました", visibleTo: CAROL },
      { content: "受け付けました", visibleTo: ALICE },
    ]);
  });

  it("実行者が選ばれていなければ、worker に送らず、理由を返す", async () => {
    const mock = await createTestMock();
    const result = await json(await post(mock.app, "/ui/send", { users: "", command: "uc-handup", time: "21" }));

    expect(result).toMatchObject({ ok: false, notice: "実行者を選んでください" });
    expect(mock.worker.callsTo("/interactions")).toEqual([]);
  });

  it("空の任意の項目は、オプションに入れない。管理者のコマンドは、管理者の権限で送る", async () => {
    const mock = await createTestMock();
    await post(mock.app, "/ui/send", { users: ADMIN, command: "uc-admin-win", time: "21", "team-role": "UT", point: "80", image: new File([new Uint8Array([1])], "a.png", { type: "image/png" }), date: "" });

    const interaction = JSON.parse(mock.worker.callsTo("/interactions")[0]!.body) as Interaction;
    expect(interaction.data?.options?.map((o) => o.name)).not.toContain("date");
    expect(interaction.member?.permissions).toBe("8");
  });

  it("画像をアップロードすると、添付ファイルとして渡り、mock の URL から取得できる", async () => {
    const mock = await createTestMock({ interaction: { type: 5, data: { flags: 64 } } });
    const file = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });

    const result = await json(
      await post(mock.app, "/ui/send", { users: ADMIN, command: "uc-admin-win", time: "21", "team-role": "UT", point: "80", image: file, date: "" }),
    );

    expect(result.ok).toBe(true);
    const interaction = JSON.parse(mock.worker.callsTo("/interactions")[0]!.body) as Interaction;
    expect(interaction.data?.options?.map((o) => o.name)).toEqual(["time", "team-role", "point", "image"]);
    const [attachment] = Object.values(interaction.data?.resolved?.attachments ?? {});
    expect(attachment).toMatchObject({ filename: "shot.png", content_type: "image/png", size: 4 });

    const served = await mock.app.request(new URL(attachment!.url).pathname);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect((await mock.app.request("/attachments/unknown")).status).toBe(404);
  });

  it("知らないコマンドは、理由を返す", async () => {
    const result = await json(await post((await createTestMock()).app, "/ui/send", { users: ALICE, command: "uc-nothing" }));

    expect(result.ok).toBe(false);
    expect(result.notice).toContain("コマンドが見つかりません");
  });

  it("worker が受け付けなかったとき（署名の検証に失敗など）は、だれの実行が失敗したかを返す", async () => {
    const mock = await createTestMock({ interactionStatus: 401 });
    const result = await json(await post(mock.app, "/ui/send", { users: `${ALICE},${CAROL}`, command: "uc-status" }));

    expect(result).toEqual({ ok: false, notice: "alice (KMU): worker が 401 を返しました / carol (UT): worker が 401 を返しました" });
    expect(mock.state.messages).toEqual([]);
  });
});

describe("ボタンを押す（POST /ui/click）", () => {
  it("本人にだけ見えるメッセージは、その本人として押す。メッセージが置き換わる", async () => {
    const mock = await createTestMock({ interaction: { type: 7, data: { content: "クリアしました", components: [] } } });
    const message = mock.state.addMessage({
      channelId: mock.state.channelId,
      content: "確認",
      visibleTo: ADMIN,
      components: [{ type: 1, components: [{ type: 2, style: 4, label: "全てクリア", custom_id: "score-clear:confirm" }] }],
    });

    const result = await json(await post(mock.app, "/ui/click", { custom_id: "score-clear:confirm", message_id: message.id }));

    expect(result.ok).toBe(true);
    const interaction = JSON.parse(mock.worker.callsTo("/interactions")[0]!.body) as Interaction;
    expect(interaction.member?.user.id).toBe(ADMIN);
    expect(interaction.data?.custom_id).toBe("score-clear:confirm");
    expect(mock.state.messages[0]).toMatchObject({ content: "クリアしました" });
    expect(mock.state.messages[0]?.components).toBeUndefined();
  });
});

describe("時計の操作（POST /ui/clock）", () => {
  it("日時を指定すると、その時刻になり、cron が自動で1回動く", async () => {
    const mock = await createTestMock({ tick: { ran: ["cutoff:2026-10-07:21"], errors: [] } });

    const result = await json(await post(mock.app, "/ui/clock", { action: "set", value: "2026-10-07T20:53" }));

    expect(result).toEqual({ ok: true, notice: "" });
    expect(mock.state.now()).toBe(jst("2026-10-07T20:53:00"));
    expect(JSON.parse(mock.worker.callsTo("/dev/tick")[0]!.body)).toEqual({ now: new Date(jst("2026-10-07T20:53:00")).toISOString() });
  });

  it("日を1日ずつ前後できる。時刻は、そのまま", async () => {
    const mock = await createTestMock();
    mock.state.setClock(jst("2026-10-07T20:53:00"));

    await post(mock.app, "/ui/clock", { action: "day", value: "1" });
    expect(mock.state.now()).toBe(jst("2026-10-08T20:53:00"));
    await post(mock.app, "/ui/clock", { action: "day", value: "-1" });
    await post(mock.app, "/ui/clock", { action: "day", value: "-1" });
    expect(mock.state.now()).toBe(jst("2026-10-06T20:53:00"));
    expect((await json(await post(mock.app, "/ui/clock", { action: "day", value: "x" }))).ok).toBe(false);
    expect(mock.state.now()).toBe(jst("2026-10-06T20:53:00"));
  });

  it("現在時刻に戻せる", async () => {
    const mock = await createTestMock();
    mock.state.setClock(jst("2026-10-07T20:53:00"));

    const result = await json(await post(mock.app, "/ui/clock", { action: "real" }));

    expect(result.ok).toBe(true);
    expect(mock.state.clockIso()).toBeNull();
  });

  it("cron がエラーになったら、その理由を返す。worker が受け付けない（DEV_CLOCK が無効）ときも、理由を返す", async () => {
    const failed = await createTestMock({ tick: { ran: [], errors: ["cutoff:2026-10-07:21: Discord が応答しません"] } });
    const result = await json(await post(failed.app, "/ui/clock", { action: "set", value: "2026-10-07T20:53" }));
    expect(result).toEqual({ ok: false, notice: "cron のエラー: cutoff:2026-10-07:21: Discord が応答しません" });

    const disabled = await createTestMock({ tickStatus: 404 });
    expect((await json(await post(disabled.app, "/ui/clock", { action: "set", value: "2026-10-07T20:53" }))).notice).toContain("DEV_CLOCK");
  });

  it("不正な日時・操作は、理由を返して、時計は動かさず、cron も動かさない", async () => {
    const mock = await createTestMock();
    mock.state.setClock(jst("2026-10-07T15:00:00"));

    expect((await json(await post(mock.app, "/ui/clock", { action: "set", value: "xx" }))).notice).toContain("日時");
    expect((await json(await post(mock.app, "/ui/clock", { action: "jump" }))).ok).toBe(false);
    expect(mock.state.now()).toBe(jst("2026-10-07T15:00:00"));
    expect(mock.worker.callsTo("/dev/tick")).toEqual([]);
  });
});

describe("初期化（POST /ui/reset）", () => {
  it("worker の活動の記録・このページのメッセージ・時計を、すべて初期状態に戻す", async () => {
    const mock = await createTestMock();
    mock.state.addMessage({ channelId: mock.state.channelId, content: "x" });
    mock.state.setClock(jst("2026-10-07T20:53:00"));

    const result = await json(await post(mock.app, "/ui/reset", {}));

    expect(result.ok).toBe(true);
    expect(mock.worker.callsTo("/dev/reset")).toHaveLength(1);
    expect(mock.state.messages).toEqual([]);
    expect(mock.state.clockIso()).toBeNull();
  });

  it("worker のデータを消せなかったときは、理由を返して、このページの状態も残す", async () => {
    const mock = await createTestMock({ resetStatus: 404 });
    mock.state.addMessage({ channelId: mock.state.channelId, content: "x" });

    expect((await json(await post(mock.app, "/ui/reset", {}))).ok).toBe(false);
    expect(mock.state.messages).toHaveLength(1);
  });
});

describe("保存された画像の表示（GET /ui/screenshot/:seq）", () => {
  it("worker から画像を取って、そのまま返す。なければ 404", async () => {
    const mock = await createTestMock({ screenshot: { status: 200, contentType: "image/png", bytes: [9, 8, 7] } });
    const response = await mock.app.request("/ui/screenshot/2");

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
    expect((await (await createTestMock()).app.request("/ui/screenshot/2")).status).toBe(404);
  });
});

describe("補助", () => {
  it("JST の日時を、読み書きできる", () => {
    expect(parseJstDateTime("2026-10-07T20:53")).toBe(jst("2026-10-07T20:53:00"));
    expect(parseJstDateTime("")).toBeNull();
    expect(toJstInputValue(jst("2026-10-07T20:53:00"))).toBe("2026-10-07T20:53");
  });

  it("メンションを名前にする。不明な ID は ID のまま", async () => {
    const { state } = await createTestMock();
    const kmu = state.findRole("KMU")!;
    expect(renderMentions(`<@&${kmu.id}> と <@${ALICE}> と <@&999> と <@888>`, state)).toBe("@KMU と @alice (KMU) と @999 と @888");
  });
});
