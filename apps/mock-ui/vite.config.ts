import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * 疑似 Discord の画面。サーバー（apps/mock）とは、独立した React のアプリ。
 * サーバーには、HTTP（/mock-api）で話すだけ。開発中は、Vite の開発サーバーが、サーバーに中継する。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5174),
    strictPort: true,
    proxy: { "/mock-api": { target: process.env.MOCK_URL ?? "http://localhost:8788", changeOrigin: true } },
  },
});
