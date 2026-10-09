import type { Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { GUILD_ID } from "../test-helpers";
import { formatScoreboard } from "./scoreboard";

const team = (id: number): Team => ({ id, guildId: GUILD_ID, roleId: `r${id}`, createdAt: 1, deletedAt: null });
const score = (teamId: number, total: number, wins: number) =>
  [teamId, { teamId, total, wins: Array.from({ length: wins }, () => ({}) as never) }] as const;

describe("formatScoreboard", () => {
  it("得点の高い順に並べ、同点は同じ順位にする（1位, 1位, 3位）。試合数も出す", () => {
    const text = formatScoreboard(
      [team(1), team(2), team(3)],
      new Map([score(1, 250, 3), score(2, 250, 2), score(3, 400, 5)]),
      undefined,
      new Map([[1, 4], [2, 3], [3, 5]]),
    );
    expect(text).toBe(
      ["# チームの得点", "1位 <@&r3> 400pt（5試合・5勝）", "2位 <@&r1> 250pt（4試合・3勝）", "2位 <@&r2> 250pt（3試合・2勝）"].join("\n"),
    );
  });

  it("勝利のないチームは、0pt として最後に並べる（同点は登録順）。試合数が分からないときは、0試合", () => {
    const text = formatScoreboard([team(1), team(2), team(3)], new Map([score(3, 100, 1)]));
    expect(text.split("\n").slice(1)).toEqual(["1位 <@&r3> 100pt（0試合・1勝）", "2位 <@&r1> 0pt（0試合・0勝）", "2位 <@&r2> 0pt（0試合・0勝）"]);
  });

  it("試合数（対戦した組分けの数）が N（既定 5）を超えたチームにだけ、「試合数○を超過しました」を出す。勝ち負けには、関係しない。N と固定点は、設定に従う", () => {
    const teams = [team(1), team(2)];
    // 2 は、6 試合して、1 勝だけ（負けても、試合数は、超えている）
    const scores = new Map([score(1, 150, 5), score(2, 100, 1)]);
    const counts = new Map([[1, 5], [2, 6]]);

    const text = formatScoreboard(teams, scores, undefined, counts);
    expect(text).toContain("<@&r1> 150pt（5試合・5勝）");
    expect(text).toContain("<@&r2> 100pt（6試合・1勝・試合数5を超過しました）");
    expect(formatScoreboard(teams, scores, { fixedAfterMatches: 4, fixedPoints: 80 }, counts)).toContain("<@&r1> 150pt（5試合・5勝・試合数4を超過しました）");
  });

  it("チームが登録されていなければ、その旨を返す", () => {
    expect(formatScoreboard([], new Map())).toBe("チームが登録されていません");
  });
});
