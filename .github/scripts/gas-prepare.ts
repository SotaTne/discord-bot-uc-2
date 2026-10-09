// gas-cd.yml: clasp が使う設定ファイルを、一時的に作る。
//   ~/.clasprc.json  … Google へのログイン情報（Secret CLASPRC_JSON の中身）
//   ./.clasp.json    … プロジェクトの ID と、置くフォルダ（カレントディレクトリ = apps/cron）
import { chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StepError, requireEnv, runStep, type Env } from "./support";

export const REQUIRED_ENV = ["CLASPRC_JSON", "CRON_SECRET", "GAS_SCRIPT_ID", "GAS_DEPLOYMENT_ID"] as const;

/** 2 つのファイルの中身を作る。足りない設定や、JSON でないログイン情報は、StepError */
export function buildClaspFiles(env: Env): { clasprc: string; project: string } {
  const values = requireEnv(env, REQUIRED_ENV, "Environment「gas」の設定。apps/cron/README.md の手順");
  try {
    JSON.parse(values.CLASPRC_JSON!);
  } catch {
    throw new StepError("CLASPRC_JSON が、JSON ではありません（~/.clasprc.json の中身を、そのまま登録してください）");
  }
  return {
    clasprc: values.CLASPRC_JSON!,
    project: `${JSON.stringify({ scriptId: values.GAS_SCRIPT_ID, rootDir: "dist" })}\n`,
  };
}

if (import.meta.main) {
  await runStep(() => {
    const files = buildClaspFiles(process.env);
    // ログイン情報は、自分だけが読めるファイルにする
    const clasprc = join(homedir(), ".clasprc.json");
    writeFileSync(clasprc, files.clasprc, { mode: 0o600 });
    chmodSync(clasprc, 0o600);
    writeFileSync(".clasp.json", files.project);
  });
}
