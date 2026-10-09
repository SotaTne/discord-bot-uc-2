// 手元から、cron を操作する（ウェブアプリ doPost を、合言葉つきで呼ぶ）。
//   pnpm start   毎分のトリガーを作る（cron を動かす）
//   pnpm stop    トリガーを消す（cron を止める。使わない期間の節約）
//   pnpm health  動いているか（トリガーの有無と、呼ぶ先の応答）を見る
// 必要な設定: 合言葉 CRON_SECRET は apps/cron/.env.local（git には入れない。`pnpm update-cron-secret` が書く）、デプロイの ID は src/config.ts
import { COMMAND_ACTIONS, formatControlResult, isCommandAction, type ControlAction, type ControlResult } from "@uc/cron";
import { WEB_APP_DEPLOYMENT_ID } from "../src/config";

export const webAppUrl = (deploymentId: string) => `https://script.google.com/macros/s/${deploymentId}/exec`;

/** ウェブアプリを呼んで、結果を受け取る。JSON でない応答（権限が未許可の画面など）は、失敗として返す */
export async function callControl(input: { deploymentId: string; secret: string; action: ControlAction; newSecret?: string; fetch?: typeof fetch }): Promise<ControlResult> {
  const doFetch = input.fetch ?? fetch;
  // Apps Script は、POST を受けたあと、結果を、別の URL にリダイレクトする（fetch が、結果の URL を、取りに行く）
  const response = await doFetch(webAppUrl(input.deploymentId), {
    method: "POST",
    body: new URLSearchParams({ key: input.secret, action: input.action, ...(input.newSecret ? { newKey: input.newSecret } : {}) }),
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as ControlResult;
  } catch {
    return { ok: false, error: `応答を読めません（Apps Script の画面で、最初の権限の許可を、していますか）: ${text.slice(0, 80)}` };
  }
}

if (import.meta.main) {
  const action = process.argv[2];
  const { CRON_SECRET } = process.env;
  if (!isCommandAction(action)) {
    console.error(`使い方: control.ts <${COMMAND_ACTIONS.join(" | ")}>`);
    process.exitCode = 2;
  } else if (!WEB_APP_DEPLOYMENT_ID) {
    console.error("src/config.ts の WEB_APP_DEPLOYMENT_ID が、空です。`pnpm deployment` の出力の、AKfycb… の部分を、書いてください");
    process.exitCode = 2;
  } else if (!CRON_SECRET) {
    console.error("apps/cron/.env.local に、CRON_SECRET がありません。ルートで `pnpm update-cron-secret` を実行してください");
    process.exitCode = 2;
  } else {
    const result = await callControl({ deploymentId: WEB_APP_DEPLOYMENT_ID, secret: CRON_SECRET, action });
    console.log(formatControlResult(result).join("\n"));
    if (!result.ok) process.exitCode = 1;
  }
}
