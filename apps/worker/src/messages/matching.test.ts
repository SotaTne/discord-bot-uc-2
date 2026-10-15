import type { Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { matchingMessage } from "./matching";

const team = (id: number): Team => ({ id, guildId: "g", roleId: `role${id}`, createdAt: 1, deletedAt: null });
/** 主催は、常に小さいほうの ID（保存した値を、渡す形のテスト用） */
const hostOf = (a: number, b: number) => Math.min(a, b);
/** 各チームの何試合目か（テスト用: チーム ID × 10 試合目。分かりやすいように） */
const numberOf = (teamId: number) => teamId * 10;
const teamById = new Map([
  [1, team(1)],
  [2, team(2)],
  [3, team(3)],
  [4, team(4)],
]);

const base = { hostOf, numberOf, teamById };

describe("matchingMessage", () => {
  it("組分けを、チームのロールのメンションで出す。各チームが何試合目かと、主催も添える", () => {
    const text = matchingMessage({ ...base, hour: 21, result: { kind: "matched", pairs: [[1, 2]], excluded: null } });

    expect(text).toBe(["## 試合 (時間:21時) の組分け:", "- <@&role1>（10試合目） vs <@&role2>（20試合目）・主催: <@&role1>"].join("\n"));
  });

  it("2 チームそれぞれの、何試合目かが、別々に出る（組分けごと）", () => {
    const text = matchingMessage({
      ...base,
      hour: 21,
      numberOf: (teamId) => ({ 1: 3, 2: 5, 3: 1, 4: 1 })[teamId],
      result: { kind: "matched", pairs: [[1, 2], [3, 4]], excluded: null },
    });

    expect(text.split("\n").slice(1)).toEqual([
      "- <@&role1>（3試合目） vs <@&role2>（5試合目）・主催: <@&role1>",
      "- <@&role3>（1試合目） vs <@&role4>（1試合目）・主催: <@&role3>",
    ]);
  });

  it("奇数で除外されたチームも、理由つきで出す（除外されたチームに、試合目は付かない）", () => {
    const text = matchingMessage({ ...base, hour: 22, result: { kind: "matched", pairs: [[1, 2]], excluded: 3 } });

    expect(text.split("\n").slice(1)).toEqual([
      "- <@&role1>（10試合目） vs <@&role2>（20試合目）・主催: <@&role1>",
      "- <@&role3> は参加チーム数が奇数だったためマッチングしませんでした",
    ]);
  });

  it("挙手が足りないときは、その旨だけを出す（メンションなし）", () => {
    const text = matchingMessage({ ...base, hour: 23, result: { kind: "insufficient" } });

    expect(text).toBe("## 試合 (時間:23時)\n試合に参加するチームが十分ではありません");
    expect(text).not.toContain("<@&");
  });

  it("登録のない ID でも、壊れずに ID のまま出す。何試合目か分からなければ、付けない", () => {
    const text = matchingMessage({
      ...base,
      numberOf: () => undefined,
      hour: 21,
      teamById: new Map(),
      result: { kind: "matched", pairs: [[9, 8]], excluded: null },
    });

    expect(text).toContain("- 9 vs 8・主催: ");
  });

  it("主催は、渡された値のとおりに出す（組分けごとに、決めて保存した値）", () => {
    const text = matchingMessage({
      ...base,
      hour: 21,
      hostOf: (a, b) => Math.max(a, b),
      result: { kind: "matched", pairs: [[1, 2], [3, 4]], excluded: null },
    });

    expect(text.split("\n").slice(1).map((line) => line.split("・主催: ")[1])).toEqual(["<@&role2>", "<@&role4>"]);
  });
});
