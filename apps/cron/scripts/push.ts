// （ビルドは、package.json の push が、先に行う）Apps Script に置いて、ウェブアプリ（doPost。start / stop / health の入口）を、置いたコードにそろえる。
//   - .env.local に GAS_DEPLOYMENT_ID がない（初回）: ウェブアプリのデプロイを作って、出た ID を、.env.local に書く
//   - ある（2 回目から）: 同じデプロイ（同じ URL）の中身を、置いたコードに更新する（redeploy）
// ウェブアプリは、「デプロイしたバージョン」を動かすので、置いただけでは、古いままになる。毎分のトリガー（tick）は、置いた最新のコードで動く。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { upsertEnvLine } from "@uc/cron";

const ENV_PATH = new URL("../.env.local", import.meta.url);
export const DEPLOYMENT_ID_NAME = "GAS_DEPLOYMENT_ID";

/** `clasp create-deployment` の出力から、デプロイの ID（AKfycb…）を取り出す。なければ、null */
export function extractDeploymentId(output: string): string | null {
  return /AKfycb[\w-]+/.exec(output)?.[0] ?? null;
}

function run(args: string[]): string {
  const output = execFileSync("pnpm", args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
  process.stdout.write(output);
  return output;
}

if (import.meta.main) {
  run(["exec", "clasp", "push", "--force"]);

  const deploymentId = process.env[DEPLOYMENT_ID_NAME];
  if (deploymentId) {
    run(["exec", "clasp", "redeploy", deploymentId, "--description", "push"]);
  } else {
    const id = extractDeploymentId(run(["exec", "clasp", "create-deployment", "--description", "UC cron"]));
    if (!id) {
      console.error(`デプロイの ID を、読み取れませんでした。上の出力の、AKfycb… の部分を、.env.local の ${DEPLOYMENT_ID_NAME} に、手で書いてください`);
      process.exitCode = 1;
    } else {
      const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
      writeFileSync(ENV_PATH, upsertEnvLine(current, DEPLOYMENT_ID_NAME, id));
      console.log(`\nデプロイの ID（${id}）を、.env.local の ${DEPLOYMENT_ID_NAME} に書きました`);
    }
  }
}
