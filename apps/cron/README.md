# apps/cron（毎分、cron を起こす Google Apps Script）

毎分、ステージングと本番の Worker の `POST /cron` を呼ぶ。Worker は、「受け付けた」（202）をすぐ返して、そのあとで、募集開始の投稿と、締切のマッチングを、時刻が来ていて、まだ行っていないものだけ、行う（何度呼んでも、二重には実行されない）。

- 呼ぶ先と間隔は、`src/config.ts`。**Apps Script は 1 つだけ**なので、ここを変えて `pnpm push` すると、ステージングと本番の両方に、すぐ反映される。
- 呼び出しの作り方と判定は、`packages/cron`（開発の mock と同じ部品）。ここは、送り方（`UrlFetchApp.fetchAll`）と、合言葉の読み方だけ。
- 合言葉（Worker の `CRON_SECRET`）は、コードに書かない。Apps Script の「スクリプト プロパティ」に、`CRON_SECRET` として登録する。全部の呼ぶ先で、同じ合言葉を使う。
- **手元から、手動で運用する**（自動のデプロイは、しない。Google のログイン情報を、GitHub に置かないため）。

## 使うコマンド

`pnpm --filter @uc/cron-app <名前>`（`apps/cron` の中なら、`pnpm <名前>`）で実行する。

| 名前 | 内容 |
|---|---|
| `start` | 毎分のトリガーを作る（cron を動かす）。すでにあれば、作り直す（間隔を変えたときも、これ） |
| `stop` | トリガーを消す（cron を止める）。使わない期間の節約になる |
| `health` | Apps Script が動いているか（ウェブアプリが応答して、毎分のトリガーがあるか）を見る |
| `push` | ビルドして、Apps Script に置いて、ウェブアプリを更新する。`src/config.ts` などを変えたときに実行する |
| `create` | Apps Script のプロジェクトを作って、`.clasp.json` を書く（最初の 1 回） |
| `deployment` | ウェブアプリのデプロイを、新しく作る（最初の 1 回。ID が出る） |
| `logs` | 実行のログを見る（失敗した回だけ、出る） |
| `delete` | リモートの Apps Script のプロジェクトを、削除する（確認が出る）。毎分の呼び出しも、止まる |

`start`・`stop`・`health` は、ウェブアプリ（`doPost`）を、合言葉つきで呼ぶ。Google のログインは、要らない（合言葉だけ）。

```
$ pnpm health
cron: 動いています（1 分おき）
```

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
6. **手元の設定**: `apps/cron/.env.example` を、`.env.local` にコピーして、`GAS_DEPLOYMENT_ID`（5 の ID）と `CRON_SECRET`（1 と同じ値）を書く（`.env.local` は、git に入れない）。
7. **権限を許可して、cron を動かし始める**: Apps Script の画面で、関数 `installTrigger` を、**1 回だけ、手で**実行する。Google の権限の確認（外部への通信・トリガーの管理）が出るので、許可する。
   - 許可は、人が画面で押す必要がある（`start` は、ウェブアプリを呼ぶだけなので、許可の前は、動かない）。許可は、どの関数を実行しても済むが、`installTrigger` は、そのまま、毎分のトリガーを作る（cron が動き始める）。
   - 許可のあとは、`start` / `stop` / `health` で、手元から操作できる。
8. `pnpm --filter @uc/cron-app health` で、動いているか確かめる。

動いているかは、`health` と、Apps Script の「実行数」で見る。何も起きなかった回は、ログに出さない（受け付けられなかった回だけ、出る）。

## ウェブアプリ（doPost）について

`https://script.google.com/macros/s/<デプロイの ID>/exec` に、フォームの `key=<合言葉>` と `action=<start|stop|health>` を POST すると、合言葉が合うときだけ、実行して、JSON で状態を返す。合わなければ、`{"ok":false,"error":"unauthorized"}`（何も実行しない）。

ログインなしで呼べる設定（`access: ANYONE_ANONYMOUS`）なので、**合言葉が、唯一の守り**。漏れたら、Worker と Apps Script の両方の値を、取り替える。ウェブアプリは、「デプロイしたバージョン」を動かすので、コードを変えたら、`pnpm push`（置く + ウェブアプリの更新）を実行する。毎分のトリガー（`tick`）は、置いた最新のコードを使う。

## 注意

- Apps Script の時間トリガーは、数秒〜数分、ずれることがある。Worker 側は、猶予（募集開始は 1 時間、締切のマッチングは試合開始の 30 分後まで）があるので、取りこぼさない。
- 無料の Google アカウントには、1 日の実行時間の上限（90 分）がある。待ち時間を短くするために、次の 2 つをしている。
  - Worker が、処理の前に、すぐ 202 を返す（処理は、そのあとで行う。結果は、Worker のログに出る）。
  - 2 つの呼び出しを、`UrlFetchApp.fetchAll` で、同時に送る（待ち時間は、遅いほうの 1 件分）。
  - 通信そのものが失敗したときは、その回の呼び出しが、まとめて失敗する（次の分に、もう一度呼ぶ）。
