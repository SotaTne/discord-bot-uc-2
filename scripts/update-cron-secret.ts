// cron の合言葉（CRON_SECRET）を、新しく作って、取り替える。
//   pnpm update-cron-secret          やることを表示して、確認してから実行する
//   pnpm update-cron-secret --yes    確認を省く
//
// やること:
//   1. ランダムな合言葉を作る
//   2. GitHub の Environments（staging・production）の Secrets に、CRON_SECRET を登録する（gh コマンド。ログイン済みであること）
//   3. Apps Script のスクリプトプロパティを、新しい値に取り替える（ウェブアプリに、古い合言葉で認証して、set-secret を送る）
//   4. apps/cron/.env.local の CRON_SECRET を書き換える（手元の start / stop / health が使う）
//   5. 値を、1 回だけ、画面に出す
// 3 は、古い合言葉（.env.local）と、デプロイの ID（apps/cron/src/config.ts）が、あるときだけ。最初の 1 回は、Apps Script の画面で、手で貼る。
// デプロイは、しない。Worker に届くのは、次の CD（デプロイ）のとき。終わりに、次にやることを表示する。
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { WEB_APP_DEPLOYMENT_ID } from "../apps/cron/src/config.ts";
import { callControl } from "../apps/cron/scripts/control.ts";

export const SECRET_NAME = "CRON_SECRET";
export const ENVIRONMENTS = ["staging", "production"] as const;
export const ENV_FILE = "apps/cron/.env.local";

/** 合言葉を作る（32 バイトのランダム。URL にも使える文字だけ） */
export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** `.env` の中身の、KEY=value の行を、書き換える（なければ、末尾に足す）。ほかの行は、そのまま */
export function upsertEnvLine(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const lines = text.split("\n");
  const index = lines.findIndex((current) => current.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = line;
    return lines.join("\n");
  }
  const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${body}${line}\n`;
}

/** `.env` の中身から、KEY の値を読む（なければ、null） */
export function readEnvValue(text: string, key: string): string | null {
  const line = text.split("\n").find((current) => current.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim();
  return value ? value : null;
}

/** 実行前に見せる、やることの一覧 */
export function plan(): string[] {
  return [
    `GitHub の Environments（${ENVIRONMENTS.join("・")}）の Secrets の ${SECRET_NAME} を、新しい値に取り替える（gh コマンド）`,
    "Apps Script のスクリプトプロパティを、新しい値に取り替える（.env.local の古い合言葉で、ウェブアプリに set-secret を送る）",
    "  ※ 初回（.env.local に古い合言葉がない、または、config.ts のデプロイの ID が空）は、自動では取り替えられない。画面に出る値を、Apps Script の「スクリプト プロパティ」に、手で貼る",
    `${ENV_FILE} の ${SECRET_NAME} を、新しい値に書き換える`,
    "新しい値を、1 回だけ、画面に出す",
    "デプロイは、しない（Worker に届くのは、次のデプロイのとき。それまでは、/cron が 401 になる）",
  ];
}

/** 取り替えたあとに、人がやること。Apps Script を、自動で取り替えられなかったときは、手で貼る手順が、先に入る */
export function nextSteps(appsScriptReplaced: boolean): string[] {
  return [
    ...(appsScriptReplaced
      ? []
      : [`Apps Script の画面（pnpm --filter @uc/cron-app exec clasp open-script）の「プロジェクトの設定」→「スクリプト プロパティ」の ${SECRET_NAME} を、上の値に取り替える`]),
    "Worker に届けるため、Actions の画面から cd を、develop と main の両方で、手動で実行する（Run workflow）",
    "pnpm --filter @uc/cron-app health で、動いているか確かめる",
  ];
}

function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function confirm(): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question("実行しますか？ [y/N] ");
  readline.close();
  return answer.trim().toLowerCase() === "y";
}

async function main(args: readonly string[]): Promise<number> {
  if (!ghAvailable()) {
    console.error("gh コマンドが、使えません（未インストール、または、未ログイン）。`gh auth login` を実行してください");
    return 1;
  }

  console.log("次のことを行います:");
  for (const item of plan()) console.log(`  - ${item}`);
  if (!args.includes("--yes") && !(await confirm())) {
    console.log("中止しました（何も変えていません）");
    return 0;
  }

  const secret = generateSecret();
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const oldSecret = readEnvValue(current, SECRET_NAME);

  for (const environment of ENVIRONMENTS) {
    // 値は、コマンドの引数ではなく、標準入力で渡す（プロセスの一覧に、出さないため）
    execFileSync("gh", ["secret", "set", SECRET_NAME, "--env", environment], { input: secret, stdio: ["pipe", "inherit", "inherit"] });
    console.log(`GitHub の ${environment} に、登録しました`);
  }

  // Apps Script は、古い合言葉で認証して、取り替える（失敗したら、ここで止める。.env.local は、古いまま残るので、やり直せる）
  let appsScriptReplaced = false;
  if (oldSecret && WEB_APP_DEPLOYMENT_ID) {
    const result = await callControl({ deploymentId: WEB_APP_DEPLOYMENT_ID, secret: oldSecret, action: "set-secret", newSecret: secret });
    if (!result.ok) {
      console.error(`Apps Script の取り替えに失敗しました: ${result.error}`);
      console.error("GitHub の値は、新しくなっています。.env.local は、古いまま、残しました。原因を直してから、もう一度、実行してください");
      return 1;
    }
    appsScriptReplaced = true;
    console.log("Apps Script の CRON_SECRET を、取り替えました");
  } else {
    console.log("Apps Script は、自動では取り替えられません（古い合言葉か、デプロイの ID が、まだありません）");
  }

  writeFileSync(ENV_FILE, upsertEnvLine(current, SECRET_NAME, secret));
  console.log(`${ENV_FILE} を、書き換えました`);

  console.log(`\n新しい ${SECRET_NAME}（この画面にだけ、出します）:\n\n  ${secret}\n\n次にやること:`);
  for (const [index, step] of nextSteps(appsScriptReplaced).entries()) console.log(`  ${index + 1}. ${step}`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    // gh の失敗（Environment が、まだない など）。値は、出さない
    console.error(`失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
