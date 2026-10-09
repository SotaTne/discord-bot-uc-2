// ビルドして、Apps Script に置いて、ウェブアプリ（doPost。start / stop / health の入口）を、置いたコードにそろえる。
//   - config.ts の WEB_APP_DEPLOYMENT_ID が空（初回）: ウェブアプリのデプロイを作って、出た ID を、config.ts に書く
//   - ある（2 回目から）: 同じデプロイ（同じ URL）の中身を、置いたコードに更新する（redeploy）
// ウェブアプリは、「デプロイしたバージョン」を動かすので、置いただけでは、古いままになる。毎分のトリガー（tick）は、置いた最新のコードで動く。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { WEB_APP_DEPLOYMENT_ID } from "../src/config";

const CONFIG_PATH = new URL("../src/config.ts", import.meta.url);

/** `clasp create-deployment` の出力から、デプロイの ID（AKfycb…）を取り出す。なければ、null */
export function extractDeploymentId(output: string): string | null {
  return /AKfycb[\w-]+/.exec(output)?.[0] ?? null;
}

/** config.ts の中身の、WEB_APP_DEPLOYMENT_ID の値を、書き換える。見つからなければ、null */
export function setDeploymentId(configText: string, id: string): string | null {
  const pattern = /(export const WEB_APP_DEPLOYMENT_ID = ")[^"]*(")/;
  return pattern.test(configText) ? configText.replace(pattern, `$1${id}$2`) : null;
}

function run(args: string[]): string {
  const output = execFileSync("pnpm", args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
  process.stdout.write(output);
  return output;
}

if (import.meta.main) {
  run(["build"]);
  run(["exec", "clasp", "push", "--force"]);

  if (WEB_APP_DEPLOYMENT_ID) {
    run(["exec", "clasp", "redeploy", WEB_APP_DEPLOYMENT_ID, "--description", "push"]);
  } else {
    const id = extractDeploymentId(run(["exec", "clasp", "create-deployment", "--description", "UC cron"]));
    const updated = id ? setDeploymentId(readFileSync(CONFIG_PATH, "utf8"), id) : null;
    if (!id || !updated) {
      console.error("デプロイの ID を、config.ts に書けませんでした。上の出力の、AKfycb… の部分を、WEB_APP_DEPLOYMENT_ID に、手で書いてください");
      process.exitCode = 1;
    } else {
      writeFileSync(CONFIG_PATH, updated);
      console.log(`\nデプロイの ID（${id}）を、src/config.ts の WEB_APP_DEPLOYMENT_ID に書きました。コミットしてください`);
    }
  }
}
