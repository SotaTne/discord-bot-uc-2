# apps/cron（毎分、cron を起こす Google Apps Script）

毎分、ステージングと本番の Worker の `POST /cron` を呼ぶ。Worker は、募集開始の投稿と、締切のマッチングを、時刻が来ていて、まだ行っていないものだけ、行う（何度呼んでも、二重には実行されない）。

- 呼ぶ先は、`src/targets.ts`。**Apps Script は 1 つだけ**なので、ここを変えて `pnpm push` すると、ステージングと本番の両方に、すぐ反映される。
- 合言葉（Worker の `CRON_SECRET`）は、コードに書かない。Apps Script の「スクリプト プロパティ」に、`CRON_SECRET_STAGING` と `CRON_SECRET_PRODUCTION` として登録する。
- 使わない期間は、`removeTrigger` を実行すると、毎分の実行が止まる（無駄な実行がない）。もう一度動かすときは、`installTrigger`。

## 最初の設定（1 回）

1. Worker 側に、合言葉を置く: GitHub の Environments（`staging`・`production`）の Secrets に、`CRON_SECRET` を登録して（環境ごとに別の値）、デプロイする（`/cron` が、合言葉つきで動くようになる）。
2. <https://script.google.com> で、新しいプロジェクトを作る。「プロジェクトの設定」から、ID を、`apps/cron/.clasp.json`（`.clasp.example.json` をコピー）の `scriptId` に書く。
3. 「プロジェクトの設定」→「スクリプト プロパティ」に、`CRON_SECRET_STAGING` と `CRON_SECRET_PRODUCTION` を、1 の値で登録する。
4. 手元で `pnpm --filter @uc/cron exec clasp login` を実行してから、`pnpm --filter @uc/cron push`（ビルドして、Apps Script に置く）。
5. Apps Script の画面で、`installTrigger` を、1 回、手で実行する（Google の権限の確認が出る）。

動いているかは、Apps Script の「実行数」で見る。何も起きなかった回は、ログに出さない（ジョブを実行した回と、失敗した回だけ、出る）。

## 注意

- Apps Script の時間トリガーは、数秒〜数分、ずれることがある。Worker 側は、猶予（募集開始は 1 時間、締切のマッチングは試合開始の 30 分後まで）があるので、取りこぼさない。
- 無料の Google アカウントには、1 日の実行時間の上限（90 分）がある。毎分の実行は、1 回が 1〜2 秒なので、収まる。
