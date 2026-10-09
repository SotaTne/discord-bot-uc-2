import { describe, expect, it } from "vitest";
import { CRON_INTERVAL_MINUTES, TARGETS, secretPropertyOf } from "./config";
import { buildRequests, describeResponse } from "./requests";

const staging = TARGETS[0]!;

describe("buildRequests", () => {
  it("合言葉があるところだけ、Bearer を付けた POST を作る。ないところは、missing に入れる", () => {
    const { requests, missing } = buildRequests(TARGETS, (property) => (property === secretPropertyOf(staging) ? "s3cret" : null));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: staging.url, options: { method: "post", headers: { Authorization: "Bearer s3cret" }, muteHttpExceptions: true } });
    expect(missing.map((target) => target.name)).toEqual(["production"]);
  });

  it("空の合言葉は、ないものとして扱う", () => {
    expect(buildRequests(TARGETS, () => "").requests).toEqual([]);
  });
});

describe("config", () => {
  it("URL は、https の /cron で終わる。名前は重ならない（合言葉のプロパティの名前が、名前から決まるため）", () => {
    for (const target of TARGETS) expect(new URL(target.url)).toMatchObject({ protocol: "https:", pathname: "/cron" });
    expect(new Set(TARGETS.map((target) => target.name)).size).toBe(TARGETS.length);
  });

  it("合言葉のプロパティの名前は、名前を大文字にして決まる", () => {
    expect(secretPropertyOf(staging)).toBe("CRON_SECRET_STAGING");
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
