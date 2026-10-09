import { fixedClock } from "@uc/core";
import { afterEach, describe, expect, it } from "vitest";
import { devClock, getDevClockState, parseDevClockState, setDevClockState } from "./clock";
import { jst } from "../test-helpers";

afterEach(() => setDevClockState({ offsetMs: 0 }));

describe("devClock（開発専用の疑似時計）", () => {
  const base = fixedClock(jst("2026-10-07T12:00:00"));

  it("最初は、本物の時計そのもの（ずれ 0）", () => {
    expect(devClock(base).now()).toEqual(jst("2026-10-07T12:00:00"));
  });

  it("本物の時刻 + ずれ。本物の時計が進めば、同じだけ進む（固定はしない）", () => {
    setDevClockState({ offsetMs: 3_600_000 });
    expect(devClock(base).now()).toEqual(jst("2026-10-07T13:00:00"));

    let real = jst("2026-10-07T12:00:00").getTime();
    const moving = devClock({ now: () => new Date(real) });
    real += 60_000;
    expect(moving.now()).toEqual(jst("2026-10-07T13:01:00"));
    expect(getDevClockState()).toEqual({ offsetMs: 3_600_000 });
  });

  it("ずれは、負でもよい（時計を戻す）", () => {
    setDevClockState({ offsetMs: -9 * 3_600_000 });

    expect(devClock(base).now()).toEqual(jst("2026-10-07T03:00:00"));
  });
});

describe("parseDevClockState", () => {
  it("offsetMs が有限の数のときだけ受ける", () => {
    expect(parseDevClockState({ offsetMs: -5 })).toEqual({ offsetMs: -5 });
    for (const bad of [null, undefined, "x", {}, { offsetMs: "1" }, { offsetMs: Infinity }, { offsetMs: Number.NaN }, { mode: "paused", at: 1 }]) {
      expect(parseDevClockState(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
