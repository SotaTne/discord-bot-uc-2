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
| `apps/worker` | Hono。`/interactions`（Discord）、`/api`（ダッシュボード用）、cron、ダッシュボードの配信 |
| `apps/dashboard` | Vite + React + Mantine の管理画面。API の型は Hono RPC で受け取る |
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
- 起動: worker（Vite）、ダッシュボード（Vite）、疑似 Discord（mock。サーバーと画面）。

| URL | 内容 |
|---|---|
| http://localhost:8788 | 疑似 Discord の動作確認ページ（同じ場所で、worker が、`/api/v10` も呼ぶ） |
| http://localhost:5173 | ダッシュボード（Vite。`/api` は worker に proxy される） |
| http://localhost:8787 | worker（Vite） |

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
`/dev/*`（時計・状態・cron・初期化）と、疑似時計と、モックの Discord への差し替え（`DISCORD_API_BASE`）は、開発のビルドにだけ入る。本番のビルド（`vite build`）では、ビルド時の定数（`import.meta.env.DEV`）が false になり、コードごと消える（`tests/worker-build.test.ts` が、実際にビルドして確かめる）。

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

## 本番へのデプロイ（Cloudflare）

1. D1 と R2 を作る。出力された D1 の ID を、`apps/worker/wrangler.jsonc` の `database_id` に書く。

   ```bash
   cd apps/worker
   pnpm exec wrangler d1 create uc-bot
   pnpm exec wrangler r2 bucket create uc-bot-screenshots
   ```

2. シークレットを設定する（`DISCORD_API_BASE` は設定しない。本番のビルドでは、読まれない）。

   ```bash
   pnpm exec wrangler secret put DISCORD_PUBLIC_KEY
   pnpm exec wrangler secret put DISCORD_BOT_TOKEN
   pnpm exec wrangler secret put DISCORD_APPLICATION_ID
   ```

3. マイグレーションを適用して、ダッシュボードをビルドし、デプロイする。

   ```bash
   pnpm exec wrangler d1 migrations apply uc-bot --remote
   pnpm --filter @uc/dashboard build
   pnpm --filter @uc/worker deploy
   ```

4. Developer Portal の「Interactions Endpoint URL」に `https://<worker の URL>/interactions` を設定し、`pnpm register-commands` を実行する。
5. Bot を、チャンネルに投稿できる権限で、サーバーに招待する（ロール管理の権限は要らない）。
6. Discord で、管理者が `/uc-admin-dashboard` を実行して、ダッシュボードに入り、「設定」で、投稿先のチャンネル・試合時刻・チームを登録する。

cron（毎分）は、`wrangler.jsonc` の `triggers.crons` で、デプロイと一緒に登録される。

## 開発ルール

- **バージョンの置き場所は2つだけ**: ツールは `mise.toml`、依存は `pnpm-workspace.yaml` の `catalog:`。各 `package.json` には直接書かない。
- **すべてのパッケージが vitest でテストする**。`test` と `typecheck` のスクリプトを持つこと。`tests/workspace.test.ts` が検査する。
- **ドメイン規則は `packages/core` に書く**。Discord にも Cloudflare にも依存させない。現在時刻は `Clock` を受け取る。
- **`packages/*` は `apps/*` に依存しない**。依存の向きは `apps → packages`。
- **DB へのアクセスは Drizzle のリポジトリ（`packages/db/src/repos`）を通す**。DB の制約は、本番と同じマイグレーションを `node:sqlite` に適用して確かめる。
- **グローバルの `fetch` を、プロパティに入れて呼ばない**。Workers では、`this` が違うと `Illegal invocation` になる（Node のテストでは再現しない）。`(...args) => fetch(...args)` のように包む。
- スキーマを変えたら `pnpm --filter @uc/db generate` でマイグレーションを作る。
- テストは `pnpm test`（ルートの規約テスト → 各パッケージ）。画面のテストは、`apps/dashboard/src/test/fake-backend.tsx` で API を差し替えて、jsdom で動かす。
