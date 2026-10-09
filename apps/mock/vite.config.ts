import { defineConfig } from "vite";
import { mockServerPlugin } from "./src/vite-plugin";

/**
 * 疑似 Discord のサーバー（Discord のサーバー役 + 画面用の API）。画面はない（画面は apps/mock-ui）。
 * Vite の開発サーバーに載せて、コードを変えると、読み直される。メッセージなどの状態は、保ったまま。
 */
export default defineConfig({
  appType: "custom",
  plugins: [mockServerPlugin({ env: process.env })],
  server: { port: Number(process.env.PORT ?? 8788), strictPort: true },
});
