// CD のスクリプト（write-secrets.ts・gas-*.ts）の共通の部品。
import * as core from "@actions/core";

export type Env = Record<string, string | undefined>;

/** 設定が足りない・間違っているなど、CD を止めるべき失敗（画面には、メッセージだけを出す） */
export class StepError extends Error {}

/** 値を、GitHub Actions のログで、伏せる（「***」になる）。秘密を、環境変数から読んだら、最初に呼ぶ */
export function maskSecrets(values: readonly (string | undefined)[]): void {
  for (const value of values) {
    if (value) core.setSecret(value);
  }
}

/** スクリプトの入口で使う。StepError は、GitHub Actions の画面に、注釈（::error::）として出して、失敗で終わる（core.setFailed）。それ以外の例外は、そのまま投げる */
export async function runStep(step: () => void | Promise<void>): Promise<void> {
  try {
    await step();
  } catch (error) {
    if (!(error instanceof StepError)) throw error;
    core.setFailed(error.message);
  }
}
