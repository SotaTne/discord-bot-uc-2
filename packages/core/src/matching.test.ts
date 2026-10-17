import { describe, expect, it } from "vitest";
import { hostTeamOf, pairTeams, type HandupEntry } from "./matching";

const handup = (id: number, teamId: string, createdAt: number): HandupEntry<string> => ({
  id,
  teamId,
  createdAt,
});

describe("pairTeams", () => {
  it("挙手が2チーム未満なら成立しない", () => {
    expect(pairTeams([])).toEqual({ kind: "insufficient" });
    expect(pairTeams([handup(1, "A", 100)])).toEqual({ kind: "insufficient" });
  });

  it("偶数なら、挙手が早い順に隣同士を組む", () => {
    const result = pairTeams([
      handup(3, "C", 300),
      handup(1, "A", 100),
      handup(4, "D", 400),
      handup(2, "B", 200),
    ]);
    expect(result).toEqual({
      kind: "matched",
      pairs: [
        ["A", "B"],
        ["C", "D"],
      ],
      excluded: null,
    });
  });

  it("奇数なら、最後に挙手したチームを除外する", () => {
    const result = pairTeams([
      handup(1, "A", 100),
      handup(2, "B", 200),
      handup(3, "C", 300),
    ]);
    expect(result).toEqual({
      kind: "matched",
      pairs: [["A", "B"]],
      excluded: "C",
    });
  });

  it("同じ時刻なら ID の小さい方が先に挙手したものとして扱う", () => {
    const result = pairTeams([
      handup(2, "B", 100),
      handup(1, "A", 100),
      handup(3, "C", 100),
    ]);
    expect(result).toEqual({
      kind: "matched",
      pairs: [["A", "B"]],
      excluded: "C",
    });
  });

  it("入力の配列を書き換えない", () => {
    const input = [handup(2, "B", 200), handup(1, "A", 100)];
    pairTeams(input);
    expect(input.map((h) => h.teamId)).toEqual(["B", "A"]);
  });
});

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
