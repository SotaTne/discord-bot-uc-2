import { JSDOM, type DOMWindow } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { createTestMock, jst } from "./test-fixtures";

const ALICE = "500000000000000001";
const CAROL = "500000000000000003";
const ADMIN = "500000000000000005";

type Mock = Awaited<ReturnType<typeof createTestMock>>;
type Call = { url: string; method: string; fields: Record<string, string>; headers: Record<string, string> };

/**
 * ページを、ブラウザの代わりの jsdom で、スクリプトごと動かす。
 * ページの fetch は、mock のアプリ（と、worker の代わり）につなぐ。2秒ごとの取り直しは、手で呼べるようにしてある。
 */
async function openPage(mock: Mock, options: { confirm?: boolean; offline?: boolean } = {}) {
  const calls: Call[] = [];
  const intervals: (() => void)[] = [];
  /** 送信中（まだ応答が返っていない）の fetch の数 */
  let inFlight = 0;

  const fetchStub = async (input: string, init?: { method?: string; body?: FormData; headers?: Record<string, string> }) => {
    inFlight += 1;
    try {
      return await sendFetch(input, init);
    } finally {
      inFlight -= 1;
    }
  };

  const sendFetch = async (input: string, init?: { method?: string; body?: FormData; headers?: Record<string, string> }) => {
    const fields = init?.body ? Object.fromEntries([...init.body.entries()].map(([key, value]) => [key, String(value)])) : {};
    calls.push({ url: input, method: init?.method ?? "GET", fields, headers: init?.headers ?? {} });
    if (options.offline) throw new TypeError("Failed to fetch");

    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return mock.app.request(input, {
      method: init?.method ?? "GET",
      ...(init?.body ? { body } : {}),
      ...(init?.headers ? { headers: init.headers } : {}),
    });
  };

  const html = await (await mock.app.request("/")).text();
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: `http://mock.local/`,
    pretendToBeVisual: true,
    beforeParse(window) {
      Object.assign(window, {
        fetch: fetchStub,
        confirm: () => options.confirm ?? true,
        setInterval: (callback: () => void) => intervals.push(callback),
      });
    },
  });
  const { document } = dom.window;

  return {
    window: dom.window,
    document,
    calls,
    $: <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!,
    /** 2秒ごとの取り直しを、1回分、動かす */
    tick: async () => {
      intervals.forEach((callback) => callback());
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    /** 送信中の fetch が、すべて終わって、その結果の書き換えも済むまで待つ（負荷の高いときでも、時間に頼らない） */
    settle: async () => {
      for (let quiet = 0, waited = 0; quiet < 3 && waited < 5000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        quiet = inFlight === 0 ? quiet + 1 : 0;
      }
    },
  };
}

const submit = (form: Element, window: DOMWindow) =>
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

describe("画面のスクリプト: 自動更新", () => {
  it("開いたらすぐ、状態を取り直す", async () => {
    const page = await openPage(await createTestMock());
    await page.settle();

    expect(page.calls.map((c) => c.url)).toContain("/ui/fragments");
  });

  it("2秒ごとに取り直して、変わった表示だけを書き換える（変わっていなければ、触らない）", async () => {
    const mock = await createTestMock();
    const page = await openPage(mock);
    await page.settle();

    // 変わっていない表示の中の要素に、目印を付ける
    page.$("#state section").setAttribute("data-marker", "kept");
    mock.state.addMessage({ channelId: mock.state.channelId, content: "新しい投稿" });

    await page.tick();

    expect(page.$("#feed").textContent).toContain("新しい投稿");
    expect(page.$("#state section").getAttribute("data-marker")).toBe("kept");
  });

  it("時計が変わると、次の取り直しで、時刻の欄が変わる", async () => {
    const mock = await createTestMock();
    const page = await openPage(mock);
    await page.settle();

    mock.state.setClock(jst("2026-10-07T21:53:00"));
    await page.tick();

    expect(page.$<HTMLInputElement>("#clock-time").value).toBe("21:53");
  });

  it("mock や worker に繋がらなくても、エラーにならず、次の回に任せる", async () => {
    const page = await openPage(await createTestMock(), { offline: true });
    await expect(page.tick()).resolves.toBeUndefined();
  });
});

describe("画面のスクリプト: 実行者とコマンド", () => {
  const checkbox = (page: Awaited<ReturnType<typeof openPage>>, name: string) =>
    Array.from(page.document.querySelectorAll<HTMLInputElement>("#users input")).find((input) => input.dataset.name?.startsWith(name))!;
  const toggle = (page: Awaited<ReturnType<typeof openPage>>, name: string) => {
    const input = checkbox(page, name);
    input.checked = !input.checked;
    input.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  };
  const runButton = (page: Awaited<ReturnType<typeof openPage>>) => page.$<HTMLButtonElement>("form:not([hidden]) [data-run]");

  it("実行ボタンに、だれとして実行するかを出す。だれも選ばなければ、押せない", async () => {
    const page = await openPage(await createTestMock());
    expect(runButton(page).textContent).toBe("alice (KMU) で実行");

    toggle(page, "carol");
    expect(runButton(page).textContent).toBe("alice (KMU)・carol (UT) で実行");

    toggle(page, "alice");
    toggle(page, "carol");
    expect(runButton(page).disabled).toBe(true);
    expect(runButton(page).textContent).toBe("実行者を選んでください");
  });

  it("コマンドを選ぶと、そのフォームだけが出る", async () => {
    const page = await openPage(await createTestMock());

    page.$('[data-cmd="uc-admin-win"]').dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));

    expect(Array.from(page.document.querySelectorAll("form[data-send]:not([hidden])")).map((f) => f.id)).toEqual(["cmd-uc-admin-win"]);
    expect(page.$('[data-cmd="uc-admin-win"]').getAttribute("aria-selected")).toBe("true");
    expect(page.$('[data-cmd="uc-handup"]').getAttribute("aria-selected")).toBe("false");
  });
});

describe("画面のスクリプト: コマンドの実行（ページを読み込み直さない）", () => {
  const handupForm = (page: Awaited<ReturnType<typeof openPage>>) => page.$<HTMLFormElement>("#cmd-uc-handup");

  it("選んだ全員として、同時に送る。返信は Discord の画面に出る。成功の通知は出さない。入力は消えない", async () => {
    const mock = await createTestMock({ interaction: { type: 4, data: { content: "21時の試合に挙手しました", flags: 64 } } });
    const page = await openPage(mock);
    const input = page.document.querySelector<HTMLInputElement>('#users input[data-name^="carol"]')!;
    input.checked = true;
    input.dispatchEvent(new page.window.Event("change", { bubbles: true }));
    const form = handupForm(page);
    form.querySelector<HTMLSelectElement>("select[name=time]")!.value = "21";

    submit(form, page.window);
    await page.settle();

    const send = page.calls.find((c) => c.url.endsWith("/ui/send"))!;
    expect(send).toMatchObject({ method: "POST", fields: { users: `${ALICE},${CAROL}`, command: "uc-handup", time: "21" } });
    expect(send.headers["X-Mock-Ajax"]).toBe("1");
    expect(page.document.querySelectorAll("#feed .msg")).toHaveLength(2);
    expect(page.$("#notice").hidden).toBe(true);
    expect(form.querySelector<HTMLSelectElement>("select[name=time]")!.value).toBe("21");
  });

  it("失敗したら、理由だけを通知に出す", async () => {
    const page = await openPage(await createTestMock({ interactionStatus: 401 }));
    const form = handupForm(page);
    form.querySelector<HTMLSelectElement>("select[name=time]")!.value = "21";

    submit(form, page.window);
    await page.settle();

    expect(page.$("#notice").hidden).toBe(false);
    expect(page.$("#notice").textContent).toContain("401");
  });

  it("送っている間は、実行ボタンを押せない。終わったら、押せる", async () => {
    const page = await openPage(await createTestMock());
    const form = handupForm(page);
    const button = form.querySelector<HTMLButtonElement>("[data-run]")!;

    submit(form, page.window);
    expect(button.disabled).toBe(true);
    await page.settle();

    expect(button.disabled).toBe(false);
  });

  it("mock に繋がらないときは、その旨を通知に出す", async () => {
    const page = await openPage(await createTestMock(), { offline: true });
    submit(handupForm(page), page.window);
    await page.settle();

    expect(page.$("#notice").textContent).toBe("mock に接続できませんでした");
  });
});

describe("画面のスクリプト: ボタン", () => {
  const click = (element: Element, window: DOMWindow) =>
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const button = (page: Awaited<ReturnType<typeof openPage>>, label: string) =>
    Array.from(page.document.querySelectorAll<HTMLButtonElement>("button[data-post]")).find((b) => b.textContent?.trim() === label)!;

  const timeInput = (page: Awaited<ReturnType<typeof openPage>>) => page.$<HTMLInputElement>("#clock-time");

  it("時刻の欄を直すと、その時刻になり、cron も動く", async () => {
    const mock = await createTestMock();
    mock.state.setClock(jst("2026-10-07T15:00:00"));
    const page = await openPage(mock);
    await page.settle();

    timeInput(page).value = "16:40";
    timeInput(page).dispatchEvent(new page.window.Event("change", { bubbles: true }));
    await page.settle();

    expect(page.calls.find((c) => c.url.endsWith("/ui/clock"))?.fields).toEqual({ action: "set", value: "2026-10-07T16:40" });
    expect(mock.state.now()).toBe(jst("2026-10-07T16:40:00"));
    expect(mock.worker.callsTo("/dev/tick")).toHaveLength(1);
  });

  it("時刻の欄を入力している間は、自動の取り直しで、書き換えない", async () => {
    const mock = await createTestMock();
    mock.state.setClock(jst("2026-10-07T15:00:00"));
    const page = await openPage(mock);
    await page.settle();

    timeInput(page).focus();
    timeInput(page).value = "16:45";
    mock.state.setClock(jst("2026-10-07T18:00:00"));
    await page.tick();

    expect(timeInput(page).value).toBe("16:45");
  });

  it("イベントのボタンを押すと、その時刻になる。「現在時刻」で戻れる", async () => {
    const mock = await createTestMock();
    mock.state.setClock(jst("2026-10-07T15:00:00"));
    const page = await openPage(mock);
    await page.settle();

    click(button(page, "20:53 21時の締切"), page.window);
    await page.settle();

    expect(mock.state.now()).toBe(jst("2026-10-07T20:53:00"));
    expect(mock.worker.callsTo("/dev/tick")).toHaveLength(1);
    expect(button(page, "20:53 21時の締切").getAttribute("aria-pressed")).toBe("true");

    click(button(page, "現在時刻"), page.window);
    await page.settle();

    expect(mock.state.clockIso()).toBeNull();
    expect(button(page, "現在時刻").getAttribute("aria-pressed")).toBe("true");
  });

  it("日付の ▶ を押すと、翌日になる", async () => {
    const mock = await createTestMock();
    mock.state.setClock(jst("2026-10-07T20:53:00"));
    const page = await openPage(mock);
    await page.settle();

    click(page.$('[aria-label="次の日"]'), page.window);
    await page.settle();

    expect(mock.state.now()).toBe(jst("2026-10-08T20:53:00"));
    expect(page.$("#clock .daybar b").textContent).toBe("10/08（木）");
  });

  it("Discord のメッセージのボタンを押すと、そのメッセージの操作として送る", async () => {
    const mock = await createTestMock({ interaction: { type: 7, data: { content: "クリアしました", components: [] } } });
    const message = mock.state.addMessage({
      channelId: mock.state.channelId,
      content: "クリアしますか",
      visibleTo: ADMIN,
      components: [{ type: 1, components: [{ type: 2, style: 4, label: "全てクリア", custom_id: "score-clear:confirm" }] }],
    });
    const page = await openPage(mock);
    await page.settle();

    click(button(page, "全てクリア"), page.window);
    await page.settle();

    expect(page.calls.find((c) => c.url.endsWith("/ui/click"))?.fields).toEqual({ custom_id: "score-clear:confirm", message_id: message.id });
    expect(page.$("#feed").textContent).toContain("クリアしました");
  });

  it("「データを初期化」は、確認して、了承したときだけ実行する", async () => {
    const declined = await openPage(await createTestMock(), { confirm: false });
    click(button(declined, "データを初期化"), declined.window);
    await declined.settle();
    expect(declined.calls.some((c) => c.url.endsWith("/ui/reset"))).toBe(false);

    const accepted = await openPage(await createTestMock(), { confirm: true });
    click(button(accepted, "データを初期化"), accepted.window);
    await accepted.settle();
    expect(accepted.calls.some((c) => c.url.endsWith("/ui/reset"))).toBe(true);
  });
});
