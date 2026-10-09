# dev/（開発専用のコード）

開発のときだけ使うコード。**本番の入口（`src/index.ts`）は、このフォルダを読み込まない**。分岐やビルドの設定で隠すのでなく、入口が違うので、本番に出ない。

| ファイル | 役割 |
|---|---|
| `entry.ts` | 開発の入口。`pnpm dev`（`wrangler dev src/dev/entry.ts`）だけが使う |
| `app.ts` | 本番と同じアプリ（`createApp`）に、`/dev/*` を足す |
| `routes.ts` | `/dev/*` のルート（認証なし）: 時計（`/clock`）・cron の実行（`/tick`）・状態（`/state`）・画像（`/screenshots/:id`）・初期化（`/reset`） |
| `clock.ts` | 疑似時計。「本物の時刻 + ずれ」。API・Discord・cron が、同じ時計に従う |
| `snapshot.ts` | `/dev/state` が返す、worker の状態のまとめ（mock の画面が使う） |

## 守ること

- 本番のコードから、このフォルダを import しない（`tests/worker-imports.test.ts` が確かめる）。
- 本番のビルドに、ここのコードが入らない（`tests/worker-build.test.ts` が、実際のビルドで確かめる）。
- `/dev/*` は、認証がない。開発専用の入口にだけ置く。

詳しくは、リポジトリの `README.md`（疑似 Discord）と `SPEC.md`（開発専用の worker のルート）。
