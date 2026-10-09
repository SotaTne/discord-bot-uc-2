import type { DevClock, DevSnapshot } from "@uc/api";
import type { MockState } from "../discord/state";

export type WorkerDevOptions = {
  /** worker の URL（例: http://localhost:5173） */
  workerUrl: string;
  fetch?: typeof fetch;
};

export type TickSummary = { ran: string[]; errors: string[] };

const NOT_DEV = "worker が開発用のサーバー（pnpm dev）で動いていますか。本番のビルドには、/dev/* はありません";

const sameClock = (a: DevClock, b: DevClock) => a.offsetMs === b.offsetMs;

/**
 * worker の開発用ルート（/dev/*）を呼ぶ。Discord の役ではなく、動作確認のための、操作と確認。
 * 開発のビルドにだけ入る（本番の worker にはない）。時計は、worker が持つ（mock は、同じ状態を伝えて、そろえる）。
 */
export function createWorkerDev(options: WorkerDevOptions, state: MockState) {
  const doFetch = options.fetch ?? fetch;
  const workerUrl = options.workerUrl.replace(/\/$/, "");

  /** mock の疑似時計の状態を、worker に伝える（worker 全体 = API・Discord・cron が、この時計に従う） */
  async function pushClock(): Promise<void> {
    const response = await doFetch(`${workerUrl}/dev/clock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.clock()),
    });
    if (!response.ok) throw new Error(`worker が ${response.status} を返しました（${NOT_DEV}）`);
  }

  /** cron を待たずに、いまの疑似時計で、cron の処理を1回実行させる */
  async function tick(): Promise<TickSummary> {
    const response = await doFetch(`${workerUrl}/dev/tick`, { method: "POST" });
    if (!response.ok) throw new Error(`worker が ${response.status} を返しました（${NOT_DEV}）`);
    return (await response.json()) as TickSummary;
  }

  /**
   * worker の「いまの状態」をまとめて取る（開発専用の /dev/state）。
   * worker の時計が、mock の時計とずれていたら（worker を作り直したときなど）、mock の時計を伝え直す。
   */
  async function fetchSnapshot(): Promise<DevSnapshot> {
    const response = await doFetch(`${workerUrl}/dev/state?guildId=${encodeURIComponent(state.guildId)}`);
    if (!response.ok) {
      throw new Error(`worker が ${response.status} を返しました（${NOT_DEV}。まだデータがない可能性もあります）`);
    }
    const snapshot = (await response.json()) as DevSnapshot;
    if (!sameClock(snapshot.clock, state.clock())) await pushClock();
    return snapshot;
  }

  /** worker の活動の記録（挙手・マッチング・得点・cron の履歴・ログイン）を消す。設定・対戦枠・チームは残る */
  async function resetWorkerData(): Promise<void> {
    const response = await doFetch(`${workerUrl}/dev/reset?guildId=${encodeURIComponent(state.guildId)}`, { method: "POST" });
    if (!response.ok) throw new Error(`worker が ${response.status} を返しました（${NOT_DEV}）`);
  }

  /** 保存された画像（worker の R2）を取る */
  function fetchScreenshot(seq: string): Promise<Response> {
    return doFetch(`${workerUrl}/dev/screenshots/${encodeURIComponent(seq)}?guildId=${encodeURIComponent(state.guildId)}`);
  }

  return { pushClock, tick, fetchSnapshot, resetWorkerData, fetchScreenshot };
}

export type WorkerDev = ReturnType<typeof createWorkerDev>;
