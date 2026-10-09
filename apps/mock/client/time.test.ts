import { describe, expect, it } from "vitest";
import { formatOffset } from "./time";

describe("formatOffset（本物の時刻からのずれ）", () => {
  it("進めた分は「+」、戻した分は「−」。日・時間・分を、0 は省いてつなぐ", () => {
    expect(formatOffset(8 * 3_600_000 + 12 * 60_000)).toBe("+8時間12分");
    expect(formatOffset(-(24 * 3_600_000 + 3 * 3_600_000))).toBe("−1日3時間");
    expect(formatOffset(86_400_000)).toBe("+1日");
    expect(formatOffset(5 * 60_000)).toBe("+5分");
    expect(formatOffset(2 * 86_400_000 + 5 * 60_000)).toBe("+2日5分");
  });

  it("1 分に満たなければ、空（ずれなし）。分に丸める", () => {
    expect(formatOffset(0)).toBe("");
    expect(formatOffset(20_000)).toBe("");
    expect(formatOffset(-20_000)).toBe("");
    expect(formatOffset(89_000)).toBe("+1分");
  });
});
