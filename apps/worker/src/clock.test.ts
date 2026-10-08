import { fixedClock } from "@uc/core";
import { describe, expect, it } from "vitest";
import { resolveClock } from "./clock";

const base = fixedClock("2026-10-07T00:00:00Z");

describe("resolveClock", () => {
  it("疑似時計が有効で、日時が正しければ、その日時に固定する", () => {
    const clock = resolveClock(base, { DEV_CLOCK: "true" }, "2026-10-07T20:53:00+09:00");
    expect(clock.now().toISOString()).toBe("2026-10-07T11:53:00.000Z");
  });

  it("疑似時計が無効なら、ヘッダーがあっても無視する（本番の挙動）", () => {
    expect(resolveClock(base, {}, "2026-10-07T20:53:00+09:00")).toBe(base);
    expect(resolveClock(base, { DEV_CLOCK: "false" }, "2026-10-07T20:53:00+09:00")).toBe(base);
    expect(resolveClock(base, { DEV_CLOCK: "1" }, "2026-10-07T20:53:00+09:00")).toBe(base);
  });

  it("ヘッダーがない・日時として読めないときは、元の時計を使う", () => {
    expect(resolveClock(base, { DEV_CLOCK: "true" }, null)).toBe(base);
    expect(resolveClock(base, { DEV_CLOCK: "true" }, "")).toBe(base);
    expect(resolveClock(base, { DEV_CLOCK: "true" }, "not a date")).toBe(base);
  });
});
