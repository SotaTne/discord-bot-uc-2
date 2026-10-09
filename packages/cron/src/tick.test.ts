import { describe, expect, it } from "vitest";
import type { Send, Target } from "./requests";
import { runTick } from "./tick";

const targets: Target[] = [
  { name: "staging", url: "https://stg.example/cron" },
  { name: "production", url: "https://prod.example/cron" },
];

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
