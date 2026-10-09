import { describe, expect, it } from "vitest";
import { CRON_INTERVAL_MINUTES, TARGETS } from "./config";
import { buildRequests, describeResponse } from "./requests";

const staging = TARGETS[0]!;

describe("buildRequests", () => {
  it("呼ぶ先ごとに、同じ合言葉の Bearer を付けた POST を作る", () => {
    const requests = buildRequests(TARGETS, "s3cret");

    expect(requests?.map((request) => request.url)).toEqual(TARGETS.map((target) => target.url));
    for (const request of requests ?? []) {
      expect(request.options).toEqual({ method: "post", headers: { Authorization: "Bearer s3cret" }, muteHttpExceptions: true });
    }
  });

  it("合言葉がない（未設定・空）ときは、何も作らない", () => {
    expect(buildRequests(TARGETS, null)).toBeNull();
    expect(buildRequests(TARGETS, "")).toBeNull();
  });
});

describe("config", () => {
  it("URL は、https の /cron で終わる。名前は重ならない", () => {
    for (const target of TARGETS) expect(new URL(target.url)).toMatchObject({ protocol: "https:", pathname: "/cron" });
    expect(new Set(TARGETS.map((target) => target.name)).size).toBe(TARGETS.length);
  });

  it("間隔は、Apps Script の時間トリガーが使える値（1・5・10・15・30 分）", () => {
    expect([1, 5, 10, 15, 30]).toContain(CRON_INTERVAL_MINUTES);
  });
});

describe("describeResponse", () => {
  it("受け付けた（202）ときは、null（毎分の、いつもの応答。ログを増やさない）", () => {
    expect(describeResponse(staging, 202, '{"accepted":true}')).toBeNull();
  });
  it("それ以外は、必ず出す（合言葉の間違い・Worker の不調など）", () => {
    expect(describeResponse(staging, 401, '{"error":"unauthorized"}')).toBe('staging: 失敗 (HTTP 401) {"error":"unauthorized"}');
    expect(describeResponse(staging, 200, "<html>")).toContain("HTTP 200");
  });
});
