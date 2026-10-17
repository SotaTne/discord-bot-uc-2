import { describe, expect, it } from "vitest";
import { matchNumberKey, matchNumbers } from "./match-number";

const match = (id: number, slotDate: string, slotHour: number, teamAId: number, teamBId: number) => ({ id, slotDate, slotHour, teamAId, teamBId });

describe("matchNumbers（チームごとの、何試合目か）", () => {
  it("そのチームが入った組分けを、日付・時刻の順に、1 から数える", () => {
    const numbers = matchNumbers([
      match(1, "2026-10-06", 21, 1, 2),
      match(2, "2026-10-07", 21, 1, 3),
      match(3, "2026-10-07", 22, 2, 3),
    ]);

    expect(numbers.get(matchNumberKey(1, 1))).toBe(1);
    expect(numbers.get(matchNumberKey(2, 1))).toBe(1);
    expect(numbers.get(matchNumberKey(1, 2))).toBe(2);
    expect(numbers.get(matchNumberKey(3, 2))).toBe(1);
    expect(numbers.get(matchNumberKey(2, 3))).toBe(2);
    expect(numbers.get(matchNumberKey(3, 3))).toBe(2);
  });

  it("ID の順や、渡す順番に、よらない。同じ対戦枠の中は、ID の順", () => {
    const numbers = matchNumbers([match(9, "2026-10-07", 21, 1, 2), match(2, "2026-10-06", 23, 1, 3), match(5, "2026-10-07", 21, 1, 4)]);

    expect(numbers.get(matchNumberKey(1, 2))).toBe(1);
    expect(numbers.get(matchNumberKey(1, 5))).toBe(2);
    expect(numbers.get(matchNumberKey(1, 9))).toBe(3);
  });

  it("組分けがなければ、空", () => {
    expect(matchNumbers([]).size).toBe(0);
  });
});
