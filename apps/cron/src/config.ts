/** cron を起こす先（ステージングと本番）。Apps Script は 1 つだけなので、ここを変えて `pnpm push` すると、両方に、すぐ反映される */
export type Target = {
  /** ログに出す名前。合言葉を入れるスクリプトのプロパティの名前も、これから決まる（secretPropertyOf） */
  name: string;
  /** POST /cron の URL（Worker の公開 URL + /cron） */
  url: string;
};

/** 何分おきに呼ぶか（Apps Script の時間トリガーは、1・5・10・15・30 分から選ぶ） */
export const CRON_INTERVAL_MINUTES = 1;

export const TARGETS: readonly Target[] = [
  { name: "staging", url: "https://uc-bot-stg.motarou-engineer.workers.dev/cron" },
  { name: "production", url: "https://uc-bot.motarou-engineer.workers.dev/cron" },
];

/** 合言葉（Worker の CRON_SECRET と同じ値）を入れる、スクリプトのプロパティの名前。例: staging → CRON_SECRET_STAGING */
export const secretPropertyOf = (target: Target) => `CRON_SECRET_${target.name.toUpperCase()}`;
