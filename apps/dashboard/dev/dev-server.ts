import type { ServerOptions } from "vite";
import { originForWorker } from "./proxy-origin";

/** 開発時の worker（`pnpm --filter @uc/worker dev`）の URL */
const WORKER_ORIGIN = "http://localhost:8787";

/**
 * 開発サーバー（`vite`）だけの設定。本番のビルド（`vite build`）には、使われない（vite.config.ts が、command で切り替える）。
 * 本番は、ダッシュボードが、worker と同じオリジンから配信されるので、proxy は要らない。
 */
export function devServer(): ServerOptions {
  return {
    // /api を worker に向ける
    proxy: {
      "/api": {
        target: WORKER_ORIGIN,
        changeOrigin: true,
        // worker は、状態を変える操作の Origin が、自分自身のものか確認する。
        // ブラウザ自身（この開発サーバーの画面）からの Origin だけを、worker の URL に書き換えて、その確認を通す。
        // ほかのサイトの Origin は、そのまま渡すので、開発中も、別オリジンからの操作は、拒否される
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const origin = originForWorker({ origin: req.headers.origin, host: req.headers.host, workerOrigin: WORKER_ORIGIN });
            if (origin !== undefined) proxyReq.setHeader("origin", origin);
          });
        },
      },
    },
  };
}
