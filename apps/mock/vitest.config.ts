import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // 画面のテストは、描画が重い。turbo が、各パッケージのテストを同時に走らせると、既定の 5 秒を超えることがある（テストの失敗ではない）
    testTimeout: 20_000,
    hookTimeout: 20_000,
    projects: [
      // サーバー（Discord のサーバー役・画面用の API）と、開発の準備は、Node で
      { extends: true, test: { name: "server", environment: "node", include: ["server/**/*.test.ts", "scripts/**/*.test.ts"] } },
      // 画面は、jsdom（ブラウザの代わり）で
      { extends: true, test: { name: "client", environment: "jsdom", setupFiles: ["./client/test/setup.ts"], include: ["client/**/*.test.ts", "client/**/*.test.tsx"] } },
    ],
  },
});
