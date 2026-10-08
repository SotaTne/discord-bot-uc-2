import { defineConfig } from "vitest/config";

// ルートでは、リポジトリ全体の規約を守っているか確認するテストだけを実行する。
// 各パッケージのテストは、それぞれの vitest.config.ts から turbo 経由で実行する。
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
