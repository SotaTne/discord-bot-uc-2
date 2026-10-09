import { secretPropertyOf, type Target } from "./config";

export type CronRequest = {
  target: Target;
  url: string;
  options: { method: "post"; headers: { Authorization: string }; muteHttpExceptions: true };
};

/**
 * 呼ぶ先ごとのリクエストを作る。合言葉が設定されていない先は、呼ばずに、設定が足りないと知らせる。
 * 合言葉は、スクリプトのプロパティから読む（コードには、書かない）
 */
export function buildRequests(targets: readonly Target[], readSecret: (property: string) => string | null) {
  const requests: CronRequest[] = [];
  const missing: Target[] = [];
  for (const target of targets) {
    const secret = readSecret(secretPropertyOf(target));
    if (!secret) {
      missing.push(target);
      continue;
    }
    requests.push({ target, url: target.url, options: { method: "post", headers: { Authorization: `Bearer ${secret}` }, muteHttpExceptions: true } });
  }
  return { requests, missing };
}

/**
 * 応答を、ログに出す 1 行にする。「受け付けた」（202）のときは null（毎分の、いつもの応答なので、ログを増やさない）。
 * それ以外は、必ず出す（処理の結果は、Worker のログに出る）
 */
export function describeResponse(target: Target, status: number, body: string): string | null {
  if (status === 202) return null;
  return `${target.name}: 失敗 (HTTP ${status}) ${body.slice(0, 200)}`;
}
