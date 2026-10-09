import { describe, expect, it } from "vitest";
import { CRON_INTERVAL_MINUTES, TARGETS } from "./config";

describe("config", () => {
  it("URL は、https の /cron で終わる。名前は重ならない", () => {
    for (const target of TARGETS) expect(new URL(target.url)).toMatchObject({ protocol: "https:", pathname: "/cron" });
    expect(new Set(TARGETS.map((target) => target.name)).size).toBe(TARGETS.length);
  });

  it("間隔は、Apps Script の時間トリガーが使える値（1・5・10・15・30 分）", () => {
    expect([1, 5, 10, 15, 30]).toContain(CRON_INTERVAL_MINUTES);
  });
});
