import { describe, expect, it } from "vitest";
import { hostTeamOf } from "./matching";

describe("hostTeamOf", () => {
  const base = { slotDate: "2026-10-07", slotHour: 21 };

  it("2 チームのどちらかを返す。同じ入力なら、何度でも同じ。2 チームの順番には、よらない", () => {
    const host = hostTeamOf({ ...base, teamAId: 3, teamBId: 7 });

    expect([3, 7]).toContain(host);
    expect(hostTeamOf({ ...base, teamAId: 3, teamBId: 7 })).toBe(host);
    expect(hostTeamOf({ ...base, teamAId: 7, teamBId: 3 })).toBe(host);
  });

  it("組分けによって、主催がばらける（片方の ID ばかりにならない）", () => {
    const hosts = Array.from({ length: 40 }, (_, day) =>
      hostTeamOf({ slotDate: `2026-10-${String((day % 28) + 1).padStart(2, "0")}`, slotHour: 20 + (day % 4), teamAId: 1, teamBId: 2 }),
    );

    expect(new Set(hosts)).toEqual(new Set([1, 2]));
  });
});
