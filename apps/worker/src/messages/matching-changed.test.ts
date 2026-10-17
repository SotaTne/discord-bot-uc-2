import type { Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { matchingChangedMessage } from "./matching";

const team = (id: number): Team => ({ id, guildId: "g", roleId: `role${id}`, createdAt: 1, deletedAt: null });
const teamById = new Map([1, 2, 3].map((id) => [id, team(id)]));

describe("matchingChangedMessage（組分けの変更の投稿）", () => {
  it("追加: 何試合目と主催を添える（マッチング結果と同じ書き方）", () => {
    const text = matchingChangedMessage({
      hour: 21,
      change: { kind: "added", teamAId: 1, teamBId: 2, hostId: 2, numberA: 3, numberB: 5 },
      teamById,
    });

    expect(text).toBe("## 21時の組分けが変更されました\n- 追加: <@&role1>（3試合目） vs <@&role2>（5試合目）・主催: <@&role2>");
  });

  it("追加: 規定数を超える試合には、「規定数超過」を添える。ちょうど規定数は、添えない", () => {
    const post = (matchLimit: number | null) =>
      matchingChangedMessage({ hour: 21, change: { kind: "added", teamAId: 1, teamBId: 2, hostId: 1, numberA: 3, numberB: 5 }, matchLimit, teamById }).split("\n")[1];

    expect(post(4)).toBe("- 追加: <@&role1>（3試合目） vs <@&role2>（5試合目・規定数超過）・主催: <@&role1>");
    expect(post(5)).toBe("- 追加: <@&role1>（3試合目） vs <@&role2>（5試合目）・主催: <@&role1>");
    expect(post(null)).toBe("- 追加: <@&role1>（3試合目） vs <@&role2>（5試合目）・主催: <@&role1>");
  });

  it("削除: 削除された組分けの 2 チームを出す", () => {
    const text = matchingChangedMessage({ hour: 22, change: { kind: "removed", teamAId: 1, teamBId: 3 }, teamById });

    expect(text).toBe("## 22時の組分けが変更されました\n- 削除: <@&role1> vs <@&role3>");
  });

  it("何試合目が分からないチームは、メンションだけ出す", () => {
    const text = matchingChangedMessage({ hour: 21, change: { kind: "added", teamAId: 1, teamBId: 2, hostId: 1, numberA: undefined, numberB: undefined }, teamById });

    expect(text).toContain("- 追加: <@&role1> vs <@&role2>・主催: <@&role1>");
  });
});
