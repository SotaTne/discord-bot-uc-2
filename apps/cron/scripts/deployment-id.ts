// Apps Script に、すでにあるウェブアプリのデプロイの ID を、取ってきて、.env.local の GAS_DEPLOYMENT_ID に書く。
// 別のパソコンで、.env.local がないときに使う（Google のログインが、要る: `clasp login`）。
// 初回（デプロイが、まだない）は、`pnpm push` が、作って、書く。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { upsertEnvLine } from "@uc/cron";
import { DEPLOYMENT_ID_NAME } from "./push";

const ENV_PATH = new URL("../.env.local", import.meta.url);

/** `clasp list-deployments` の出力の行（`- AKfycb… @1 - 説明`）を読む。作業中の版（@HEAD）は、ウェブアプリではないので、除く */
export function parseDeployments(output: string): { id: string; version: string }[] {
  return [...output.matchAll(/(AKfycb[\w-]+)\s+@(\S+)/g)].map(([, id, version]) => ({ id: id!, version: version! })).filter((deployment) => deployment.version !== "HEAD");
}

/** 取ってきた一覧から、書く ID を決める。ちょうど 1 つなら、その ID。それ以外は、理由 */
export function pickDeploymentId(deployments: readonly { id: string }[]): { id: string } | { error: string } {
  if (deployments.length === 0) return { error: "ウェブアプリのデプロイが、まだありません。先に `pnpm push` を実行してください（初回は、作って、ID を書きます）" };
  if (deployments.length > 1) {
    return { error: `デプロイが、${deployments.length} 個あります（${deployments.map((deployment) => deployment.id).join(" / ")}）。使うものを残して、ほかを、clasp undeploy で消すか、.env.local の ${DEPLOYMENT_ID_NAME} に、手で書いてください` };
  }
  return { id: deployments[0]!.id };
}

if (import.meta.main) {
  const output = execFileSync("pnpm", ["exec", "clasp", "list-deployments"], { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
  const picked = pickDeploymentId(parseDeployments(output));
  if ("error" in picked) {
    console.error(picked.error);
    process.exitCode = 1;
  } else {
    const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
    writeFileSync(ENV_PATH, upsertEnvLine(current, DEPLOYMENT_ID_NAME, picked.id));
    console.log(`デプロイの ID（${picked.id}）を、.env.local の ${DEPLOYMENT_ID_NAME} に書きました`);
  }
}
