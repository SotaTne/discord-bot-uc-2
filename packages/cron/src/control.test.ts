import { describe, expect, it } from "vitest";
import { COMMAND_ACTIONS, MIN_SECRET_LENGTH, formatControlResult, handleControl, type ControlDeps } from "./control";

describe("handleControl（start・stop・health）", () => {
  const make = (overrides: Partial<ControlDeps> = {}) => {
    const calls: string[] = [];
    let triggers = 0;
    const deps: ControlDeps = {
      expectedKey: "s3cret",
      intervalMinutes: 1,
      setSecret: (key) => void calls.push(`secret:${key}`),
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

describe("handleControl: set-secret（合言葉の取り替え）", () => {
  const next = "n".repeat(MIN_SECRET_LENGTH);
  const make = () => {
    const secrets: string[] = [];
    const deps: ControlDeps = {
      expectedKey: "old-secret",
      intervalMinutes: 1,
      setSecret: (key) => void secrets.push(key),
      installTrigger: () => undefined,
      removeTrigger: () => undefined,
      countTriggers: () => 1,
    };
    return { deps, secrets };
  };

  it("古い合言葉が合うときだけ、新しい合言葉に取り替える", () => {
    const { deps, secrets } = make();
    expect(handleControl({ key: "old-secret", action: "set-secret", newKey: next }, deps)).toMatchObject({ ok: true, action: "set-secret" });
    expect(secrets).toEqual([next]);

    expect(handleControl({ key: "wrong", action: "set-secret", newKey: next }, deps)).toEqual({ ok: false, error: "unauthorized" });
    expect(secrets).toEqual([next]);
  });

  it("新しい合言葉が、ない・短いときは、取り替えない", () => {
    const { deps, secrets } = make();
    expect(handleControl({ key: "old-secret", action: "set-secret" }, deps)).toMatchObject({ ok: false });
    expect(handleControl({ key: "old-secret", action: "set-secret", newKey: "short" }, deps)).toMatchObject({ ok: false });
    expect(secrets).toEqual([]);
  });

  it("手元のコマンド（start・stop・health）の対象に、set-secret は、入らない", () => {
    expect(COMMAND_ACTIONS).toEqual(["start", "stop", "health"]);
  });
});

describe("formatControlResult", () => {
  it("端末に出す行にする", () => {
    expect(formatControlResult({ ok: true, action: "health", running: true, intervalMinutes: 1 })).toEqual(["cron: 動いています（1 分おき）"]);
    expect(formatControlResult({ ok: true, action: "stop", running: false, intervalMinutes: 1 })).toEqual(["cron: 止まっています"]);
    expect(formatControlResult({ ok: false, error: "unauthorized" })).toEqual(["失敗: unauthorized"]);
  });
});
