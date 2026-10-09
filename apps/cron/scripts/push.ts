// ビルドして、Apps Script に置いて、ウェブアプリ（doPost）を、置いたコードに更新する。
// ウェブアプリは、「デプロイしたバージョン」を動かすので、置いただけでは、古いままになる（start / stop / health の入口）。
// 毎分のトリガー（tick）は、置いた最新のコードで動く。
import { execFileSync } from "node:child_process";
import { WEB_APP_DEPLOYMENT_ID } from "../src/config";

const run = (args: string[]) => execFileSync("pnpm", args, { stdio: "inherit" });

run(["build"]);
run(["exec", "clasp", "push", "--force"]);

if (WEB_APP_DEPLOYMENT_ID) {
  run(["exec", "clasp", "redeploy", WEB_APP_DEPLOYMENT_ID, "--description", "push"]);
} else {
  console.log("src/config.ts の WEB_APP_DEPLOYMENT_ID が空なので、ウェブアプリは、更新していません。最初の 1 回は、`pnpm deployment` で作って、出力の ID を、そこに書きます");
}
