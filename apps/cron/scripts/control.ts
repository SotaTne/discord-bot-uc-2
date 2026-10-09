// 手元から、cron を操作する（ウェブアプリ doPost を、合言葉つきで呼ぶ）。
//   pnpm start   毎分のトリガーを作る（cron を動かす）
//   pnpm stop    トリガーを消す（cron を止める。使わない期間の節約）
//   pnpm health  動いているか（トリガーの有無と、呼ぶ先の応答）を見る
// 必要な設定は、apps/cron/.env.local（git には入れない）に書く: GAS_DEPLOYMENT_ID・CRON_SECRET
import { CONTROL_ACTIONS, formatControlResult, isControlAction, type ControlAction, type ControlResult } from "@uc/cron";

export const webAppUrl = (deploymentId: string) => `https://script.google.com/macros/s/${deploymentId}/exec`;

/** ウェブアプリを呼んで、結果を受け取る。JSON でない応答（権限が未許可の画面など）は、失敗として返す */
export async function callControl(input: { deploymentId: string; secret: string; action: ControlAction; fetch?: typeof fetch }): Promise<ControlResult> {
  const doFetch = input.fetch ?? fetch;
  // Apps Script は、POST を受けたあと、結果を、別の URL にリダイレクトする（fetch が、結果の URL を、取りに行く）
  const response = await doFetch(webAppUrl(input.deploymentId), {
    method: "POST",
    body: new URLSearchParams({ key: input.secret, action: input.action }),
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
  const { GAS_DEPLOYMENT_ID, CRON_SECRET } = process.env;
  if (!isControlAction(action)) {
    console.error(`使い方: control.ts <${CONTROL_ACTIONS.join(" | ")}>`);
    process.exitCode = 2;
  } else if (!GAS_DEPLOYMENT_ID || !CRON_SECRET) {
    console.error("apps/cron/.env.local に、GAS_DEPLOYMENT_ID と CRON_SECRET を書いてください（.env.example を、コピーする）");
    process.exitCode = 2;
  } else {
    const result = await callControl({ deploymentId: GAS_DEPLOYMENT_ID, secret: CRON_SECRET, action });
    console.log(formatControlResult(result).join("\n"));
    if (!result.ok) process.exitCode = 1;
  }
}
