import { isAuthorizedKey } from "./auth";

/**
 * cron の操作。start: 毎分のトリガーを作る / stop: 止める / health: Apps Script が動いているか（ウェブアプリが応答して、トリガーがあるか）を見る /
 * set-secret: 合言葉を、新しい値に取り替える（古い合言葉で認証する。`pnpm update-cron-secret` が使う）
 */
export const CONTROL_ACTIONS = ["start", "stop", "health", "set-secret"] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/** 手元から、`pnpm start` などで使う操作（set-secret は、update-cron-secret だけが使う） */
export const COMMAND_ACTIONS = CONTROL_ACTIONS.filter((action) => action !== "set-secret");

export const isCommandAction = (value: unknown): value is (typeof COMMAND_ACTIONS)[number] => (COMMAND_ACTIONS as readonly unknown[]).includes(value);

/** 新しい合言葉の、最低の長さ（短い・空の値に、取り替えられないように） */
export const MIN_SECRET_LENGTH = 32;

export const isControlAction = (value: unknown): value is ControlAction => CONTROL_ACTIONS.includes(value as ControlAction);

export type ControlResult =
  | { ok: true; action: ControlAction; running: boolean; intervalMinutes: number }
  | { ok: false; error: string };

/** 操作に必要な、Apps Script の機能。Apps Script が、実物を渡す（テストでは、偽物） */
export type ControlDeps = {
  /** 本物の合言葉（スクリプトのプロパティ）。未設定なら、何を送られても、断る */
  expectedKey: string | null;
  intervalMinutes: number;
  installTrigger: () => void;
  removeTrigger: () => void;
  /** 合言葉（スクリプトのプロパティ）を、書き換える */
  setSecret: (key: string) => void;
  /** 毎分のトリガーの数 */
  countTriggers: () => number;
};

/** ウェブアプリ（doPost）の処理の本体。合言葉と操作を確かめて、実行して、状態を返す */
export function handleControl(input: { key?: string | undefined; action?: string | undefined; newKey?: string | undefined }, deps: ControlDeps): ControlResult {
  if (!isAuthorizedKey(input.key, deps.expectedKey)) return { ok: false, error: "unauthorized" };
  if (!isControlAction(input.action)) return { ok: false, error: `unknown action: ${input.action ?? ""}`.slice(0, 100) };

  if (input.action === "set-secret") {
    if (!input.newKey || input.newKey.length < MIN_SECRET_LENGTH) return { ok: false, error: `invalid new key (${MIN_SECRET_LENGTH} 文字以上)` };
    deps.setSecret(input.newKey);
  }
  if (input.action === "start") deps.installTrigger();
  if (input.action === "stop") deps.removeTrigger();
  return {
    ok: true,
    action: input.action,
    running: deps.countTriggers() > 0,
    intervalMinutes: deps.intervalMinutes,
  };
}

/** 結果を、端末に出す行にする */
export function formatControlResult(result: ControlResult): string[] {
  if (!result.ok) return [`失敗: ${result.error}`];
  const state = result.running ? `動いています（${result.intervalMinutes} 分おき）` : "止まっています";
  return [`cron: ${state}`];
}
