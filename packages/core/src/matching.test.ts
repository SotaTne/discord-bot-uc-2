import { describe, expect, it } from "vitest";
import { pairTeams, type HandupEntry } from "./matching";

const handup = (id: number, teamId: string, createdAt: number): HandupEntry => ({
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
