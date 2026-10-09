// gas-cd.yml: Apps Script の毎分のトリガーが、あることを保証する。
// ウェブアプリ（apps/cron の doPost）に、合言葉つきで POST する。合言葉が合えば、doPost が installTrigger を実行して、「ok」と返す（何度でも、同じ結果）。
import { StepError, requireEnv, runStep } from "./support.ts";

export const webAppUrl = (deploymentId: string) => `https://script.google.com/macros/s/${deploymentId}/exec`;

/** ウェブアプリを呼んで、トリガーを保証する。「ok」以外が返ったら、StepError */
export async function ensureTrigger(input: { deploymentId: string; secret: string; fetch?: typeof fetch }): Promise<void> {
  const doFetch = input.fetch ?? fetch;
  // Apps Script は、POST を受けたあと、結果を、別の URL にリダイレクトする（fetch が、結果の URL を、取りに行く）
  const response = await doFetch(webAppUrl(input.deploymentId), {
    method: "POST",
    body: new URLSearchParams({ key: input.secret }),
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  const body = (await response.text()).trim();
  if (body !== "ok") {
    throw new StepError(
      `トリガーを保証できませんでした（応答: ${body.slice(0, 100)}）。合言葉の違い（Apps Script のスクリプトプロパティ CRON_SECRET）か、最初の権限の許可が、まだの可能性があります`,
    );
  }
}

if (import.meta.main) {
  await runStep(async () => {
    const { GAS_DEPLOYMENT_ID, CRON_SECRET } = requireEnv(process.env, ["GAS_DEPLOYMENT_ID", "CRON_SECRET"], "Environment「gas」の設定");
    await ensureTrigger({ deploymentId: GAS_DEPLOYMENT_ID!, secret: CRON_SECRET! });
    console.log("毎分のトリガーを、保証しました");
  });
}
