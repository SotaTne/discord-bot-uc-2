import type { Target } from "./config";

export type CronRequest = {
  target: Target;
  url: string;
  options: { method: "post"; headers: { Authorization: string }; muteHttpExceptions: true };
};

/**
 * 呼ぶ先ごとのリクエストを作る（合言葉は、全部の先で同じ）。合言葉が設定されていなければ、何も作らない（null）。
 * 合言葉は、スクリプトのプロパティから読む（コードには、書かない）
 */
export function buildRequests(targets: readonly Target[], secret: string | null): CronRequest[] | null {
  if (!secret) return null;
  return targets.map((target) => ({
    target,
    url: target.url,
    options: { method: "post", headers: { Authorization: `Bearer ${secret}` }, muteHttpExceptions: true },
  }));
}

/**
 * 応答を、ログに出す 1 行にする。「受け付けた」（202）のときは null（毎分の、いつもの応答なので、ログを増やさない）。
 * それ以外は、必ず出す（処理の結果は、Worker のログに出る）
 */
export function describeResponse(target: Target, status: number, body: string): string | null {
  if (status === 202) return null;
  return `${target.name}: 失敗 (HTTP ${status}) ${body.slice(0, 200)}`;
}
