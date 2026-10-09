import type { Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { matchingMessage } from "./matching";
import { recruitMessage } from "./recruit";

const team = (id: number): Team => ({ id, guildId: "g", roleId: `role${id}`, createdAt: 1, deletedAt: null });
const teamById = new Map([
  [1, team(1)],
  [2, team(2)],
  [3, team(3)],
]);

describe("recruitMessage", () => {
  it("募集開始の時刻を入れる", () => {
    expect(recruitMessage(12)).toBe("# 12:00になりましたので、本日の募集を開始します");
  });
});

describe("matchingMessage", () => {
  it("組分けを、チームのロールのメンションで出す（ロールの名前で見え、通知もされる）", () => {
    const text = matchingMessage({ hour: 21, teamById, result: { kind: "matched", pairs: [[1, 2]], excluded: null } });
    expect(text).toBe(["## 試合 (時間:21時) の組分け:", "- <@&role1> vs <@&role2>"].join("\n"));
  });

  it("奇数で除外されたチームも、理由つきで出す", () => {
    const text = matchingMessage({ hour: 22, teamById, result: { kind: "matched", pairs: [[1, 2]], excluded: 3 } });
    expect(text.split("\n").slice(1)).toEqual([
      "- <@&role1> vs <@&role2>",
      "- <@&role3> は参加チーム数が奇数だったためマッチングしませんでした",
    ]);
  });

  it("挙手が足りないときは、その旨だけを出す（メンションなし）", () => {
    const text = matchingMessage({ hour: 23, teamById, result: { kind: "insufficient" } });
    expect(text).toBe("## 試合 (時間:23時)\n試合に参加するチームが十分ではありません");
    expect(text).not.toContain("<@&");
  });

  it("登録のない ID でも、壊れずに ID のまま出す", () => {
    const text = matchingMessage({ hour: 21, teamById: new Map(), result: { kind: "matched", pairs: [[9, 8]], excluded: null } });
    expect(text).toContain("- 9 vs 8");
  });
});
