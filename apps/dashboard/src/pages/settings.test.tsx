import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SLOTS, TEAMS, installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";

const SETTINGS = {
  channelId: "300000000000000001",
  recruitHour: 12,
  cutoffMinutes: 7,
  fixedAfterMatches: 5,
  fixedPoints: 100,
  revokeSessionsOnReissue: false,
};
const ROLES = { roles: [{ id: "400000000000000001", name: "KMU" }, { id: "400000000000000002", name: "UT" }, { id: "400000000000000003", name: "NGT" }] };

const apis = () => ({
  ...loggedIn,
  "GET /api/settings": { body: SETTINGS },
  "GET /api/slots": { body: SLOTS },
  "GET /api/teams": { body: TEAMS },
  "GET /api/roles": { body: ROLES },
  "GET /api/sessions": { body: { sessions: [] } },
});

describe("設定の画面: サーバーの設定", () => {
  it("いまの設定が、フォームに入っている", async () => {
    installFakeBackend(apis());
    renderApp("/settings");

    expect(((await screen.findByLabelText(/投稿先のチャンネル ID/)) as HTMLInputElement).value).toBe("300000000000000001");
    expect((screen.getByLabelText("募集を開始する時刻（時, JST）") as HTMLInputElement).value).toBe("12");
    expect((screen.getByLabelText("試合の何分前に締め切るか") as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText("何試合目までは、勝ったとき、記録した点数で集計するか（それを超えた試合は、固定点）") as HTMLInputElement).value).toBe("5");
    expect((screen.getByLabelText("それを超えた試合で勝ったときの、固定の点数") as HTMLInputElement).value).toBe("100");
  });

  it("変更して保存すると、数値と真偽値の形で送る。チャンネルを空にすると null", async () => {
    const backend = installFakeBackend({ ...apis(), "PUT /api/settings": { body: { ok: true } } });
    renderApp("/settings");
    fireEvent.change(await screen.findByLabelText(/投稿先のチャンネル ID/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("募集を開始する時刻（時, JST）"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("試合の何分前に締め切るか"), { target: { value: "15" } });
    fireEvent.click(screen.getByLabelText(/これまでのログインをすべて無効にする/));

    fireEvent.click(screen.getByRole("button", { name: "保存する" }));

    expect(await screen.findByText("保存しました")).toBeTruthy();
    expect(backend.last("PUT", "/api/settings")?.json).toEqual({
      channelId: null,
      recruitHour: 10,
      cutoffMinutes: 15,
      fixedAfterMatches: 5,
      fixedPoints: 100,
      revokeSessionsOnReissue: true,
    });
  });

  it("入力が不正で保存できなかったら、入力の確認を促す", async () => {
    installFakeBackend({ ...apis(), "PUT /api/settings": { status: 400, body: { success: false, error: { name: "ZodError" } } } });
    renderApp("/settings");

    fireEvent.click(await screen.findByRole("button", { name: "保存する" }));

    expect((await screen.findByRole("alert")).textContent).toContain("入力内容を確認してください");
  });
});

describe("設定の画面: 試合枠", () => {
  it("登録済みの枠を出し、追加の候補からは登録済みの時刻を除く", async () => {
    installFakeBackend(apis());
    renderApp("/settings");

    // 登録済みの枠（21:00 の削除ボタン）が表示されてから、追加の候補を確かめる
    await screen.findByRole("button", { name: "21:00の枠を削除" });
    const select = screen.getByLabelText("追加する枠");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("20:00");
    expect(options).not.toContain("21:00");
    expect(options).not.toContain("22:00");
  });

  it("枠を追加できる", async () => {
    const backend = installFakeBackend({ ...apis(), "POST /api/slots": { status: 201, body: { id: 14 } } });
    renderApp("/settings");
    await screen.findByRole("option", { name: "20:00" });

    fireEvent.change(screen.getByLabelText("追加する枠"), { target: { value: "20" } });
    fireEvent.click(screen.getAllByRole("button", { name: "追加する" })[0]!);

    await waitFor(() => expect(backend.last("POST", "/api/slots")?.json).toEqual({ hour: 20 }));
  });

  it("枠を削除できる", async () => {
    const backend = installFakeBackend({ ...apis(), "DELETE /api/slots/11": { body: { ok: true } } });
    renderApp("/settings");

    fireEvent.click(await screen.findByRole("button", { name: "21:00の枠を削除" }));

    await waitFor(() => expect(backend.count("DELETE", "/api/slots/11")).toBe(1));
  });
});

describe("設定の画面: ログイン中の端末", () => {
  it("設定の画面の中に、ログイン中の端末の一覧がある（ログイン管理は、別のページにしない）", async () => {
    installFakeBackend(apis());
    renderApp("/settings");

    expect(await screen.findByRole("heading", { name: "ログイン中の端末" })).toBeTruthy();
  });
});
