import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// worker を Vite で動かす（開発: `vite`、本番用のビルド: `vite build`）。
// 開発専用のコード（疑似時計・/dev/*）は、`import.meta.env.DEV` の中に置く。本番のビルドでは、この値が false に置き換わり、コードごと消える
export default defineConfig({
  plugins: [cloudflare()],
  server: { port: 8787, strictPort: true },
});
