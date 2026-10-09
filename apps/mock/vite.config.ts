import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { mockServerPlugin } from "./server/vite-plugin";

/**
 * 疑似 Discord。1 つの Vite の開発サーバーに、2 つを載せる。
 * - 画面（client/。React）: ブラウザで開く。サーバーには、HTTP（/mock-api）で話すだけ
 * - サーバー（server/）: Discord のサーバー役（/api/v10）と、画面用の API（/mock-api）。コードを変えると読み直される。メッセージなどの状態は、保ったまま
 */
export default defineConfig({
  plugins: [react(), mockServerPlugin({ env: process.env })],
  server: { port: Number(process.env.PORT ?? 8788), strictPort: true },
});
