import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { originForWorker } from "./src/dev/proxy-origin";

export default defineConfig({
  plugins: [react()],
  server: {
    // 開発時は、worker（wrangler dev）の API に向ける。本番は同一オリジンなので proxy は不要
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        // worker は、状態を変える操作の Origin が自分自身のものか確認する。
        // ブラウザ自身（この dev サーバーの画面）からの Origin だけを、worker の URL に書き換えて、その確認を通す。
        // ほかのサイトの Origin はそのまま渡すので、開発中も、別オリジンからの操作は拒否される
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const origin = originForWorker({
              origin: req.headers.origin,
              host: req.headers.host,
              workerOrigin: "http://localhost:8787",
            });
            if (origin !== undefined) proxyReq.setHeader("origin", origin);
          });
        },
      },
    },
  },
});
