import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { devServer } from "./dev/dev-server";

// command: "serve" は開発サーバー（`vite`）、"build" は本番のビルド（`vite build`）。
// 開発専用の設定（proxy など）は、dev/ に置き、"serve" のときだけ使う。src/ は、本番に載る、画面のコードだけ。
export default defineConfig(({ command }) => ({
  plugins: [react()],
  ...(command === "serve" ? { server: devServer() } : {}),
}));
