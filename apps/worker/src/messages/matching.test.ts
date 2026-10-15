import { hostTeamOf } from "@uc/core";
import type { Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { matchingMessage } from "./matching";

const team = (id: number): Team => ({ id, guildId: "g", roleId: `role${id}`, createdAt: 1, deletedAt: null });
const SLOT_DATE = "2026-10-07";
/** 組分けの 1 行（主催つき） */
const line = (a: number, b: number, hour: number) =>
  `- <@&role${a}> vs <@&role${b}>（主催: <@&role${hostTeamOf({ slotDate: SLOT_DATE, slotHour: hour, teamAId: a, teamBId: b })}>）`;
const teamById = new Map([
  [1, team(1)],
  [2, team(2)],
  [3, team(3)],
]);

describe("matchingMessage", () => {
  it("組分けを、チームのロールのメンションで出す（ロールの名前で見え、通知もされる）", () => {
    const text = matchingMessage({ slotDate: SLOT_DATE, hour: 21, teamById, result: { kind: "matched", pairs: [[1, 2]], excluded: null } });
    expect(text).toBe(["## 試合 (時間:21時) の組分け:", line(1, 2, 21)].join("\n"));
  });

  it("奇数で除外されたチームも、理由つきで出す", () => {
    const text = matchingMessage({ slotDate: SLOT_DATE, hour: 22, teamById, result: { kind: "matched", pairs: [[1, 2]], excluded: 3 } });
    expect(text.split("\n").slice(1)).toEqual([
      line(1, 2, 22),
      "- <@&role3> は参加チーム数が奇数だったためマッチングしませんでした",
    ]);
  });

  it("挙手が足りないときは、その旨だけを出す（メンションなし）", () => {
    const text = matchingMessage({ slotDate: SLOT_DATE, hour: 23, teamById, result: { kind: "insufficient" } });
    expect(text).toBe("## 試合 (時間:23時)\n試合に参加するチームが十分ではありません");
    expect(text).not.toContain("<@&");
  });

  it("登録のない ID でも、壊れずに ID のまま出す", () => {
    const text = matchingMessage({ slotDate: SLOT_DATE, hour: 21, teamById: new Map(), result: { kind: "matched", pairs: [[9, 8]], excluded: null } });
    expect(text).toContain("- 9 vs 8（主催: ");
  });

  it("主催は、組分けの 2 チームのどちらか。同じ組分けなら、何度投稿しても同じ", () => {
    const first = matchingMessage({ slotDate: SLOT_DATE, hour: 21, teamById, result: { kind: "matched", pairs: [[1, 2]], excluded: null } });
    const again = matchingMessage({ slotDate: SLOT_DATE, hour: 21, teamById, result: { kind: "matched", pairs: [[2, 1]], excluded: null } });

    expect(first).toMatch(/（主催: <@&role[12]>）/);
    // 2 チームの並びが逆でも、主催は同じ
    expect(again.match(/主催: (<@&role\d>)/)?.[1]).toBe(first.match(/主催: (<@&role\d>)/)?.[1]);
  });
});
