import { describe, expect, it } from "vitest";
import { MAX_ROLE_TEAM_BUTTONS, parseRoleSetId, ROLE_CHECK_ID, ROLE_REMOVE_ID, roleRegistrationMessages, roleSetId } from "./roles";

const teams = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `チーム${i + 1}` }));
const labels = (components: { components: { label: string }[] }[]) => components.map((row) => row.components.map((button) => button.label));
const one = (count: number) => {
  const pages = roleRegistrationMessages({ teams: teams(count) });
  expect(pages).toHaveLength(1);
  return pages[0]!;
};
const teamButtons = (components: { components: { label: string; custom_id?: string }[] }[]) =>
  components.flatMap((row) => row.components).filter((button) => button.custom_id?.startsWith("role-set:"));

describe("ロール登録のメッセージ", () => {
  it("チームごとのボタンと、最後の行に「今のロールを外す」「ロールを確認」を置く（チームのボタンは、1 行に 5 つ）", () => {
    const { components } = one(7);

    expect(labels(components)).toEqual([
      ["チーム1", "チーム2", "チーム3", "チーム4", "チーム5"],
      ["チーム6", "チーム7"],
      ["今のロールを外す", "ロールを確認"],
    ]);
  });

  it("ボタンの custom_id は、チームの ID・外す・確認。外すは赤（danger）、確認は灰色", () => {
    const { components } = one(1);

    expect(components[0]!.components[0]).toMatchObject({ style: 1, custom_id: "role-set:1" });
    expect(components[1]!.components).toEqual([
      { type: 2, style: 4, label: "今のロールを外す", custom_id: ROLE_REMOVE_ID },
      { type: 2, style: 2, label: "ロールを確認", custom_id: ROLE_CHECK_ID },
    ]);
  });

  it("本文に、変えるには先に外す必要があることを書く", () => {
    expect(one(1).content).toContain("先に「今のロールを外す」を押してください");
  });

  it("チームがなければ、メッセージは 1 つ。その旨を書き、操作のボタンだけを置く", () => {
    const pages = roleRegistrationMessages({ teams: [] });

    expect(pages).toHaveLength(1);
    expect(pages[0]!.content).toContain("登録されているチームがありません");
    expect(labels(pages[0]!.components)).toEqual([["今のロールを外す", "ロールを確認"]]);
  });

  it("20 チームまでは、1 つのメッセージに収める。行は 5 行以内で、分けた旨は書かない", () => {
    const { content, components } = one(MAX_ROLE_TEAM_BUTTONS);

    expect(components).toHaveLength(5);
    expect(teamButtons(components)).toHaveLength(MAX_ROLE_TEAM_BUTTONS);
    expect(content).not.toContain("分けて");
    expect(content).not.toContain("（1/");
  });

  it("21 チーム以上は、20 チームごとにメッセージを分ける。各メッセージに、外す・確認があり、何個目かを書く", () => {
    const pages = roleRegistrationMessages({ teams: teams(MAX_ROLE_TEAM_BUTTONS + 3) });

    expect(pages).toHaveLength(2);
    expect(teamButtons(pages[0]!.components).map((button) => button.label)).toEqual(teams(MAX_ROLE_TEAM_BUTTONS).map((team) => team.name));
    expect(teamButtons(pages[1]!.components).map((button) => button.label)).toEqual(["チーム21", "チーム22", "チーム23"]);
    for (const page of pages) {
      expect(page.components).toHaveLength(page === pages[0] ? 5 : 2);
      expect(labels(page.components).at(-1)).toEqual(["今のロールを外す", "ロールを確認"]);
      expect(page.components.length).toBeLessThanOrEqual(5);
    }
    expect(pages[0]!.content).toContain("（1/2）");
    expect(pages[1]!.content).toContain("（2/2）");
    expect(pages[0]!.content).toContain("2 つのメッセージに分けています");
    expect(pages[1]!.content).toContain("2 つのメッセージに分けています");
    const ids = pages.flatMap((page) => teamButtons(page.components).map((button) => button.custom_id));
    expect(ids).toEqual(teams(MAX_ROLE_TEAM_BUTTONS + 3).map((team) => roleSetId(team.id)));
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of pages) for (const row of page.components) expect(row.components.length).toBeLessThanOrEqual(5);
  });

  it("40 チームは 2 メッセージ、41 チームは 3 メッセージ", () => {
    expect(roleRegistrationMessages({ teams: teams(40) })).toHaveLength(2);
    expect(roleRegistrationMessages({ teams: teams(41) })).toHaveLength(3);
    expect(teamButtons(roleRegistrationMessages({ teams: teams(41) })[2]!.components)).toHaveLength(1);
  });

  it("長いロール名は、ボタンのラベルの上限（80 文字）に収める", () => {
    const { components } = roleRegistrationMessages({ teams: [{ id: 1, name: "あ".repeat(100) }] })[0]!;

    expect(components[0]!.components[0]!.label).toHaveLength(80);
  });
});

describe("custom_id", () => {
  it("チームの ID を取り出せる。形が違えば null", () => {
    expect(parseRoleSetId(roleSetId(12))).toBe(12);
    for (const bad of ["role-set", "role-set:", "role-set:abc", "role-set:-1", "wait:2026-10-07:21", ""]) expect(parseRoleSetId(bad), bad).toBeNull();
  });
});
