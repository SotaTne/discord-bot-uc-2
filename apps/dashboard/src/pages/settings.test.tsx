import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SLOT_HOURS, TEAMS, installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

const SETTINGS = {
  channelId: "300000000000000001",
  recruitHour: 12,
  cutoffMinutes: 7,
  recruitMentionMode: "none" as const,
  recruitMentionTargets: [] as string[],
  matchLimit: null as number | null,
  revokeSessionsOnReissue: false,
};
const ROLES = { roles: [{ id: "400000000000000001", name: "KMU" }, { id: "400000000000000002", name: "UT" }, { id: "400000000000000003", name: "NGT" }] };

const apis = () => ({
  ...loggedIn,
  "GET /api/settings": { body: SETTINGS },
  "GET /api/slot-hours": { body: SLOT_HOURS },
  "GET /api/teams": { body: TEAMS },
  "GET /api/roles": { body: ROLES },
  "GET /api/sessions": { body: { sessions: [] } },
  "GET /api/board": { body: { date: "2026-10-07", today: "2026-10-07", slots: [] } },
});

const region = (name: string) => within(screen.getByRole("region", { name }));

describe("設定の画面: 設定は、関わるものごとに、別々のセクションに分かれる", () => {
  it("いまの設定が、それぞれのセクションに入っている", async () => {
    installFakeBackend(apis());
    renderApp("/settings");

    expect(((await screen.findByLabelText(/投稿先のチャンネル ID/)) as HTMLInputElement).value).toBe("300000000000000001");
    expect((screen.getByLabelText("募集開始時刻（JST）") as HTMLInputElement).value).toBe("12");
    expect((screen.getByLabelText("締切（試合の何分前）") as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText(/これまでのログインをすべて失効させる/) as HTMLInputElement).checked).toBe(false);
  });

  it("「投稿と募集」だけを保存しても、ほかの項目は、いまの値のまま送る。チャンネルを空にすると null。保存すると、「保存しました」と出る", async () => {
    let current = { ...SETTINGS };
    const backend = installFakeBackend({
      ...apis(),
      "GET /api/settings": () => ({ body: current }),
      "PUT /api/settings": (request) => {
        current = { ...current, ...(request.json as object) };
        return { body: { ok: true } };
      },
    });
    renderApp("/settings");
    fireEvent.change(await screen.findByLabelText(/投稿先のチャンネル ID/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("募集開始時刻（JST）"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("締切（試合の何分前）"), { target: { value: "15" } });

    fireEvent.click(region("投稿と募集").getByRole("button", { name: "保存する" }));

    expect(await region("投稿と募集").findByText("保存しました")).toBeTruthy();
    expect(backend.last("PUT", "/api/settings")?.json).toEqual({
      channelId: null,
      recruitHour: 10,
      cutoffMinutes: 15,
      recruitMentionMode: "none",
      recruitMentionTargets: [],
      matchLimit: null,
      revokeSessionsOnReissue: false,
    });
  });

  it("試合数の規定数を、入力して保存できる。空にすると、規定数なし（null）。範囲外は、保存できない", async () => {
    const backend = installFakeBackend({ ...apis(), "PUT /api/settings": { body: { ok: true, notified: false, notifyFailed: false } } });
    renderApp("/settings");
    const input = await screen.findByLabelText("試合数の規定数");

    fireEvent.change(input, { target: { value: "0" } });
    expect((region("投稿と募集").getByRole("button", { name: "保存する" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(region("投稿と募集").getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(backend.last("PUT", "/api/settings")?.json).toMatchObject({ matchLimit: 5 }));
  });

  describe("募集開始の時刻・締切の変更（投稿先があるとき、変更を知らせるかを、確認する）", () => {
    const putOk = (notified = true) => ({ "PUT /api/settings": () => ({ body: { ok: true, notified, notifyFailed: false } }) });
    const board = (handups: number) => ({
      body: {
        date: "2026-10-07",
        today: "2026-10-07",
        slots: [{ hour: 21, matched: false, handups: Array.from({ length: handups }, (_, id) => ({ id })) }],
      },
    });
    const dialog = () => within(screen.getByRole("dialog"));
    const changeAndSave = async (labelText: string, value: string) => {
      fireEvent.change(await screen.findByLabelText(labelText), { target: { value } });
      fireEvent.click(region("投稿と募集").getByRole("button", { name: "保存する" }));
    };

    it("募集開始の時刻を変えると、確認が出る。知らせる（初期）で変更すると、notifyChange: true で保存して、「通知しました」と出る", async () => {
      let current = { ...SETTINGS };
      const backend = installFakeBackend({
        ...apis(),
        "GET /api/settings": () => ({ body: current }),
        "PUT /api/settings": (request) => {
          current = { ...current, ...(request.json as object) };
          return { body: { ok: true, notified: true, notifyFailed: false } };
        },
      });
      renderApp("/settings");
      await changeAndSave("募集開始時刻（JST）", "15");

      expect(dialog().getByText("募集開始: 12:00 → 15:00")).toBeTruthy();
      expect((dialog().getByLabelText("チャンネルに、変更を通知する") as HTMLInputElement).checked).toBe(true);
      expect(dialog().getByText(/いまの設定: なし/)).toBeTruthy();
      expect(backend.last("PUT", "/api/settings")).toBeUndefined(); // 確認するまで、保存しない

      fireEvent.click(dialog().getByRole("button", { name: "変更する" }));

      await waitFor(() => expect(backend.last("PUT", "/api/settings")?.json).toMatchObject({ recruitHour: 15, notifyChange: true }));
      expect(await screen.findByText("チャンネルに、変更を通知しました")).toBeTruthy();
    });

    it("通知のチェックを外すと、notifyChange: false で保存する（打ち間違いを、すぐ直すとき）", async () => {
      const backend = installFakeBackend({ ...apis(), ...putOk(false) });
      renderApp("/settings");
      await changeAndSave("締切（試合の何分前）", "5");

      expect(dialog().getByText("締切: 試合の 7 分前 → 5 分前")).toBeTruthy();
      fireEvent.click(dialog().getByLabelText("チャンネルに、変更を通知する"));
      fireEvent.click(dialog().getByRole("button", { name: "変更する" }));

      await waitFor(() => expect(backend.last("PUT", "/api/settings")?.json).toMatchObject({ cutoffMinutes: 5, notifyChange: false }));
      expect(screen.queryByText("チャンネルに、変更を通知しました")).toBeNull();
    });

    it("募集開始を後ろにずらして、今日の挙手があるときは、「残るが、新しい時刻まで取り消せない」と警告する。前にずらすときは、警告しない", async () => {
      installFakeBackend({ ...apis(), ...putOk(), "GET /api/board": board(2) });
      renderApp("/settings");
      await screen.findByRole("region", { name: "投稿と募集" });
      await waitFor(() => expect(screen.getByLabelText("募集開始時刻（JST）")).toBeTruthy());
      await new Promise((resolve) => setTimeout(resolve, 50)); // 挙手の件数を、取るのを待つ
      await changeAndSave("募集開始時刻（JST）", "15");
      expect(dialog().getByRole("alert").textContent).toContain("今日の挙手が 2 件あります");
      fireEvent.click(dialog().getByRole("button", { name: "キャンセル" }));

      await changeAndSave("募集開始時刻（JST）", "10");
      expect(dialog().queryByRole("alert")).toBeNull();
    });

    it("キャンセルすると、保存しない。通知先だけ・点数だけの変更や、投稿先が空のときは、確認を出さずに、保存する", async () => {
      const backend = installFakeBackend({ ...apis(), ...putOk() });
      renderApp("/settings");
      await changeAndSave("募集開始時刻（JST）", "15");
      fireEvent.click(dialog().getByRole("button", { name: "キャンセル" }));
      expect(backend.last("PUT", "/api/settings")).toBeUndefined();

      fireEvent.change(screen.getByLabelText("募集開始時刻（JST）"), { target: { value: "12" } });
      fireEvent.click(screen.getByRole("radio", { name: "チーム全て" }));
      fireEvent.click(region("投稿と募集").getByRole("button", { name: "保存する" }));
      await waitFor(() => expect(backend.last("PUT", "/api/settings")?.json).toMatchObject({ recruitMentionMode: "teams" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect((backend.last("PUT", "/api/settings")?.json as { notifyChange?: boolean }).notifyChange).toBeUndefined();
    });

    it("通知に失敗したら、設定は保存したことと、通知に失敗したことを、出す", async () => {
      installFakeBackend({ ...apis(), "PUT /api/settings": () => ({ body: { ok: true, notified: false, notifyFailed: true } }) });
      renderApp("/settings");
      await changeAndSave("締切（試合の何分前）", "5");
      fireEvent.click(dialog().getByRole("button", { name: "変更する" }));

      expect((await screen.findByRole("alert")).textContent).toContain("チャンネルへの通知に失敗しました");
    });
  });

  describe("募集開始の通知先", () => {
    const save = (backend: ReturnType<typeof installFakeBackend>) => backend.last("PUT", "/api/settings")?.json;

    it("既定は「なし」。「チーム全て」にして保存できる", async () => {
      const backend = installFakeBackend({ ...apis(), "PUT /api/settings": () => ({ body: { ok: true } }) });
      renderApp("/settings");
      await screen.findByRole("region", { name: "投稿と募集" });

      expect((screen.getByRole("radio", { name: "なし" }) as HTMLInputElement).checked).toBe(true);
      expect(screen.queryByLabelText("通知するロール")).toBeNull();

      fireEvent.click(screen.getByRole("radio", { name: "チーム全て" }));
      expect(screen.getByText("登録済みのチームのロールに、通知します")).toBeTruthy();
      expect(screen.queryByLabelText("通知するロール")).toBeNull();
      fireEvent.click(region("投稿と募集").getByRole("button", { name: "保存する" }));

      await waitFor(() => expect(save(backend)).toMatchObject({ recruitMentionMode: "teams", recruitMentionTargets: [] }));
    });

    it("「ロールを選ぶ」: ロール（複数）と @here を選んで、保存できる。選んだものは、あとで「なし」に戻しても、残る", async () => {
      const backend = installFakeBackend({ ...apis(), "PUT /api/settings": () => ({ body: { ok: true } }) });
      renderApp("/settings");
      await screen.findByRole("region", { name: "投稿と募集" });
      fireEvent.click(screen.getByRole("radio", { name: "ロールを選ぶ" }));

      const [picker] = await screen.findAllByLabelText("通知するロール");
      fireEvent.focus(picker!);
      fireEvent.click(picker!);
      // 候補の一覧は、画面の外に描かれる（jsdom では、見えない扱いになるので、hidden を付ける）
      fireEvent.click(await screen.findByRole("option", { name: "@here（オンラインの人）", hidden: true }));
      fireEvent.click(await screen.findByRole("option", { name: "NGT", hidden: true }));
      fireEvent.click(region("投稿と募集").getByRole("button", { name: "保存する" }));

      await waitFor(() => expect(save(backend)).toMatchObject({ recruitMentionMode: "roles", recruitMentionTargets: ["here", "400000000000000003"] }));
    });

    it("保存してある通知先を、画面に出す（一覧にないロールも、ID で見える）。キャンセルで、元に戻る", async () => {
      installFakeBackend({
        ...apis(),
        "GET /api/settings": { body: { ...SETTINGS, recruitMentionMode: "roles", recruitMentionTargets: ["here", "400000000000000001", "999999999999999999"] } },
      });
      renderApp("/settings");

      expect((await screen.findByRole("radio", { name: "ロールを選ぶ" }) as HTMLInputElement).checked).toBe(true);
      // 選んである通知先が、画面に出ている（選択済みの表示と、候補の一覧の、両方にあるので、1 つ以上）
      for (const label of ["@here（オンラインの人）", "KMU", "ロール 999999999999999999"]) {
        expect((await screen.findAllByText(label)).length, label).toBeGreaterThan(0);
      }

      fireEvent.click(screen.getByRole("radio", { name: "なし" }));
      fireEvent.click(region("投稿と募集").getByRole("button", { name: "キャンセル" }));
      expect((screen.getByRole("radio", { name: "ロールを選ぶ" }) as HTMLInputElement).checked).toBe(true);
    });
  });

  it("変更がないときは、保存できない。変更すると、「保存していない変更があります」と出て、保存できる", async () => {
    installFakeBackend(apis());
    renderApp("/settings");
    await screen.findByRole("region", { name: "投稿と募集" });
    const save = async () => (await region("投稿と募集").findByRole("button", { name: "保存する" })) as HTMLButtonElement;

    expect((await save()).disabled).toBe(true);
    expect(region("投稿と募集").queryByText("保存していない変更があります")).toBeNull();

    fireEvent.change(screen.getByLabelText("締切（試合の何分前）"), { target: { value: "10" } });
    expect((await save()).disabled).toBe(false);
    expect(region("投稿と募集").getByText("保存していない変更があります")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("締切（試合の何分前）"), { target: { value: "7" } });
    expect((await save()).disabled).toBe(true);
  });

  it("変更したあとの「キャンセル」（文字のリンク）で、入力を、保存した値に戻す。何も送らない。変更がなければ、出ない", async () => {
    const backend = installFakeBackend({ ...apis(), "PUT /api/settings": { body: { ok: true } } });
    renderApp("/settings");
    await screen.findByRole("region", { name: "投稿と募集" });
    expect(region("投稿と募集").queryByRole("button", { name: "キャンセル" })).toBeNull();

    fireEvent.change(screen.getByLabelText("締切（試合の何分前）"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("募集開始時刻（JST）"), { target: { value: "9" } });
    fireEvent.click(region("投稿と募集").getByRole("button", { name: "キャンセル" }));

    expect((screen.getByLabelText("締切（試合の何分前）") as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText("募集開始時刻（JST）") as HTMLInputElement).value).toBe("12");
    expect(region("投稿と募集").queryByRole("button", { name: "キャンセル" })).toBeNull();
    expect(backend.count("PUT", "/api/settings")).toBe(0);
  });

  it("範囲を外れた入力は、その場で理由を出して、保存できない（API には送らない）", async () => {
    const backend = installFakeBackend({ ...apis(), "PUT /api/settings": { body: { ok: true } } });
    renderApp("/settings");
    fireEvent.change(await screen.findByLabelText("募集開始時刻（JST）"), { target: { value: "24" } });
    fireEvent.change(screen.getByLabelText("締切（試合の何分前）"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/投稿先のチャンネル ID/), { target: { value: "12345" } });

    const post = region("投稿と募集");
    expect(post.getByText("23 以下にしてください")).toBeTruthy();
    expect(post.getByText("1 以上にしてください")).toBeTruthy();
    expect(post.getByText(/チャンネル ID（15〜25 桁の数字）/)).toBeTruthy();
    expect((post.getByRole("button", { name: "保存する" }) as HTMLButtonElement).disabled).toBe(true);
    expect(backend.count("PUT", "/api/settings")).toBe(0);
  });

  it("「今日の予定」に、いまの入力で、募集開始と各試合時刻の締切を出す（保存する前に確かめられる）", async () => {
    installFakeBackend(apis());
    renderApp("/settings");

    const schedule = await screen.findByLabelText("今日の予定");
    expect(schedule.textContent).toContain("12:00 に募集を開始");
    expect(schedule.textContent).toContain("21:00 の試合は、20:53 に締切");
    expect(schedule.textContent).toContain("22:00 の試合は、21:53 に締切");

    fireEvent.change(screen.getByLabelText("締切（試合の何分前）"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("募集開始時刻（JST）"), { target: { value: "9" } });
    expect(screen.getByLabelText("今日の予定").textContent).toContain("09:00 に募集を開始");
    expect(screen.getByLabelText("今日の予定").textContent).toContain("21:00 の試合は、20:45 に締切");

    fireEvent.change(screen.getByLabelText("締切（試合の何分前）"), { target: { value: "x" } });
    expect(screen.queryByLabelText("今日の予定")).toBeNull();
  });

  it("ログインの設定は、切り替えると、その場で保存する（保存ボタンはない）", async () => {
    const backend = installFakeBackend({ ...apis(), "PUT /api/settings": { body: { ok: true } } });
    renderApp("/settings");

    fireEvent.click(await screen.findByLabelText(/これまでのログインをすべて失効させる/));

    await waitFor(() => expect(backend.last("PUT", "/api/settings")?.json).toMatchObject({ revokeSessionsOnReissue: true, cutoffMinutes: 7 }));
    expect(region("ログイン").queryByRole("button", { name: "保存する" })).toBeNull();
  });

  it("API が入力を受け付けなかったら、そのセクションに、入力の確認を促す", async () => {
    installFakeBackend({ ...apis(), "PUT /api/settings": { status: 400, body: { success: false, error: { name: "ZodError" } } } });
    renderApp("/settings");

    fireEvent.change(await screen.findByLabelText(/投稿先のチャンネル ID/), { target: { value: "300000000000000002" } });
    fireEvent.click(region("投稿と募集").getByRole("button", { name: "保存する" }));

    expect((await region("投稿と募集").findByRole("alert")).textContent).toContain("入力内容を確認してください");
  });

});

describe("設定の画面: 試合時刻", () => {
  it("登録済みの試合時刻を出し、追加の候補からは登録済みの時刻を除く", async () => {
    installFakeBackend(apis());
    renderApp("/settings");

    // 登録済みの試合時刻（21:00 の削除ボタン）が表示されてから、追加の候補を確かめる
    await screen.findByRole("button", { name: "21:00の試合時刻を削除" });
    const select = screen.getByLabelText("追加する試合時刻");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("20:00");
    expect(options).not.toContain("21:00");
    expect(options).not.toContain("22:00");
  });

  it("試合時刻を追加できる", async () => {
    const backend = installFakeBackend({ ...apis(), "POST /api/slot-hours": { status: 201, body: { id: 14 } } });
    renderApp("/settings");
    await screen.findByRole("option", { name: "20:00" });

    fireEvent.change(screen.getByLabelText("追加する試合時刻"), { target: { value: "20" } });
    fireEvent.click(screen.getAllByRole("button", { name: "追加する" })[0]!);

    await waitFor(() => expect(backend.last("POST", "/api/slot-hours")?.json).toEqual({ hour: 20 }));
  });

  it("試合時刻の削除は、確認のダイアログを出してから実行する。残るもの・止まるものを、書く", async () => {
    const backend = installFakeBackend({ ...apis(), "DELETE /api/slot-hours/11": { body: { ok: true } } });
    renderApp("/settings");

    fireEvent.click(await screen.findByRole("button", { name: "21:00の試合時刻を削除" }));

    const dialog = within(screen.getByRole("dialog", { name: "21:00の試合時刻を削除" }));
    expect(dialog.getByText(/この時刻の募集・挙手・マッチングは、今から行われません/)).toBeTruthy();
    expect(dialog.getByText(/削除した日（今日）までの対戦枠は、「削除済み」として、対戦枠の画面に残ります/)).toBeTruthy();
    expect(dialog.getByText(/同じ時刻を追加し直すと、元に戻ります/)).toBeTruthy();
    // ダイアログを開いただけでは、削除しない
    expect(backend.count("DELETE", "/api/slot-hours/11")).toBe(0);

    fireEvent.click(dialog.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/slot-hours/11")).toBe(1));
  });

  it("今日、その時刻に、まだ組まれていない挙手があれば、件数を、確認に出す", async () => {
    const handup = (id: number) => ({ id, team: { id: 1, name: "KMU" }, raisedByName: "alice", createdAt: 0 });
    const board = () => ({
      body: {
        date: "2026-10-07",
        today: "2026-10-07",
        slots: [{ hour: 21, deleted: false, phase: "open", matched: false, excluded: null, handups: [handup(1), handup(2)], matches: [] }],
      },
    });
    installFakeBackend({ ...apis(), "GET /api/board": board() });
    renderApp("/settings");
    fireEvent.click(await screen.findByRole("button", { name: "21:00の試合時刻を削除" }));
    expect(await screen.findByText(/今日は、この時刻に、2件の挙手が入っています（組まれません）/)).toBeTruthy();
  });
});

describe("設定の画面: ログイン中の端末", () => {
  it("設定の画面の中に、ログイン中の端末の一覧がある（ログイン管理は、別のページにしない）", async () => {
    installFakeBackend(apis());
    renderApp("/settings");

    expect(await screen.findByRole("heading", { name: "ログイン中の端末" })).toBeTruthy();
  });
});
