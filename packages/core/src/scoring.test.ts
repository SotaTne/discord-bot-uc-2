import { describe, expect, it } from "vitest";
import { calculateScores, matchNumbers, type PlayedMatch, type Win } from "./scoring";

let nextId = 0;
const resetIds = () => {
  nextId = 0;
};

/** A が出る、n 日目の 21 時の組分け（相手は、毎回、別のチーム） */
const matchOn = (day: number, teamIds: [string, string] = ["A", `X${day}`], slotHour = 21): PlayedMatch => ({
  id: day * 10 + slotHour,
  teamIds,
  slotDate: `2026-10-${String(day).padStart(2, "0")}`,
  slotHour,
});
const winIn = (match: PlayedMatch, teamId: string, points: number, active = true): Win => ({
  id: ++nextId,
  matchId: match.id,
  teamId,
  points,
  active,
});
/** A が、1 日目から n 日目まで、毎日試合をして、全部勝つ */
const season = (pointsList: number[]) => {
  const matches = pointsList.map((_, i) => matchOn(i + 1));
  return { matches, wins: pointsList.map((points, i) => winIn(matches[i]!, "A", points)) };
};

describe("matchNumbers（そのチームの、何試合目か）", () => {
  it("チームごとに、対戦枠の日付・時刻の順に、1 から数える（勝ち負けに関係なく。記録した順ではない）", () => {
    const late = matchOn(3, ["A", "B"]);
    const early = matchOn(1, ["A", "C"]);
    const sameDayEvening = matchOn(1, ["A", "D"], 23);

    const numbers = matchNumbers([late, early, sameDayEvening]);

    expect(numbers.get(`A#${early.id}`)).toBe(1);
    expect(numbers.get(`A#${sameDayEvening.id}`)).toBe(2);
    expect(numbers.get(`A#${late.id}`)).toBe(3);
    expect(numbers.get(`B#${late.id}`)).toBe(1);
  });

  it("同じ対戦枠の組分けは、ID の順", () => {
    const first = { ...matchOn(1, ["A", "B"]), id: 5 };
    const second = { ...matchOn(1, ["A", "C"]), id: 9 };

    const numbers = matchNumbers([second, first]);

    expect(numbers.get("A#5")).toBe(1);
    expect(numbers.get("A#9")).toBe(2);
  });
});

describe("calculateScores", () => {
  it("N（既定 5）試合目までは、勝つと生点をそのまま合計する", () => {
    resetIds();
    const { matches, wins } = season([10, 20, 30, 40, 50]);
    expect(calculateScores(wins, matches).get("A")?.total).toBe(150);
  });

  it("N を超えた試合（6 試合目から）は、勝っても、生点に関係なく固定点（100）", () => {
    resetIds();
    const { matches, wins } = season([10, 10, 10, 10, 10, 30, 999]);

    const score = calculateScores(wins, matches).get("A");

    expect(score?.wins.map((w) => w.points)).toEqual([10, 10, 10, 10, 10, 100, 100]);
    expect(score?.wins.map((w) => w.matchNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(score?.total).toBe(250);
  });

  it("負けた試合は、点が入らないが、試合数には数える（勝つのが遅くても、N を超える）", () => {
    resetIds();
    // 5 試合負けて、6 試合目に勝つ: 6 試合目なので、固定点
    const matches = [1, 2, 3, 4, 5, 6].map((day) => matchOn(day));
    const wins = [winIn(matches[5]!, "A", 30)];

    const score = calculateScores(wins, matches).get("A");

    expect(score?.wins).toMatchObject([{ matchNumber: 6, rawPoints: 30, points: 100 }]);
    expect(score?.total).toBe(100);
  });

  it("相手が勝った試合も、そのチームの試合数に数える（勝ったのは、相手）", () => {
    resetIds();
    const matches = [1, 2, 3, 4, 5].map((day) => matchOn(day, ["A", "B"]));
    const sixth = matchOn(6, ["A", "B"]);
    // A は 5 試合全部負けた。6 試合目は、B にとって 6 試合目 → 固定点
    const wins = [winIn(sixth, "B", 40)];

    const scores = calculateScores(wins, [...matches, sixth]);

    expect(scores.has("A")).toBe(false);
    expect(scores.get("B")?.wins[0]).toMatchObject({ matchNumber: 6, points: 100 });
  });

  it("チームごとに別々に数える", () => {
    resetIds();
    const a = season([1, 1, 1, 1, 1, 1]);
    const other = matchOn(1, ["B", "Y"]);

    const scores = calculateScores([...a.wins, winIn(other, "B", 7)], [...a.matches, other]);

    expect(scores.get("A")?.total).toBe(105);
    expect(scores.get("B")?.total).toBe(7);
  });

  it("規則を設定で変えられる", () => {
    resetIds();
    const { matches, wins } = season([10, 10, 10]);

    const score = calculateScores(wins, matches, { fixedAfterMatches: 2, fixedPoints: 50 }).get("A");

    expect(score?.wins.map((w) => w.points)).toEqual([10, 10, 50]);
  });

  it("勝利がなければ、空", () => {
    expect(calculateScores([], []).size).toBe(0);
  });

  describe("無効な記録（active = false）", () => {
    it("無効な勝利は、集計に入らない。試合数には、数える（組分けは、残るので）", () => {
      resetIds();
      const first = matchOn(1);
      const second = matchOn(2);

      const score = calculateScores([winIn(first, "A", 40, false), winIn(second, "A", 60)], [first, second]).get("A");

      expect(score?.total).toBe(60);
      expect(score?.wins).toMatchObject([{ matchNumber: 2 }]);
    });

    it("有効に戻すと、元どおりに数え直される", () => {
      resetIds();
      const { matches, wins } = season([10, 10, 10, 10, 10, 30]);
      const off = wins.map((w, index) => (index === 0 ? { ...w, active: false } : w));
      const back = off.map((w) => ({ ...w, active: true }));

      expect(calculateScores(back, matches)).toEqual(calculateScores(wins, matches));
      // 無効にしても、6 試合目は 6 試合目のまま（試合数は、組分けで決まる）
      expect(calculateScores(off, matches).get("A")?.wins.at(-1)).toMatchObject({ matchNumber: 6, points: 100 });
    });

    it("すべて無効なら、そのチームは結果に含まれない（呼び出し側は 0 点として扱う）", () => {
      resetIds();
      const match = matchOn(1);
      expect(calculateScores([winIn(match, "A", 40, false)], [match]).has("A")).toBe(false);
    });
  });

  it("組分けが見つからない勝利は、固定点の判定ができないので、生点で数える", () => {
    resetIds();
    const orphan: Win = { id: 1, matchId: 999, teamId: "A", points: 33, active: true };

    expect(calculateScores([orphan], []).get("A")?.total).toBe(33);
  });
});
