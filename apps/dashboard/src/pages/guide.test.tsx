import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { commands } from "@uc/discord/commands";
import guideSource from "../guide/guide.md?raw";
import { installFakeBackend, loggedIn, renderApp } from "../test/fake-backend";
import { COMMANDS_MARKER, headingsOf } from "./guide";

// 図の描画は、ブラウザの中で行うので、テストでは、描画する関数を差し替える
vi.mock("mermaid", () => ({
  default: { initialize: () => undefined, render: async (_id: string, chart: string) => ({ svg: `<svg data-chart="${chart.split("\n")[0]}"></svg>` }) },
}));

describe("ガイド", () => {
  it("目次と、コマンド一覧（コマンド定義から作る）が出る", async () => {
    installFakeBackend({ ...loggedIn });
    renderApp("/guide");

    expect(await screen.findByRole("heading", { level: 1, name: "ガイド" })).toBeTruthy();
    const toc = within(screen.getByRole("navigation", { name: "目次" }));
    expect(toc.getByRole("link", { name: "得点の数え方" }).getAttribute("href")).toBe("#得点の数え方");
    expect(document.getElementById("得点の数え方")).not.toBeNull();

    const table = within(screen.getByRole("table", { name: "コマンド一覧" }));
    expect(table.getAllByRole("row")).toHaveLength(commands.length + 1);
    expect(table.getByText("/uc-admin-win time team-role point image [date]")).toBeTruthy();
    expect(screen.queryByText(COMMANDS_MARKER)).toBeNull();
  });

  it("```mermaid の囲みは、図になる（元の文字は出ない）", async () => {
    installFakeBackend({ ...loggedIn });
    renderApp("/guide");
    const diagrams = await screen.findAllByRole("img", { name: "図" });
    expect(diagrams.length).toBeGreaterThan(0);
    await waitFor(() => expect(diagrams[0]!.querySelector("svg")).not.toBeNull());
    expect(screen.queryByText(/flowchart/)).toBeNull();
  });

  it("Markdown の表も表示される", async () => {
    installFakeBackend({ ...loggedIn });
    renderApp("/guide");
    expect(await screen.findByRole("columnheader", { name: "用語" })).toBeTruthy();
  });
});

describe("guide.md", () => {
  it("コマンド一覧の差し込み場所が、ちょうど 1 つある", () => {
    expect(guideSource.split(COMMANDS_MARKER)).toHaveLength(2);
  });

  it("コマンドを足したら、ガイドにも書く（管理者のコマンドで、参加者向けの表に出ないものは除く）", () => {
    const missing = commands.filter((command) => !guideSource.includes(`/${command.name}`) && command.default_member_permissions === undefined);
    expect(missing.map((command) => command.name)).toEqual([]);
  });

  it("見出しは重複しない（目次のリンク先が決まらなくなる）", () => {
    const texts = headingsOf(guideSource).map((heading) => heading.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});
