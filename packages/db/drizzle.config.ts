import { defineConfig } from "drizzle-kit";

// 生成した SQL は、wrangler の D1 マイグレーション（migrations_dir）にそのまま使える。
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./migrations",
});
