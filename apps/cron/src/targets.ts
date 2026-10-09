/** cron を起こす先。ここを変えて `pnpm push` すると、ステージングと本番の両方に、すぐ反映される（Apps Script は、1 つだけ） */
export type Target = {
  name: string;
  /** POST /cron の URL（Worker の公開 URL + /cron） */
  url: string;
  /** 合言葉（Worker の CRON_SECRET と同じ値）を入れた、スクリプトのプロパティの名前 */
  secretProperty: string;
};

export const TARGETS: readonly Target[] = [
  { name: "staging", url: "https://uc-bot-stg.motarou-engineer.workers.dev/cron", secretProperty: "CRON_SECRET_STAGING" },
  { name: "production", url: "https://uc-bot.motarou-engineer.workers.dev/cron", secretProperty: "CRON_SECRET_PRODUCTION" },
];
