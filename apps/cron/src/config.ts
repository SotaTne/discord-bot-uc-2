import type { Target } from "@uc/cron";

/** cron を起こす先（ステージングと本番）。Apps Script は 1 つだけなので、ここを変えて `pnpm push` すると、両方に、すぐ反映される */
export const TARGETS: readonly Target[] = [
  { name: "staging", url: "https://uc-bot-stg.motarou-engineer.workers.dev/cron" },
  { name: "production", url: "https://uc-bot.motarou-engineer.workers.dev/cron" },
];

/** 何分おきに呼ぶか（Apps Script の時間トリガーは、1・5・10・15・30 分から選ぶ） */
export const CRON_INTERVAL_MINUTES = 1;

/** 合言葉（Worker の CRON_SECRET と同じ値）を入れる、スクリプトのプロパティの名前。全部の呼ぶ先で、同じ合言葉を使う */
export const SECRET_PROPERTY = "CRON_SECRET";

/**
 * ウェブアプリのデプロイの ID（AKfycb…）。start / stop / health と、push のウェブアプリの更新が使う。
 * 秘密ではない（URL の一部。守りは、合言葉）。Apps Script は 1 つなので、誰が実行しても、同じ値。最初の `pnpm push` が、ウェブアプリのデプロイを作って、ここに書く（コミットする）
 */
export const WEB_APP_DEPLOYMENT_ID = "";
