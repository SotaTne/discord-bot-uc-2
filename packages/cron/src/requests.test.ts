import { describe, expect, it } from "vitest";
import { buildRequests, describeResponse, type Target } from "./requests";

const targets: Target[] = [
  { name: "staging", url: "https://stg.example/cron" },
  { name: "production", url: "https://prod.example/cron" },
];

describe("buildRequests", () => {
  it("呼ぶ先ごとに、同じ合言葉の Bearer を付けた POST を作る", () => {
    const requests = buildRequests(targets, "s3cret");

    expect(requests?.map((request) => request.url)).toEqual(targets.map((target) => target.url));
    for (const request of requests ?? []) {
      expect(request.options).toEqual({ method: "post", headers: { Authorization: "Bearer s3cret" }, muteHttpExceptions: true });
    }
  });

  it("合言葉がない（未設定・空）ときは、何も作らない", () => {
    expect(buildRequests(targets, null)).toBeNull();
    expect(buildRequests(targets, "")).toBeNull();
  });
});

describe("describeResponse", () => {
  it("受け付けた（202）ときは、null（毎分の、いつもの応答。ログを増やさない）", () => {
    expect(describeResponse(targets[0]!, 202, '{"accepted":true}')).toBeNull();
  });
  it("それ以外は、必ず出す（合言葉の間違い・Worker の不調など）", () => {
    expect(describeResponse(targets[0]!, 401, '{"error":"unauthorized"}')).toBe('staging: 失敗 (HTTP 401) {"error":"unauthorized"}');
    expect(describeResponse(targets[0]!, 200, "<html>")).toContain("HTTP 200");
  });
});
