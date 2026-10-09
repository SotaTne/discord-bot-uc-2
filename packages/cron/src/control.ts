import { isAuthorizedKey } from "./auth";
import type { Target } from "./requests";

/** cron の操作。start: 毎分のトリガーを作る / stop: 止める / health: 状態を見る */
export const CONTROL_ACTIONS = ["start", "stop", "health"] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export const isControlAction = (value: unknown): value is ControlAction => CONTROL_ACTIONS.includes(value as ControlAction);

export type TargetHealth = { name: string; status: string };

export type ControlResult =
  | { ok: true; action: ControlAction; running: boolean; intervalMinutes: number; targets: TargetHealth[] }
  | { ok: false; error: string };

/** 操作に必要な、Apps Script の機能。Apps Script が、実物を渡す（テストでは、偽物） */
export type ControlDeps = {
  /** 本物の合言葉（スクリプトのプロパティ）。未設定なら、何を送られても、断る */
  expectedKey: string | null;
  intervalMinutes: number;
  installTrigger: () => void;
  removeTrigger: () => void;
  /** 毎分のトリガーの数 */
  countTriggers: () => number;
  /** 呼ぶ先の Worker が、応答するか */
  checkTargets: () => TargetHealth[];
};

/** ウェブアプリ（doPost）の処理の本体。合言葉と操作を確かめて、実行して、状態を返す */
export function handleControl(input: { key?: string | undefined; action?: string | undefined }, deps: ControlDeps): ControlResult {
  if (!isAuthorizedKey(input.key, deps.expectedKey)) return { ok: false, error: "unauthorized" };
  if (!isControlAction(input.action)) return { ok: false, error: `unknown action: ${input.action ?? ""}`.slice(0, 100) };

  if (input.action === "start") deps.installTrigger();
  if (input.action === "stop") deps.removeTrigger();
  return {
    ok: true,
    action: input.action,
    running: deps.countTriggers() > 0,
    intervalMinutes: deps.intervalMinutes,
    targets: deps.checkTargets(),
  };
}

/** Worker の、認証なしの死活確認（GET /api/health）の URL。呼ぶ先の URL（…/cron）から作る */
export function healthUrl(target: Target): string {
  return `${new URL(target.url).origin}/api/health`;
}

/** 結果を、端末に出す行にする */
export function formatControlResult(result: ControlResult): string[] {
  if (!result.ok) return [`失敗: ${result.error}`];
  const state = result.running ? `動いています（${result.intervalMinutes} 分おき）` : "止まっています";
  return [`cron: ${state}`, ...result.targets.map((target) => `  ${target.name}: ${target.status}`)];
}
