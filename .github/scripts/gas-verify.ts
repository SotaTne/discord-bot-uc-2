// gas-cd.yml: Apps Script のプロジェクトと、ウェブアプリのデプロイが、あるかを確かめる（なければ、置く前に止める）。
// なぜ止めるか: create や deployment をしていない・削除した・ID の間違い、のどれでも、置いても、どこにも届かないため。
import { execFileSync } from "node:child_process";
import { StepError, requireEnv, runStep } from "./support.ts";

/** `clasp list-deployments` の出力に、ウェブアプリのデプロイの ID があるか。なければ StepError */
export function checkDeployments(output: string, deploymentId: string): void {
  if (!output.includes(deploymentId)) {
    throw new StepError(`デプロイ（${deploymentId}）が、見つかりません。先に deployment をして、ID を Variable GAS_DEPLOYMENT_ID に登録してください`);
  }
}

/** プロジェクトを開けなかったとき（clasp の失敗）の、メッセージ */
export const projectMissingMessage = (scriptId: string) =>
  `Apps Script のプロジェクト（${scriptId}）を、開けません。先に create をして、ID を Variable GAS_SCRIPT_ID に登録してください`;

if (import.meta.main) {
  await runStep(() => {
    const { GAS_SCRIPT_ID, GAS_DEPLOYMENT_ID } = requireEnv(process.env, ["GAS_SCRIPT_ID", "GAS_DEPLOYMENT_ID"], "Environment「gas」の設定");
    let output: string;
    try {
      output = execFileSync("pnpm", ["exec", "clasp", "list-deployments", GAS_SCRIPT_ID!], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      // clasp のエラーの内容を、ログに残す（認証の期限切れなどが、ここで分かる）
      console.log(String((error as { stderr?: unknown }).stderr ?? error));
      throw new StepError(projectMissingMessage(GAS_SCRIPT_ID!));
    }
    console.log(output);
    checkDeployments(output, GAS_DEPLOYMENT_ID!);
  });
}
