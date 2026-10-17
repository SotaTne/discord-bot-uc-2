import type { Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { formatTeamCounts } from "./teams";

const team = (id: number, roleId: string): Team => ({ id, guildId: "g", roleId, createdAt: 1, deletedAt: null });

describe("formatTeamCounts（/uc-teams の文面）", () => {
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
