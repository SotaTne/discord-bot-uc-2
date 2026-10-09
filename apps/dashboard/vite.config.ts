import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// ダッシュボード（画面）と worker（API・Discord・cron）を、1 つの Vite アプリとして動かす。
// - 開発（`vite`）: 1 つのサーバー（5173）で、画面も API も動く。同一オリジンなので、proxy は要らない
// - 本番用のビルド（`vite build`）: 画面は静的ファイル、worker は 1 つのスクリプトになる。配信の設定（assets）は、プラグインが、自動で作る
// worker のコードと、D1・R2・cron の設定は、apps/worker にある（このパッケージの外）。
export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      configPath: "../worker/wrangler.jsonc",
      // wrangler の `d1 migrations apply --local` と、同じ場所に、ローカルの DB を置く
      persistState: { path: "../worker/.wrangler/state" },
    }),
  ],
  server: { port: 5173, strictPort: true },
});
