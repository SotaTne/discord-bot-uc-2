import type { Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { matchingMessage } from "./matching";

const team = (id: number): Team => ({ id, guildId: "g", roleId: `role${id}`, createdAt: 1, deletedAt: null });
/** 主催は、常に小さいほうの ID（保存した値を、渡す形のテスト用） */
const hostOf = (a: number, b: number) => Math.min(a, b);
/** 組分けの 1 行（主催つき） */
const line = (a: number, b: number) => `- <@&role${a}> vs <@&role${b}>（主催: <@&role${hostOf(a, b)}>）`;
const teamById = new Map([
  [1, team(1)],
  [2, team(2)],
  [3, team(3)],
  [4, team(4)],
]);

describe("matchingMessage", () => {
  it("組分けを、チームのロールのメンションで出す（ロールの名前で見え、通知もされる）", () => {
    const text = matchingMessage({ number: 1, hostOf, hour: 21, teamById, result: { kind: "matched", pairs: [[1, 2]], excluded: null } });
    expect(text).toBe(["## 第1試合 (時間:21時) の組分け:", line(1, 2)].join("\n"));
  });

  it("奇数で除外されたチームも、理由つきで出す", () => {
    const text = matchingMessage({ number: 2, hostOf, hour: 22, teamById, result: { kind: "matched", pairs: [[1, 2]], excluded: 3 } });
    expect(text.split("\n").slice(1)).toEqual([
      line(1, 2),
      "- <@&role3> は参加チーム数が奇数だったためマッチングしませんでした",
    ]);
  });

  it("挙手が足りないときは、その旨だけを出す（メンションなし）", () => {
    const text = matchingMessage({ number: 3, hostOf, hour: 23, teamById, result: { kind: "insufficient" } });
    expect(text).toBe("## 第3試合 (時間:23時)\n試合に参加するチームが十分ではありません");
    expect(text).not.toContain("<@&");
  });

  it("登録のない ID でも、壊れずに ID のまま出す", () => {
    const text = matchingMessage({ number: 1, hostOf, hour: 21, teamById: new Map(), result: { kind: "matched", pairs: [[9, 8]], excluded: null } });
    expect(text).toContain("- 9 vs 8（主催: ");
  });

  it("主催は、渡された値のとおりに出す（組分けごとに、決めて保存した値）", () => {
    const text = matchingMessage({
      number: 1,
      hour: 21,
      hostOf: (a, b) => Math.max(a, b),
      teamById,
      result: { kind: "matched", pairs: [[1, 2], [3, 4]], excluded: null },
    });

    expect(text.split("\n").slice(1)).toEqual([
      "- <@&role1> vs <@&role2>（主催: <@&role2>）",
      "- <@&role3> vs <@&role4>（主催: <@&role4>）",
    ]);
  });
});
