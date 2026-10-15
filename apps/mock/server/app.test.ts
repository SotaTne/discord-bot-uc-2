import type { Interaction } from "@uc/discord";
import { describe, expect, it } from "vitest";
import { clockSteps } from "./api/clock-steps";
import { parseJstDateTime } from "./api/time";
import { REAL_NOW, createTestMock, jst, makeSnapshot } from "./test-fixtures";

const ALICE = "500000000000000001";
const CAROL = "500000000000000003";
const ADMIN = "500000000000000005";

type Mock = Awaited<ReturnType<typeof createTestMock>>;

const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const post = (app: Mock["app"], path: string, fields: Record<string, string | File>) =>
  app.request(path, { method: "POST", body: form(fields), headers: { "X-Mock-Ajax": "1" } });
const json = async (response: Response) => (await response.json()) as { ok: boolean; notice: string };

type StateBody = {
  guildId: string;
  channelId: string;
  users: { id: string; username: string; isAdmin: boolean; roleIds: string[] }[];
  roles: { id: string; name: string }[];
  messages: { content: string; visibleTo: string | null; components?: unknown[] }[];
  clock: { now: number; real: boolean; offsetMs: number };
  clockSteps: { at: number; label: string }[];
  snapshot: { slotHours: number[] } | null;
  snapshotError: string | null;
};
const stateOf = async (mock: Mock) => (await (await mock.app.request("/mock-api/state")).json()) as StateBody;

describe("構成: Discord のサーバー役と、画面用の API は、別の入口", () => {
  it("worker が呼ぶ REST と添付ファイルは、/api/v10。画面用の API は、/mock-api", async () => {
    const mock = await createTestMock();

    expect((await mock.app.request("/api/v10/guilds/200000000000000001/roles", { headers: { Authorization: "Bot x" } })).status).toBe(200);
    expect((await mock.app.request("/mock-api/state")).status).toBe(200);
    // 画面用の API は、Discord の入口の下には、ない。Discord の入口は、画面用の API の下には、ない
    expect((await mock.app.request("/api/v10/mock-api/state")).status).toBe(404);
    expect((await mock.app.request("/mock-api/api/v10/guilds/1/roles")).status).toBe(404);
  });
});

describe("GET /mock-api/state（画面に出すもの）", () => {
  it("ユーザー・ロール・メッセージ・時計・時計のイベント・worker の状態を、まとめて返す", async () => {
    const mock = await createTestMock();
    mock.state.addMessage({ channelId: mock.state.channelId, content: "こんにちは" });
    mock.state.addMessage({ channelId: mock.state.channelId, content: "内緒", visibleTo: ADMIN });

    const body = await stateOf(mock);

    expect(body.users.map((user) => user.username)).toEqual(["alice (KMU)", "bob (KMU)", "carol (UT)", "dave (NGT)", "admin"]);
    expect(body.users.find((user) => user.id === ADMIN)?.isAdmin).toBe(true);
    expect(body.roles.map((role) => role.name)).toEqual(["KMU", "UT", "NGT", "ITF"]);
    expect(body.messages.map((message) => [message.content, message.visibleTo])).toEqual([["こんにちは", null], ["内緒", ADMIN]]);
    expect(body.clock.real).toBe(true);
    expect(body.clockSteps.length).toBeGreaterThan(0);
    expect(body.snapshot?.slotHours).toEqual([21, 22, 23]);
    expect(body.snapshotError).toBeNull();
  });

  it("疑似時計を動かしていれば、その時刻と、本物の時刻からのずれを返す（real: false）", async () => {
    const mock = await createTestMock();
    mock.state.moveTo(jst("2026-10-07T20:53:00"));

    expect((await stateOf(mock)).clock).toEqual({ now: jst("2026-10-07T20:53:00"), real: false, offsetMs: jst("2026-10-07T20:53:00") - REAL_NOW });
  });

  it("worker の状態を取れないときは、状態は null で、理由を返す。時計の操作はできる", async () => {
    const mock = await createTestMock({ stateStatus: 500 });

    const body = await stateOf(mock);

    expect(body.snapshot).toBeNull();
    expect(body.snapshotError).toContain("500");
    expect(body.clockSteps).toEqual([]);
    expect(body.users).toHaveLength(5);
  });

  it("状態を取りに行くとき、worker の時計が、mock の時計とずれていれば、mock の時計を伝え直す（worker を作り直したときなど）", async () => {
    const mock = await createTestMock();
    mock.state.moveTo(jst("2026-10-07T20:53:00")); // まだ、worker には、伝えていない

    await mock.app.request("/mock-api/state");

    expect(JSON.parse(mock.worker.callsTo("/dev/clock")[0]!.body)).toEqual({ offsetMs: jst("2026-10-07T20:53:00") - REAL_NOW });
    // そろったあとは、伝え直さない
    await mock.app.request("/mock-api/state");
    expect(mock.worker.callsTo("/dev/clock")).toHaveLength(1);
  });

  it("autoTick: 次の分に入ったら、cron の処理を 1 回実行する。同じ分では、もう実行しない（本物の cron と同じ、毎分）", async () => {
    let real = REAL_NOW;
    const mock = await createTestMock({}, true, () => real);

    await mock.app.request("/mock-api/state");
    expect(mock.worker.callsTo("/dev/tick")).toHaveLength(0); // 同じ分

    real += 60_000;
    await mock.app.request("/mock-api/state");
    await mock.app.request("/mock-api/state");
    expect(mock.worker.callsTo("/dev/tick")).toHaveLength(1);

    real += 120_000;
    await mock.app.request("/mock-api/state");
    expect(mock.worker.callsTo("/dev/tick")).toHaveLength(2);
  });
});

describe("時計のイベント", () => {
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

  it("JST の日時を、読み書きできる", () => {
    expect(parseJstDateTime("2026-10-07T20:53")).toBe(jst("2026-10-07T20:53:00"));
    expect(parseJstDateTime("")).toBeNull();
  });
});

describe("コマンドの実行（POST /mock-api/send）", () => {
  it("フォームの項目を、コマンドのオプションにして worker に送る（選択した対戦枠は数値になる）", async () => {
    const mock = await createTestMock();

    const result = await json(await post(mock.app, "/mock-api/send", { users: ALICE, command: "uc-handup", time: "21" }));

    expect(result).toEqual({ ok: true, notice: "" });
    const interaction = JSON.parse(mock.worker.callsTo("/interactions")[0]!.body) as Interaction;
    expect(interaction.data).toEqual({ name: "uc-handup", options: [{ name: "time", type: 4, value: 21 }] });
    expect(interaction.member?.user.id).toBe(ALICE);
  });

  it("実行者が複数なら、選んだ順に、1人ずつ実行する。返信は、それぞれの本人にだけ見える", async () => {
    const mock = await createTestMock({ interaction: { type: 4, data: { content: "受け付けました", flags: 64 } } });

    await post(mock.app, "/mock-api/send", { users: `${CAROL},${ALICE}`, command: "uc-handup", time: "21" });

    const senders = mock.worker.callsTo("/interactions").map((call) => (JSON.parse(call.body) as Interaction).member?.user.id);
    expect(senders).toEqual([CAROL, ALICE]);
    expect(mock.state.messages).toMatchObject([
      { content: "受け付けました", visibleTo: CAROL },
      { content: "受け付けました", visibleTo: ALICE },
    ]);
  });

  it("実行者が選ばれていなければ、worker に送らず、理由を返す", async () => {
    const mock = await createTestMock();
    const result = await json(await post(mock.app, "/mock-api/send", { users: "", command: "uc-handup", time: "21" }));

    expect(result).toMatchObject({ ok: false, notice: "実行者を選んでください" });
    expect(mock.worker.callsTo("/interactions")).toEqual([]);
  });

  it("空の任意の項目は、オプションに入れない。管理者のコマンドは、管理者の権限で送る", async () => {
    const mock = await createTestMock();
    await post(mock.app, "/mock-api/send", { users: ADMIN, command: "uc-admin-dashboard", extra: "" });

    const interaction = JSON.parse(mock.worker.callsTo("/interactions")[0]!.body) as Interaction;
    expect(interaction.data?.options?.map((o) => o.name)).not.toContain("date");
    expect(interaction.member?.permissions).toBe("8");
  });

  it("知らないコマンドは、理由を返す", async () => {
    const result = await json(await post((await createTestMock()).app, "/mock-api/send", { users: ALICE, command: "uc-nothing" }));

    expect(result.ok).toBe(false);
    expect(result.notice).toContain("コマンドが見つかりません");
  });

  it("worker が受け付けなかったとき（署名の検証に失敗など）は、だれの実行が失敗したかを返す", async () => {
    const mock = await createTestMock({ interactionStatus: 401 });
    const result = await json(await post(mock.app, "/mock-api/send", { users: `${ALICE},${CAROL}`, command: "uc-status" }));

    expect(result).toEqual({ ok: false, notice: "alice (KMU): worker が 401 を返しました / carol (UT): worker が 401 を返しました" });
    expect(mock.state.messages).toEqual([]);
  });
});

describe("ボタンを押す（POST /mock-api/click）", () => {
  it("本人にだけ見えるメッセージは、その本人として押す。メッセージが置き換わる", async () => {
    const mock = await createTestMock({ interaction: { type: 7, data: { content: "完了しました", components: [] } } });
    const message = mock.state.addMessage({
      channelId: mock.state.channelId,
      content: "確認",
      visibleTo: ADMIN,
      components: [{ type: 1, components: [{ type: 2, style: 4, label: "確認", custom_id: "sample:confirm" }] }],
    });

    const result = await json(await post(mock.app, "/mock-api/click", { custom_id: "sample:confirm", message_id: message.id }));

    expect(result.ok).toBe(true);
    const interaction = JSON.parse(mock.worker.callsTo("/interactions")[0]!.body) as Interaction;
    expect(interaction.member?.user.id).toBe(ADMIN);
    expect(interaction.data?.custom_id).toBe("sample:confirm");
    expect(mock.state.messages[0]).toMatchObject({ content: "完了しました" });
    expect(mock.state.messages[0]?.components).toBeUndefined();
  });
});

describe("時計の操作（POST /mock-api/clock）", () => {
  it("日時を指定すると、その時刻になり、cron が自動で1回動く", async () => {
    const mock = await createTestMock({ tick: { ran: ["cutoff:2026-10-07:21"], errors: [] } });

    const result = await json(await post(mock.app, "/mock-api/clock", { action: "set", value: "2026-10-07T20:53" }));

    expect(result).toEqual({ ok: true, notice: "" });
    expect(mock.state.now()).toBe(jst("2026-10-07T20:53:00"));
    // 先に、worker に、時計（本物の時刻 + ずれ）を伝えてから、cron を実行する
    expect(JSON.parse(mock.worker.callsTo("/dev/clock")[0]!.body)).toEqual({ offsetMs: jst("2026-10-07T20:53:00") - REAL_NOW });
    expect(mock.worker.callsTo("/dev/tick")).toHaveLength(1);
  });

  it("移っても、時計は止まらない（本物の時刻が進めば、同じだけ進む）", async () => {
    let real = REAL_NOW;
    const mock = await createTestMock({}, false, () => real);
    await post(mock.app, "/mock-api/clock", { action: "set", value: "2026-10-07T20:53" });

    real += 5 * 60_000;

    expect(mock.state.now()).toBe(jst("2026-10-07T20:58:00"));
  });

  it("日を1日ずつ前後できる。時刻は、そのまま", async () => {
    const mock = await createTestMock();
    mock.state.moveTo(jst("2026-10-07T20:53:00"));

    await post(mock.app, "/mock-api/clock", { action: "day", value: "1" });
    expect(mock.state.now()).toBe(jst("2026-10-08T20:53:00"));
    await post(mock.app, "/mock-api/clock", { action: "day", value: "-1" });
    await post(mock.app, "/mock-api/clock", { action: "day", value: "-1" });
    expect(mock.state.now()).toBe(jst("2026-10-06T20:53:00"));
    expect((await json(await post(mock.app, "/mock-api/clock", { action: "day", value: "x" }))).ok).toBe(false);
    expect(mock.state.now()).toBe(jst("2026-10-06T20:53:00"));
  });

  it("現在時刻に戻せる", async () => {
    const mock = await createTestMock();
    mock.state.moveTo(jst("2026-10-07T20:53:00"));

    const result = await json(await post(mock.app, "/mock-api/clock", { action: "real" }));

    expect(result.ok).toBe(true);
    expect(mock.state.clock()).toEqual({ offsetMs: 0 });
    expect(mock.state.now()).toBe(REAL_NOW);
  });

  it("cron がエラーになったら、その理由を返す。worker が受け付けない（開発用のサーバーではない）ときも、理由を返す", async () => {
    const failed = await createTestMock({ tick: { ran: [], errors: ["cutoff:2026-10-07:21: Discord が応答しません"] } });
    const result = await json(await post(failed.app, "/mock-api/clock", { action: "set", value: "2026-10-07T20:53" }));
    expect(result).toEqual({ ok: false, notice: "cron のエラー: cutoff:2026-10-07:21: Discord が応答しません" });

    const disabled = await createTestMock({ tickStatus: 404 });
    expect((await json(await post(disabled.app, "/mock-api/clock", { action: "set", value: "2026-10-07T20:53" }))).notice).toContain("pnpm dev");
  });

  it("不正な日時・操作は、理由を返して、時計は動かさず、cron も動かさない", async () => {
    const mock = await createTestMock();

    expect((await json(await post(mock.app, "/mock-api/clock", { action: "set", value: "xx" }))).notice).toContain("日時");
    expect((await json(await post(mock.app, "/mock-api/clock", { action: "jump" }))).ok).toBe(false);
    expect(mock.state.now()).toBe(REAL_NOW);
    expect(mock.worker.callsTo("/dev/tick")).toEqual([]);
  });
});

describe("初期化（POST /mock-api/reset）", () => {
  it("worker の活動の記録・このページのメッセージ・時計を、すべて初期状態に戻す", async () => {
    const mock = await createTestMock();
    mock.state.addMessage({ channelId: mock.state.channelId, content: "x" });
    mock.state.moveTo(jst("2026-10-07T20:53:00"));

    const result = await json(await post(mock.app, "/mock-api/reset", {}));

    expect(result.ok).toBe(true);
    expect(mock.worker.callsTo("/dev/reset")).toHaveLength(1);
    expect(mock.state.messages).toEqual([]);
    expect(mock.state.clock()).toEqual({ offsetMs: 0 });
    // 時計も、worker に、本物の時刻へ戻したことを伝える
    expect(JSON.parse(mock.worker.callsTo("/dev/clock").at(-1)!.body)).toEqual({ offsetMs: 0 });
  });

  it("worker のデータを消せなかったときは、理由を返して、このページの状態も残す", async () => {
    const mock = await createTestMock({ resetStatus: 404 });
    mock.state.addMessage({ channelId: mock.state.channelId, content: "x" });

    expect((await json(await post(mock.app, "/mock-api/reset", {}))).ok).toBe(false);
    expect(mock.state.messages).toHaveLength(1);
  });
});
