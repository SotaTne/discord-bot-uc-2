import { describe, expect, it } from "vitest";
import { CRON_INTERVAL_MINUTES, TARGETS, WEB_APP_DEPLOYMENT_ID } from "./config";

describe("config", () => {
  it("URL は、https の /cron で終わる。名前は重ならない", () => {
    for (const target of TARGETS) expect(new URL(target.url)).toMatchObject({ protocol: "https:", pathname: "/cron" });
    expect(new Set(TARGETS.map((target) => target.name)).size).toBe(TARGETS.length);
  });

  it("間隔は、Apps Script の時間トリガーが使える値（1・5・10・15・30 分）", () => {
    expect([1, 5, 10, 15, 30]).toContain(CRON_INTERVAL_MINUTES);
  });

  it("デプロイの ID は、空（まだ作っていない）か、AKfycb… の形（スクリプト ID や URL の取り違えを防ぐ）", () => {
    expect(WEB_APP_DEPLOYMENT_ID).toMatch(/^(AKfycb[\w-]+)?$/);
  });
});
