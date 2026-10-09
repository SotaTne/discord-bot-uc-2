/**
 * 開発用の cron の合言葉（Worker の `.dev.vars` の CRON_SECRET と同じ値。`pnpm --filter @uc/mock run setup-dev` が書く）。
 * 本物の合言葉ではない（本番の値は、GitHub の Secrets にだけある）。変えたいときは、mock の環境変数 CRON_SECRET で上書きする
 */
export const DEV_CRON_SECRET = "dev-cron-secret";
