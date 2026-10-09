// wrangler の --secrets-file に渡す、シークレットのファイル（NAME=value の行）を作る。CD（.github/workflows/cd.yml）が、node で実行する。
//
//   node .github/scripts/write-secrets.ts <出力先のファイル>
//
// 渡す秘密の一覧は、下の SECRETS に書く（足すときは、cd.yml の deploy ジョブの env にも、同じ名前を足す。tests/write-secrets.test.ts が、そろっているかを確かめる）。
// 値は、環境変数から読む（コマンドの引数に出さない）。
import { chmodSync, writeFileSync } from "node:fs";
import { StepError, runStep, type Env } from "./support";

export type SecretsSpec = {
  /** 必ず渡す秘密。空なら、エラーにして止まる（デプロイを止める） */
  required: readonly string[];
  /** 登録されているときだけ渡す秘密。空なら、書かない */
  optional: readonly string[];
};

export const SECRETS: SecretsSpec = {
  required: ["DISCORD_BOT_TOKEN"],
  // 未登録の間は、/cron が、すべて断る
  optional: ["CRON_SECRET"],
};

/** ファイルの中身（NAME=value の行）を作る。必須の秘密が空なら、StepError */
export function buildSecretsFile(spec: SecretsSpec, env: Env): string {
  const lines: string[] = [];
  const add = (name: string, value: string) => {
    // 改行を含む値は、別の行（別の名前の秘密）として読まれてしまうので、断る
    if (/[\r\n]/.test(value)) throw new StepError(`${name} の値に、改行が含まれています`);
    lines.push(`${name}=${value}`);
  };

  for (const name of spec.required) {
    const value = env[name];
    if (!value) throw new StepError(`${name} が、この環境の Secrets に登録されていません`);
    add(name, value);
  }
  for (const name of spec.optional) {
    const value = env[name];
    if (value) add(name, value);
  }
  return lines.map((line) => `${line}\n`).join("");
}

/** ファイルに書く。自分だけが読めるファイルにする（すでにあるファイルの権限も、変える） */
export function writeSecretsFile(path: string, env: Env, spec: SecretsSpec = SECRETS): void {
  writeFileSync(path, buildSecretsFile(spec, env), { mode: 0o600 });
  chmodSync(path, 0o600);
}

if (import.meta.main) {
  const output = process.argv[2];
  await runStep(() => {
    if (!output) throw new StepError("使い方: node write-secrets.ts <出力先のファイル>");
    writeSecretsFile(output, process.env);
  });
}
