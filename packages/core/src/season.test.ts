import { describe, expect, it } from "vitest";
import { dateInSeason, seasonAccess, seasonClosedMessage, type SeasonWindow } from "./season";

const open: SeasonWindow = { start: null, end: null };
const season: SeasonWindow = { start: "2026-10-08", end: "2026-10-10" };

describe("seasonAccess", () => {
  it("期間が空なら、いつでも play", () => {
    expect(seasonAccess("2026-10-07", "2026-10-07", open)).toBe("play");
    expect(seasonAccess("2026-10-01", "2026-12-31", open)).toBe("play");
  });

  it("開始日と終了日は、どちらも play。その前日と翌日は、closed", () => {
    expect(seasonAccess("2026-10-08", "2026-10-08", season)).toBe("play");
    expect(seasonAccess("2026-10-09", "2026-10-09", season)).toBe("play");
    expect(seasonAccess("2026-10-10", "2026-10-10", season)).toBe("play");
    expect(seasonAccess("2026-10-07", "2026-10-07", season)).toBe("closed");
    expect(seasonAccess("2026-10-11", "2026-10-11", season)).toBe("closed");
  });

  it("開始より前の今日は、期間内の日を見ても closed（その日が来たことには、ならない）", () => {
    expect(seasonAccess("2026-10-07", "2026-10-08", season)).toBe("closed");
    expect(seasonAccess("2026-10-07", "2026-10-10", season)).toBe("closed");
    // 未来の日どうしで見ると play になる。開催日の判定には、使わない
    expect(seasonAccess("2026-10-08", "2026-10-08", season)).toBe("play");
  });

  it("終わったあとの今日は、期間に入っていた日だけ repair。期間の外の日は closed", () => {
    expect(seasonAccess("2026-10-11", "2026-10-08", season)).toBe("repair");
    expect(seasonAccess("2026-10-11", "2026-10-10", season)).toBe("repair");
    expect(seasonAccess("2026-10-11", "2026-10-07", season)).toBe("closed");
    expect(seasonAccess("2026-10-11", "2026-10-11", season)).toBe("closed");
  });

  it("期間のあいだの今日でも、期間の外の日は closed", () => {
    expect(seasonAccess("2026-10-09", "2026-10-07", season)).toBe("closed");
    expect(seasonAccess("2026-10-09", "2026-10-11", season)).toBe("closed");
    expect(seasonAccess("2026-10-09", "2026-10-09", season)).toBe("play");
  });

  it("開始と終了の片方だけ空なら、closed", () => {
    expect(seasonAccess("2026-10-08", "2026-10-08", { start: "2026-10-08", end: null })).toBe("closed");
    expect(seasonAccess("2026-10-08", "2026-10-08", { start: null, end: "2026-10-08" })).toBe("closed");
  });
});

describe("dateInSeason", () => {
  it("期間が空なら、どの日も入っている。開始日と終了日は、入っている", () => {
    expect(dateInSeason("2026-01-01", open)).toBe(true);
    expect(dateInSeason("2026-10-08", season)).toBe(true);
    expect(dateInSeason("2026-10-10", season)).toBe(true);
    expect(dateInSeason("2026-10-07", season)).toBe(false);
    expect(dateInSeason("2026-10-11", season)).toBe(false);
  });

  it("今日が期間の前でも、期間内の日は入っている（開催日かどうかとは、別）", () => {
    expect(dateInSeason("2026-10-08", season)).toBe(true);
    expect(seasonAccess("2026-10-07", "2026-10-08", season)).toBe("closed");
  });

  it("片方だけ空なら、入っていない", () => {
    expect(dateInSeason("2026-10-08", { start: "2026-10-08", end: null })).toBe(false);
  });
});

describe("seasonClosedMessage", () => {
  it("範囲があれば、開始と終了を添える。なければ、期間外であることだけを返す", () => {
    expect(seasonClosedMessage(season)).toBe("いまは大会の期間外です（2026-10-08〜2026-10-10）");
    expect(seasonClosedMessage(open)).toBe("いまは大会の期間外です");
    expect(seasonClosedMessage({ start: "2026-10-08", end: null })).toBe("いまは大会の期間外です");
  });
});
