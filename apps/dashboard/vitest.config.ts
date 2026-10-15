import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // 画面のテストは jsdom で動かす（ブラウザの代わり）
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "dev/**/*.test.ts"],
    // 画面のテストは、描画が重い。turbo が、各パッケージのテストを同時に走らせると、既定の 5 秒を超えることがある（テストの失敗ではない）
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
