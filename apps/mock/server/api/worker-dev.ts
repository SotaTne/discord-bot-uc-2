import type { DevSnapshot } from "@uc/api";
import type { MockState } from "../discord/state";

export type WorkerDevOptions = {
  /** worker の URL（例: http://localhost:8787） */
  workerUrl: string;
  fetch?: typeof fetch;
};

export type TickSummary = { ran: string[]; errors: string[] };

/**
 * worker の開発用ルート（/dev/*）を呼ぶ。Discord の役ではなく、動作確認のための、操作と確認。
 * 開発のビルドにだけ入る（本番の worker にはない）。
 */
export function createWorkerDev(options: WorkerDevOptions, state: MockState) {
  const doFetch = options.fetch ?? fetch;
  const workerUrl = options.workerUrl.replace(/\/$/, "");

  /** cron を待たずに、疑似時計の時刻（なければ本物の時刻）で、cron の処理を1回実行させる */
  async function tick(): Promise<TickSummary> {
    const devNow = state.clockIso();
    const response = await doFetch(`${workerUrl}/dev/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(devNow ? { now: devNow } : {}),
    });
    if (!response.ok) throw new Error(`worker が ${response.status} を返しました（DEV_CLOCK=true になっていますか）`);
    return (await response.json()) as TickSummary;
  }

  /** 疑似時計の時刻（なければ本物の時刻）で、worker の「いまの状態」をまとめて取る（開発専用の /dev/state） */
  async function fetchSnapshot(): Promise<DevSnapshot> {
    const devNow = state.clockIso();
    const response = await doFetch(`${workerUrl}/dev/state?guildId=${encodeURIComponent(state.guildId)}`, {
      headers: devNow ? { "X-Dev-Now": devNow } : {},
    });
    if (!response.ok) {
      throw new Error(`worker が ${response.status} を返しました（DEV_CLOCK=true になっていますか。まだデータがない可能性もあります）`);
    }
    return (await response.json()) as DevSnapshot;
  }

  /** worker の活動の記録（挙手・マッチング・得点・cron の履歴・ログイン）を消す。設定・対戦枠・チームは残る */
  async function resetWorkerData(): Promise<void> {
    const response = await doFetch(`${workerUrl}/dev/reset?guildId=${encodeURIComponent(state.guildId)}`, { method: "POST" });
    if (!response.ok) throw new Error(`worker が ${response.status} を返しました（DEV_CLOCK=true になっていますか）`);
  }

  /** 保存された画像（worker の R2）を取る */
  function fetchScreenshot(seq: string): Promise<Response> {
    return doFetch(`${workerUrl}/dev/screenshots/${encodeURIComponent(seq)}?guildId=${encodeURIComponent(state.guildId)}`);
  }

  return { tick, fetchSnapshot, resetWorkerData, fetchScreenshot };
}

export type WorkerDev = ReturnType<typeof createWorkerDev>;
