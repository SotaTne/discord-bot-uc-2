import type { Target } from "./targets";

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
    const secret = readSecret(target.secretProperty);
    if (!secret) {
      missing.push(target);
      continue;
    }
    requests.push({ target, url: target.url, options: { method: "post", headers: { Authorization: `Bearer ${secret}` }, muteHttpExceptions: true } });
  }
  return { requests, missing };
}

/**
 * 応答を、ログに出す 1 行にする。何も起きなかった（毎分の、いつもの応答）ときは null（ログを増やさない）。
 * 失敗（ステータスが 200 でない、または、Worker の処理に失敗したジョブがある）は、必ず出す
 */
export function describeResponse(target: Target, status: number, body: string): string | null {
  if (status !== 200) return `${target.name}: 失敗 (HTTP ${status}) ${body.slice(0, 200)}`;
  let summary: { ran?: string[]; errors?: string[] };
  try {
    summary = JSON.parse(body) as { ran?: string[]; errors?: string[] };
  } catch {
    return `${target.name}: 応答を読めません ${body.slice(0, 200)}`;
  }
  if (summary.errors?.length) return `${target.name}: ジョブの失敗 ${summary.errors.join(" / ")}`;
  if (summary.ran?.length) return `${target.name}: 実行 ${summary.ran.join(", ")}`;
  return null;
}
