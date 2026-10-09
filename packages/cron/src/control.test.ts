import { describe, expect, it } from "vitest";
import { formatControlResult, handleControl, type ControlDeps } from "./control";

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

describe("formatControlResult", () => {
  it("端末に出す行にする", () => {
    expect(formatControlResult({ ok: true, action: "health", running: true, intervalMinutes: 1 })).toEqual(["cron: 動いています（1 分おき）"]);
    expect(formatControlResult({ ok: true, action: "stop", running: false, intervalMinutes: 1 })).toEqual(["cron: 止まっています"]);
    expect(formatControlResult({ ok: false, error: "unauthorized" })).toEqual(["失敗: unauthorized"]);
  });
});
