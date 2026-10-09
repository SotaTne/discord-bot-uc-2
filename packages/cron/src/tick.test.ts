import { describe, expect, it } from "vitest";
import { buildRequests, describeResponse, runTick, type Send, type Target } from "./index";

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

describe("runTick", () => {
  const accepted = { status: 202, body: '{"accepted":true}' };

  it("全部に送って、全部が受け付けられれば、ログの行は空", async () => {
    const sent: string[] = [];
    const send: Send = async (requests) => {
      sent.push(...requests.map((request) => `${request.url} ${request.options.headers.Authorization}`));
      return requests.map(() => accepted);
    };

    expect(await runTick({ targets, secret: "s3cret", send })).toEqual([]);
    expect(sent).toEqual(["https://stg.example/cron Bearer s3cret", "https://prod.example/cron Bearer s3cret"]);
  });

  it("失敗した先だけ、行に出す（ほかの先は、そのまま）", async () => {
    const send: Send = async () => [accepted, { status: 401, body: "no" }];
    expect(await runTick({ targets, secret: "s", send })).toEqual(["production: 失敗 (HTTP 401) no"]);
  });

  it("合言葉がなければ、送らずに、知らせる", async () => {
    let called = false;
    const send: Send = async () => ((called = true), []);
    expect(await runTick({ targets, secret: null, send })).toEqual(["合言葉（CRON_SECRET）が、設定されていません"]);
    expect(called).toBe(false);
  });

  it("通信そのものが失敗しても、例外にせず、行に出す", async () => {
    const send: Send = async () => {
      throw new Error("DNS");
    };
    expect(await runTick({ targets, secret: "s", send })).toEqual(["呼べませんでした Error: DNS"]);
  });
});
