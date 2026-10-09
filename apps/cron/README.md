# apps/cron（毎分、cron を起こす Google Apps Script）

毎分、ステージングと本番の Worker の `POST /cron` を呼ぶ。Worker は、「受け付けた」（202）をすぐ返して、そのあとで、募集開始の投稿と、締切のマッチングを、時刻が来ていて、まだ行っていないものだけ、行う（何度呼んでも、二重には実行されない）。

- 呼ぶ先と間隔は、`src/config.ts`。**Apps Script は 1 つだけ**なので、ここを変えて `pnpm push` すると、ステージングと本番の両方に、すぐ反映される。
- 合言葉（Worker の `CRON_SECRET`）は、コードに書かない。Apps Script の「スクリプト プロパティ」に、`CRON_SECRET` として登録する。全部の呼ぶ先で、同じ合言葉を使う。
- 使わない期間は、`removeTrigger` を実行すると、毎分の実行が止まる（無駄な実行がない）。もう一度動かすときは、`installTrigger`。

## 最初の設定（1 回）

1. **Worker 側に、合言葉を置く**: GitHub の Environments（`staging` と `production`）の Secrets に、`CRON_SECRET` を、**同じ値**で登録して、デプロイする（秘密なので、リポジトリの Secrets ではなく、環境に置く）。値は、`openssl rand -base64 32` などで作る。
2. <https://script.google.com/home/usersettings> で、「Google Apps Script API」をオンにする（clasp が、プロジェクトを作ったり、置いたりするため）。
3. **プロジェクトを作る**: 手元で、Google にログインして、作る。`.clasp.json`（プロジェクトの ID を持つ。git には入れない）が、できる。
   ```
   pnpm --filter @uc/cron-app exec clasp login
   pnpm --filter @uc/cron-app create
   ```
4. Apps Script の画面（`pnpm --filter @uc/cron-app exec clasp open-script`）の「プロジェクトの設定」→「スクリプト プロパティ」に、`CRON_SECRET` を、1 と同じ値で登録する。
5. **置いて、ウェブアプリとしてデプロイする**:
   ```
   pnpm --filter @uc/cron-app push
   pnpm --filter @uc/cron-app deployment
   ```
   2 つ目の出力に、デプロイの ID が出る（`- AKfycb... @1 - UC cron` の、`AKfycb...`）。
6. Apps Script の画面で、`installTrigger` を、**1 回だけ、手で**実行する。Google の権限の確認（外部への通信・トリガーの管理）が出るので、許可する。ここで許可しておくと、以降の、自動のデプロイが、トリガーを作れる。
7. **自動のデプロイ（gas-cd）の設定**: GitHub の Settings → Environments で、`gas` を作る。Deployment branches は、`main` だけにする。

   | 名前 | 種類 | 値 |
   |---|---|---|
   | `CLASPRC_JSON` | Secret | `~/.clasprc.json` の中身（Google へのログイン情報。他の人に見せない） |
   | `CRON_SECRET` | Secret | 1 と同じ値 |
   | `GAS_SCRIPT_ID` | Variable | `.clasp.json` の `scriptId` |
   | `GAS_DEPLOYMENT_ID` | Variable | 5 で出た、デプロイの ID |

以降は、`main` で、`apps/cron` か `packages/cron` が変わると、`gas-cd`（`.github/workflows/gas-cd.yml`）が、自動で、次を行う。Actions の画面から、手動でも実行できる。
1. プロジェクトと、デプロイが、あるかを確かめる（なければ、手順を書いたエラーで止まる）。
2. `clasp push`（コードを置く）。
3. `clasp redeploy`（ウェブアプリを、置いたコードに更新する）。
4. ウェブアプリに合言葉つきで POST して、毎分のトリガーがあることを保証する（`doPost` が、`installTrigger` を実行する）。

動いているかは、Apps Script の「実行数」で見る。何も起きなかった回は、ログに出さない（受け付けられなかった回だけ、出る）。

## ウェブアプリ（doPost）について

CD が、トリガーを保証するための入口。`https://script.google.com/macros/s/<デプロイの ID>/exec` に、フォームの `key=<合言葉>` を POST すると、合言葉が合うときだけ、`installTrigger` を実行して、`ok` と返す。合わなければ、`unauthorized`（何も実行しない）。ログインなしで呼べる設定（`access: ANYONE_ANONYMOUS`）なので、合言葉が、唯一の守り。合言葉が漏れたら、Worker と Apps Script の両方の値を、取り替える。

## 注意

- Apps Script の時間トリガーは、数秒〜数分、ずれることがある。Worker 側は、猶予（募集開始は 1 時間、締切のマッチングは試合開始の 30 分後まで）があるので、取りこぼさない。
- 無料の Google アカウントには、1 日の実行時間の上限（90 分）がある。待ち時間を短くするために、次の 2 つをしている。
  - Worker が、処理の前に、すぐ 202 を返す（処理は、そのあとで行う。結果は、Worker のログに出る）。
  - 2 つの呼び出しを、`UrlFetchApp.fetchAll` で、同時に送る（待ち時間は、遅いほうの 1 件分）。
  - 通信そのものが失敗したときは、その回の呼び出しが、まとめて失敗する（次の分に、もう一度呼ぶ）。
