// wrangler の --secrets-file に渡す、シークレットのファイル（NAME=value の行）を作る。CD（.github/workflows/cd.yml）が、node で実行する。
//
// 使い方:
//   node .github/scripts/write-secrets.ts <出力先のファイル> [--required NAME]... [--optional NAME]...
//
//   --required NAME  環境変数 NAME の値を書く。空なら、エラーにして止まる（デプロイを止める）
//   --optional NAME  環境変数 NAME の値を書く。空なら、書かない（未登録の秘密は、渡さない）
//
// 値は、コマンドの引数ではなく、環境変数から読む（プロセスの一覧や、ログに、値が出ないようにするため）。
import { chmodSync, writeFileSync } from "node:fs";

export type SecretsSpec = { required: string[]; optional: string[] };
type Env = Record<string, string | undefined>;

/** 呼び出し方の間違い（終了コード 2） */
export class UsageError extends Error {}
/** 秘密が足りない・使えない値（終了コード 1。デプロイを止める） */
export class SecretError extends Error {}

const NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/** `--required NAME --optional NAME ...` を読む */
export function parseArgs(args: readonly string[]): SecretsSpec {
  const spec: SecretsSpec = { required: [], optional: [] };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const name = args[index + 1];
    if (option !== "--required" && option !== "--optional") throw new UsageError(`知らないオプションです: ${option}`);
    if (!name || !NAME_PATTERN.test(name)) throw new UsageError(`${option} に、正しい名前（大文字・数字・_）がありません: ${name ?? ""}`);
    spec[option === "--required" ? "required" : "optional"].push(name);
  }
  return spec;
}

/** ファイルの中身（NAME=value の行）を作る。必須の秘密が空なら、SecretError */
export function buildSecretsFile(spec: SecretsSpec, env: Env): string {
  const lines: string[] = [];
  const add = (name: string, value: string) => {
    // 改行を含む値は、別の行（別の名前の秘密）として読まれてしまうので、断る
    if (/[\r\n]/.test(value)) throw new SecretError(`${name} の値に、改行が含まれています`);
    lines.push(`${name}=${value}`);
  };

  for (const name of spec.required) {
    const value = env[name];
    if (!value) throw new SecretError(`${name} が、この環境の Secrets に登録されていません`);
    add(name, value);
  }
  for (const name of spec.optional) {
    const value = env[name];
    if (value) add(name, value);
  }
  return lines.map((line) => `${line}\n`).join("");
}

function main(args: readonly string[], env: Env): number {
  const [output, ...options] = args;
  try {
    if (!output) throw new UsageError("出力先のファイルがありません");
    const text = buildSecretsFile(parseArgs(options), env);
    // 自分だけが読めるファイルにする（すでにあるファイルの権限も、変える）
    writeFileSync(output, text, { mode: 0o600 });
    chmodSync(output, 0o600);
    return 0;
  } catch (error) {
    if (error instanceof SecretError) {
      // GitHub Actions の画面に、注釈として出る（標準出力）
      console.log(`::error::${error.message}`);
      return 1;
    }
    if (error instanceof UsageError) {
      console.error(`使い方が違います: ${error.message}\n使い方: node write-secrets.ts <出力先のファイル> [--required NAME]... [--optional NAME]...`);
      return 2;
    }
    throw error;
  }
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2), process.env);
