import { describe, expect, it } from "vitest";
import { buildRequests, describeResponse, formatControlResult, handleControl, healthUrl, isAuthorizedKey, runTick, type ControlDeps, type Send, type Target } from "./index";

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

describe("isAuthorizedKey（ウェブアプリの合言葉の確認）", () => {
  it("同じ合言葉だけ、true", () => {
    expect(isAuthorizedKey("s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedKey("s3cre", "s3cret")).toBe(false);
    expect(isAuthorizedKey("s3cretX", "s3cret")).toBe(false);
    expect(isAuthorizedKey("S3CRET", "s3cret")).toBe(false);
  });

  it("合言葉が未設定（null・空）なら、何を送られても false。送られていないときも false", () => {
    expect(isAuthorizedKey("", "")).toBe(false);
    expect(isAuthorizedKey("x", null)).toBe(false);
    expect(isAuthorizedKey("x", undefined)).toBe(false);
    expect(isAuthorizedKey(undefined, "s3cret")).toBe(false);
  });
});

describe("handleControl（start・stop・health）", () => {
  const make = (overrides: Partial<ControlDeps> = {}) => {
    const calls: string[] = [];
    let triggers = 0;
    const deps: ControlDeps = {
      expectedKey: "s3cret",
      intervalMinutes: 1,
      installTrigger: () => ((triggers = 1), void calls.push("install")),
      removeTrigger: () => ((triggers = 0), void calls.push("remove")),
      countTriggers: () => triggers,
      checkTargets: () => [{ name: "staging", status: "200" }],
      ...overrides,
    };
    return { deps, calls };
  };

  it("start はトリガーを作り、stop は消す。どちらも、そのあとの状態を返す。health は、何も変えない", () => {
    const { deps, calls } = make();

    expect(handleControl({ key: "s3cret", action: "health" }, deps)).toMatchObject({ ok: true, running: false });
    expect(handleControl({ key: "s3cret", action: "start" }, deps)).toEqual({
      ok: true,
      action: "start",
      running: true,
      intervalMinutes: 1,
      targets: [{ name: "staging", status: "200" }],
    });
    expect(handleControl({ key: "s3cret", action: "health" }, deps)).toMatchObject({ running: true });
    expect(handleControl({ key: "s3cret", action: "stop" }, deps)).toMatchObject({ running: false });
    expect(calls).toEqual(["install", "remove"]);
  });

  it("合言葉が違う・ない・未設定なら、何も実行しない", () => {
    const { deps, calls } = make();
    expect(handleControl({ key: "wrong", action: "start" }, deps)).toEqual({ ok: false, error: "unauthorized" });
    expect(handleControl({ action: "start" }, deps)).toEqual({ ok: false, error: "unauthorized" });
    expect(handleControl({ key: "x", action: "start" }, make({ expectedKey: null }).deps)).toEqual({ ok: false, error: "unauthorized" });
    expect(calls).toEqual([]);
  });

  it("知らない操作は、断る（合言葉が合っていても、何も実行しない）", () => {
    const { deps, calls } = make();
    expect(handleControl({ key: "s3cret", action: "delete" }, deps)).toEqual({ ok: false, error: "unknown action: delete" });
    expect(calls).toEqual([]);
  });
});

describe("healthUrl・formatControlResult", () => {
  it("呼ぶ先の URL から、Worker の死活確認の URL を作る", () => {
    expect(healthUrl({ name: "x", url: "https://uc-bot.example.workers.dev/cron" })).toBe("https://uc-bot.example.workers.dev/api/health");
  });

  it("端末に出す行にする", () => {
    expect(formatControlResult({ ok: true, action: "health", running: true, intervalMinutes: 1, targets: [{ name: "staging", status: "200" }] })).toEqual([
      "cron: 動いています（1 分おき）",
      "  staging: 200",
    ]);
    expect(formatControlResult({ ok: true, action: "stop", running: false, intervalMinutes: 1, targets: [] })[0]).toBe("cron: 止まっています");
    expect(formatControlResult({ ok: false, error: "unauthorized" })).toEqual(["失敗: unauthorized"]);
  });
});
