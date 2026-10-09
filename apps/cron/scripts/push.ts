// ビルドして、Apps Script に置いて、ウェブアプリ（doPost）を、置いたコードに更新する。
// ウェブアプリは、「デプロイしたバージョン」を動かすので、置いただけでは、古いままになる（start / stop / health の入口）。
// 毎分のトリガー（tick）は、置いた最新のコードで動く。
import { execFileSync } from "node:child_process";

const run = (args: string[]) => execFileSync("pnpm", args, { stdio: "inherit" });

run(["build"]);
run(["exec", "clasp", "push", "--force"]);

const deploymentId = process.env.GAS_DEPLOYMENT_ID;
if (deploymentId) {
  run(["exec", "clasp", "redeploy", deploymentId, "--description", "push"]);
} else {
  console.log("GAS_DEPLOYMENT_ID（.env.local）がないので、ウェブアプリは、更新していません。最初の 1 回は、`pnpm deployment` で作ります");
}
