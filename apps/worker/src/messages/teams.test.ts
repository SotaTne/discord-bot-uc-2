import type { Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { formatTeamCounts } from "./teams";

const team = (id: number, roleId: string): Team => ({ id, guildId: "g", roleId, createdAt: 1, deletedAt: null });

describe("formatTeamCounts（/uc-teams の文面）", () => {
  it("規定数があれば、見出しに書き、超過したチームの行にだけ「規定数を超えています」と付ける。ちょうど規定数は、超過ではなく、次の試合で超えることを知らせる。余裕があれば、何も付けない", () => {
    const text = formatTeamCounts([
      { team: team(1, "r1"), count: 6, limit: 5, over: true },
      { team: team(2, "r2"), count: 5, limit: 5, over: false },
    ]);

    expect(text).toBe(
      ["チームごとの試合数（規定数: 5試合）", "<@&r1>  6試合（次は 7試合目）　規定数を超えています", "<@&r2>  5試合（次は 6試合目）　次の試合で規定数を超えます"].join("\n"),
    );
    expect(formatTeamCounts([{ team: team(3, "r3"), count: 4, limit: 5, over: false }])).not.toContain("規定数を超え");
  });


  it("チームごとに、これまでの試合数と、次が何試合目かを、ロールのメンションで出す。先頭に見出し", () => {
    const text = formatTeamCounts([
      { team: team(1, "r1"), count: 4 },
      { team: team(2, "r2"), count: 3 },
      { team: team(3, "r3"), count: 0 },
    ]);

    expect(text).toBe(
      ["チームごとの試合数", "<@&r1>  4試合（次は 5試合目）", "<@&r2>  3試合（次は 4試合目）", "<@&r3>  0試合（次は 1試合目）"].join("\n"),
    );
  });

  it("渡された順に並べる（試合数の多い順・少ない順には、並べ替えない。順位に見せない）", () => {
    const text = formatTeamCounts([
      { team: team(1, "r1"), count: 0 },
      { team: team(2, "r2"), count: 9 },
      { team: team(3, "r3"), count: 5 },
    ]);

    expect(text.split("\n").slice(1).map((line) => line.split("  ")[0])).toEqual(["<@&r1>", "<@&r2>", "<@&r3>"]);
  });

  it("チームが登録されていなければ、その旨", () => {
    expect(formatTeamCounts([])).toBe("チームが登録されていません");
  });
});
