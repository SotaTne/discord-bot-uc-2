# discord-bot-uc（Cloudflare 版）

大学対抗戦の対戦マッチング Bot。仕様は [SPEC.md](SPEC.md) を参照。

挙手 → 試合の K 分前にマッチングを確定 → 勝利の記録 → 得点、までを、Discord のコマンドと管理者用のダッシュボードで扱う。

## セットアップ

[mise](https://mise.jdx.dev/) が Node と pnpm のバージョンを固定している（`mise.toml`）。

```bash
mise install
pnpm install
pnpm check   # 型チェックとテスト
```

## 構成

| 場所 | 役割 |
|---|---|
| `apps/cron` | Google Apps Script。毎分、ステージングと本番の `POST /cron` を呼んで、cron を起こす（`apps/cron/README.md`） |
| `apps/worker` | Hono。`/interactions`（Discord）、`/api`（ダッシュボード用）、cron、ダッシュボードの配信 |
| `apps/dashboard` | Vite + React + Mantine の管理画面。API の型は Hono RPC で受け取る。`src/` は、本番に載る画面のコードだけ。開発専用の設定（`/api` の proxy）は `dev/` に置き、`vite.config.ts` が、開発サーバー（`command === "serve"`）のときだけ使う |
| `apps/mock` | 開発専用の疑似 Discord。`server/`（Discord のサーバー役 `discord/` と、画面用の API `api/`）・`client/`（画面。Vite + React + Mantine + TanStack Query。サーバーには HTTP で話すだけ）・`scripts/`（開発の準備）。1 つの Vite の開発サーバーで動く（コードを変えても、メッセージなどの状態は残る） |
| `packages/core` | 純粋なドメイン規則（マッチング、得点、勝利の記録の確認、時刻）。依存なし |
| `packages/db` | Drizzle のスキーマ、D1 のマイグレーション、リポジトリ |
| `packages/discord` | 署名検証、REST クライアント、コマンド定義と登録 |
| `packages/api` | zod スキーマ（worker の検証とフォームの検証で共有） |

## ローカルで動かす（Discord なし）

```bash
pnpm dev
```

`pnpm dev` は、準備（`dev:setup`）をしてから、3つをまとめて起動する。

- 準備: モックの鍵を作って `apps/worker/.dev.vars` に公開鍵・ダッシュボードの URL（`PUBLIC_URL`）を設定し、wrangler でローカルの D1 にマイグレーションを適用する。あわせて、疑似 Discord のロール（KMU・UT・NGT・ITF）をチーム、21〜23時を試合時刻として登録する（何度実行しても重複しない）。
- 起動: worker（`wrangler dev src/dev/entry.ts`。開発専用の入口）、ダッシュボード（Vite。`/api` は worker に proxy する）、疑似 Discord（mock。サーバーと画面）。

| URL | 内容 |
|---|---|
| http://localhost:8788 | 疑似 Discord の動作確認ページ（同じ場所で、worker が、`/api/v10` も呼ぶ） |
| http://localhost:5173 | ダッシュボード（Vite。`/api` は worker に proxy する） |
| http://localhost:8787 | worker（`wrangler dev`） |

### 疑似 Discord でできること

mock は本物と同じ形式・同じ署名でリクエストを送るので、worker は本番と同じコードのまま動く。
ページは、「コマンドを実行する」ことと、「いまの状態を、常に見られる」ことだけで作っている（状態は2秒ごとに自動で更新される）。

- **いま**: 日付（◀ ▶ で1日ずつ）・時刻（直せる）・イベントの時刻（募集開始・各対戦枠の締切・各対戦枠の試合開始）のボタン・「現在時刻」。動かすと、cron が自動で1回動く（本番は毎分動くので、それと同じ）。
- **実行者**: 複数選べる。選んだ全員として、コマンドを順に実行する（alice と carol が同時に `/uc-handup`、など）。
- **コマンド**: 選ぶと、そのフォームが出る。時刻は対戦枠の選択、チームはロールの選択、点数は数値、画像はファイル、日付は日付。
- **Discord**: 公開メッセージも、本人にだけ見える返信も、時刻順に並ぶ。確認ボタンも押せる。
- **状態**: チームごとの 挙手中（対戦枠と挙手した人）・対戦数・勝利数・得点、マッチングログ、勝利記録（対戦枠・組分け・勝ったチーム・点数 → 集計の点数、何勝目、無効、画像）。
- 今日の対戦枠が、「未マッチング」か「マッチング済み」かが見える。マッチング済みの対戦枠は、時計を戻しても、挙手を受け付けない（もう一度試すときは、日付を ◀ ▶ で動かすか、「データを初期化」）。
- 「データを初期化」で、挙手・マッチング・得点・ログイン・メッセージ・時計を、初期状態に戻せる（設定・対戦枠・チームは残る）。

時計は、「本物の時刻 + ずれ」で、worker が持つ（mock が、`PUT /dev/clock` で伝える）。時刻へ移っても、時間は進む。worker の API・Discord・cron、そして、ダッシュボード（ログインの期限・「今」の表示・勝利の未記録の印）が、同じ時計に従う。
`/dev/*`（時計・状態・cron・初期化）と、疑似時計は、**開発専用の入口**（`apps/worker/src/dev/entry.ts`。`pnpm dev` だけが使う）にだけある。本番の入口（`src/index.ts`）は、`src/dev/` を、読み込まない。分岐や、ビルドの設定で隠すのでなく、入口が違うので、本番に出る可能性が、構造上、ない（`tests/worker-imports.test.ts` が、読み込みを、`tests/worker-build.test.ts` が、実際のビルドの結果を、確かめる）。

### DB を変えるとき（マイグレーション）

- `packages/db/src/schema.ts` を変えたら、`pnpm --filter @uc/db exec drizzle-kit generate --name <変更の内容>` で、**差分**（0001、0002…）を作る。既存のファイルは、書き換えない。表や列の名前を変えるときは、「名前の変更」か「作成」かを聞かれるので、名前の変更を選ぶ（データが残る）。
- 本番の DB に適用したら、そのファイルを `packages/db/src/migrations.test.ts` の `RELEASED` に足す（書き換えを、テストで止める）。
- `schema.ts` を変えて、差分を作り忘れたり、すでに適用したマイグレーションを書き換えたりすると、`pnpm test` が落ちる。
- ローカルの D1 を作り直すときは、`apps/worker/.wrangler/state` を消してから、`pnpm dev` を実行する。

### 動作確認の例

1. 「12:00 募集開始」を押す。実行者 alice と carol を選んで、`/uc-handup`（21:00）を実行する → 「チーム」の挙手中に出る。
2. 「20:53 21時の締切」を押す（cron が動く）→ 21時のマッチング結果が Discord に出る。「マッチングログ」と「対戦」にも反映される。
3. 実行者を admin にして `/uc-admin-win`（21:00、UT、80、画像）→ 「勝利記録」と「得点」に出る。
4. admin で `/uc-admin-dashboard` → 返信のリンクを開いて、「ダッシュボードへ入る」を押す。

スキーマが変わったあと（古いローカルの DB が残っているとき）は、`rm -rf apps/worker/.wrangler/state` で、ローカルの DB を作り直してから、`pnpm dev` を起動する。

`.dev.vars` にすでに別の公開鍵（本物の Discord のもの）が入っているときは、`dev:setup` は上書きしない。
モックに戻すときは `pnpm --filter @uc/mock run setup-dev --force`。

## 本物の Discord につなぐ（ngrok）

worker を ngrok で公開して、Discord から呼べるようにする。ngrok はインストール済みであること。

```bash
pnpm dev      # 1つ目のターミナル
pnpm tunnel   # 2つ目のターミナル。表示された https の URL を使う
```

1. Discord の Developer Portal で、アプリの「Interactions Endpoint URL」に `https://<ngrok の URL>/interactions` を設定する。
2. 同じ画面の「Public Key」を、`apps/worker/.dev.vars` の `DISCORD_PUBLIC_KEY` に設定する。
3. 同じく、`DISCORD_BOT_TOKEN` と `DISCORD_APPLICATION_ID` を本物の値にして、`DISCORD_API_BASE` の行を消す（モックではなく、本物の Discord に向けるため。本番のビルドでは、この値は、もともと読まれない）。
4. ログインリンクの先を、トンネルの URL にしたいときは `PUBLIC_URL=https://<ngrok の URL>` を設定する。
5. スラッシュコマンドを Discord に登録する。動作確認のときは、サーバーを指定すると、すぐ反映される。

```bash
DISCORD_GUILD_ID=<サーバーの ID> pnpm register-commands   # 指定したサーバーだけ（すぐ反映）
pnpm register-commands                                    # 全サーバー（反映に時間がかかる）
```

固定ドメインを使うときは `NGROK_URL=<ドメイン> pnpm tunnel`。
トンネルは worker 全体（`/api` を含む）を公開する。`/interactions` は署名、`/api` は Origin の検証とログイン（セッション）で守っている。

## ブランチと、デプロイの流れ

| ブランチ | 役割 | デプロイ先（GitHub Actions が、自動で行う） |
|---|---|---|
| `develop` | 統合。機能の PR は、ここに入る | **ステージング**（`uc-bot-stg`） |
| `main` | リリース済み | **本番**（`uc-bot`） |

1. 機能の PR を、`develop` に、マージする（スカッシュ）。ステージングに出る。
2. ステージングで確かめる（テスト用の Discord アプリで操作する）。
3. `develop` → `main` の PR（リリースの PR）を、マージする（**マージコミット**。スカッシュにすると、次のリリースで、同じ変更が重複して見える）。本番に出る。
4. 緊急の修正は、`main` から、ブランチを切って、`main` に PR。マージしたあと、`develop` に、取り込む。

ワークフローは、2つ（`.github/workflows/`）と、共通のセットアップ（`.github/actions/setup`。Node・pnpm のバージョンは `mise.toml`。pnpm のパッケージ、mise のツール、turbo の結果を、キャッシュする）。
- **`ci.yml`**: `develop` と `main` への PR で動く。型の確認とテスト（`pnpm check`）と、マイグレーションの履歴の確認（`drizzle-kit check`）。
- **`cd.yml`**: `develop` と `main` に、コミットが入ったとき（マージされたとき）に動く。順序は、次のとおり。
  1. **`ci`**: そのコミットの CI（`ci.yml`）。通ったときだけ、次へ進む。
  2. **`deploy`**: ビルド → マイグレーションの適用 → `wrangler deploy --env …`。
  3. **`register-commands`**: スラッシュコマンドを、Discord に登録する（`pnpm register-commands`。毎回、全部を、上書きする）。
  同じブランチのデプロイは、順番に処理する。
- どちらも、GitHub の Actions のタブの「Run workflow」から、**手動でも実行できる**（選んだブランチで動く）。`cd.yml` を、手動で実行すると、そのブランチを、そのまま、再デプロイできる（失敗したデプロイの、やり直しなど）。`develop` と `main` 以外のブランチを選ぶと、CI だけ動いて、デプロイは、飛ばされる。
  **登録を、デプロイの後にする理由**: 先に登録すると、「新しいコマンドが画面に出るのに、古い Worker が処理できない」期間ができる。後なら、登録が失敗しても、古いコマンドが、動き続けるだけ。登録は、独立したジョブなので、失敗したときは、GitHub の「Re-run failed jobs」で、そこだけを、やり直せる。

**ブランチ保護**（GitHub の Settings → Branches。`develop` と `main` の両方）:
- Require a pull request before merging（直接の push を、禁止する）
- Require status checks to pass: **`ci`**（PR のときの CI）
- Require branches to be up to date before merging
- 既定のブランチ（Settings → General）は、`develop`

保護で、通っていないものは、マージできない。それでも、デプロイの前に、そのコミットの CI を、もう一度、通す（保護の抜け道があっても、止まる）。

## 本番へのデプロイ（Cloudflare）

環境は、3つ（`apps/worker/wrangler.jsonc`）。デプロイのコマンドには、**必ず `--env staging` か `--env production` を付ける**。付け忘れると、実在しない開発用のリソース（`uc-bot-dev`）に向くので、デプロイは、失敗する（本番には、出ない）。

### 初回のセットアップ（環境ごとに、1回）

1. D1 と R2 を作る。出力された D1 の ID を、`wrangler.jsonc` の、その環境の `database_id` に書く（ID は、秘密ではない）。

   ```bash
   cd apps/worker
   pnpm exec wrangler d1 create uc-bot-staging
   pnpm exec wrangler r2 bucket create uc-bot-staging-screenshots
   pnpm exec wrangler d1 create uc-bot
   pnpm exec wrangler r2 bucket create uc-bot-screenshots
   ```

2. **シークレットは、GitHub だけに置く**（Cloudflare に、手動で、`wrangler secret put` しない）。CD が、デプロイのたびに、`wrangler deploy --secrets-file` で、Cloudflare に渡す。値を変えるときは、GitHub の値を変えて、CD を再実行する。
   - `--secrets-file` は、**足すだけ**で、消さない。GitHub から消した秘密を、Cloudflare からも消すときは、`pnpm --filter @uc/worker exec wrangler secret delete <名前> --env <環境>`。
   - `DISCORD_API_BASE` は、設定しない（開発専用）。`PUBLIC_URL`（ログインリンクの先）は、設定しない（省略すると、リクエストを受けた URL が使われる。`workers.dev` の URL なら、これで足りる）。独自のドメインを使うようになったら、`wrangler.jsonc` の、その環境の `vars` に書く（画面だけで設定した変数は、デプロイのたびに、消える）。

3. **Discord のアプリは、環境ごとに別にする**（Interactions Endpoint URL が、1つのアプリに、1つしか、設定できないため）。ステージング用に、テスト用のアプリと、テスト用のサーバーを、作る。

4. **GitHub に、設定を置く**。環境（Settings → Environments → `staging` と `production`）と、リポジトリ全体（Settings → Secrets and variables → Actions）に、分ける。
   - **置き場の考え方**: 環境で値が違うものと、**秘密**は、環境に置く（環境の Secrets は、「デプロイできるブランチ」を、`develop` / `main` に、限れる。リポジトリの Secrets は、PR のブランチの、書き換えたワークフローからも、読めてしまう）。環境で同じで、秘密ではないものだけを、リポジトリに置く。同じ名前が、両方にあると、環境の値が、優先される。

   **リポジトリの Variables**（共通）

   | 名前 | 内容 |
   |---|---|
   | `CLOUDFLARE_ACCOUNT_ID` | アカウントの ID（`pnpm exec wrangler whoami` か、ダッシュボードの Workers & Pages の右側。秘密ではない） |

   **環境の Secrets と Variables**（`staging` と `production` の、それぞれ。値は、その環境の、Cloudflare と Discord のアプリのもの）

   | 名前 | 種類 | 内容 |
   |---|---|---|
   | `CLOUDFLARE_API_TOKEN` | Secret | Workers・D1・R2 の編集権限に、絞る（足りない権限は、デプロイのエラーに従って、足す）。同じトークンを、両方の環境に、登録してもよい |
   | `DISCORD_BOT_TOKEN` | Secret | Bot のトークン。Worker の実行時と、コマンドの登録に、使う |
   | `CRON_SECRET` | Secret | `POST /cron` の合言葉。長いランダムな文字列（例: `openssl rand -base64 32`）。**環境ごとに、別の値**にする。同じ値を、`apps/cron` の Apps Script のプロパティにも、登録する |
   | `DISCORD_APPLICATION_ID` | Variable | アプリの ID（公開してよい） |
   | `DISCORD_PUBLIC_KEY` | Variable | Interactions の署名の検証に使う、公開鍵（公開してよい） |
   | `DISCORD_GUILD_ID` | Variable | **`staging` だけ**。コマンドを、そのサーバーだけに登録する（すぐに反映される）。サーバー ID は、Discord の開発者モードで、サーバーを右クリックして、コピーする。`production` には、設定しない |

   - `main` のときは、`DISCORD_GUILD_ID` を、ワークフローが、必ず、空にする（本番は、常に、全サーバーに登録する）。
   - 環境の Deployment branches: `staging` は `develop`、`production` は `main` に、限る（ほかのブランチからは、その環境のシークレットを、使えない）。
   - 本番だけ、Required reviewers（承認者）を付けると、本番へのデプロイの前に、承認の画面が出る（任意）。

5. Developer Portal の「Interactions Endpoint URL」に、各環境の `https://<worker の URL>/interactions` を設定する（環境ごとのアプリで）。スラッシュコマンドの登録は、CD が、デプロイのたびに行う（手動の登録は、要らない）。
6. Bot を、チャンネルに投稿できる権限で、サーバーに招待する（ロール管理の権限は要らない）。
7. Discord で、管理者が `/uc-admin-dashboard` を実行して、ダッシュボードに入り、「設定」で、投稿先のチャンネル・試合時刻・チームを登録する。

cron（毎分）は、2 通りで起こせる。
- Cloudflare の Cron Trigger: 環境ごとに、`wrangler.jsonc` の `triggers.crons` で、デプロイと一緒に登録される。
- `apps/cron` の Google Apps Script: 毎分、`POST /cron`（合言葉つき）を呼ぶ。Cloudflare の cron が、ステージングで動かなかったので、こちらを使う。設定は、`apps/cron/README.md`。

どちらで起こされても、処理は同じで、ジョブは「実行する権利」を取ってから動くので、二重には実行されない。

**後ろ向きの互換を保つ**: マイグレーションは、コードより先に適用され、コマンドの登録は、コードより後になる。そのため、新しい DB で、古いコードが、動くようにする（列や表の、削除と名前の変更は、2回に分けて出す）。コマンドも、同じ考え方で、コードが、古い定義と新しい定義の、両方を処理できる状態を、保つ（コマンドや必須のオプションの削除は、2回に分けて出す）。

### デプロイせずに確かめる
- ビルドだけ（ログインは要らない）: `pnpm build` のあと、`cd apps/worker && pnpm exec wrangler deploy --env production --dry-run --outdir /tmp/out`
- ローカルで、本番に近い形（`vite preview` のようなもの）: `pnpm build` のあと、`pnpm --filter @uc/worker preview`。本番の入口なので、開発専用のコードは、ない（`/dev/*` は、404）。

### 手動でデプロイするとき（緊急のときなど）
```bash
export CLOUDFLARE_API_TOKEN=...   # デプロイ用のトークン
pnpm build
pnpm --filter @uc/worker exec wrangler d1 migrations apply DB --remote --env staging
pnpm --filter @uc/worker exec wrangler deploy --env staging
```
戻すとき: `pnpm --filter @uc/worker exec wrangler rollback --env staging`（Worker のコードだけ戻る。DB は、戻らない）。

## 開発ルール

- **バージョンの置き場所は2つだけ**: ツールは `mise.toml`、依存は `pnpm-workspace.yaml` の `catalog:`。各 `package.json` には直接書かない。
- **すべてのパッケージが vitest でテストする**。`test` と `typecheck` のスクリプトを持つこと。`tests/workspace.test.ts` が検査する。
- **ドメイン規則は `packages/core` に書く**。Discord にも Cloudflare にも依存させない。現在時刻は `Clock` を受け取る。
- **`packages/*` は `apps/*` に依存しない**。依存の向きは `apps → packages`。
- **DB へのアクセスは Drizzle のリポジトリ（`packages/db/src/repos`）を通す**。DB の制約は、本番と同じマイグレーションを `node:sqlite` に適用して確かめる。
- **グローバルの `fetch` を、プロパティに入れて呼ばない**。Workers では、`this` が違うと `Illegal invocation` になる（Node のテストでは再現しない）。`(...args) => fetch(...args)` のように包む。
- スキーマを変えたら `pnpm --filter @uc/db generate` でマイグレーションを作る。
- テストは `pnpm test`（ルートの規約テスト → 各パッケージ）。画面のテストは、`apps/dashboard/src/test/fake-backend.tsx` で API を差し替えて、jsdom で動かす。
