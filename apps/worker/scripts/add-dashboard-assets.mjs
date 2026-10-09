// worker を Vite でビルドすると（@cloudflare/vite-plugin）、できた設定（dist/uc_bot/wrangler.json）に、
// ダッシュボードの静的配信（assets）が入らない。そこで、wrangler.jsonc の assets を、ビルド後の設定に足す。
// ダッシュボード（apps/dashboard）は、同じ Worker から配信する（Cookie の SameSite=Strict と、同一オリジンのため）。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_readConfig } from "wrangler";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const builtConfigPath = join(workerDir, "dist/uc_bot/wrangler.json");

/** 本番のビルドには、/dev/* がないので、assets より先に worker を呼ぶ対象から外す */
const PRODUCTION_ONLY = (pattern) => pattern !== "/dev/*";

const source = unstable_readConfig({ config: join(workerDir, "wrangler.jsonc") }).assets;
if (!source?.directory) throw new Error("wrangler.jsonc に assets.directory がありません");
if (!existsSync(source.directory)) {
  throw new Error(`ダッシュボードのビルド結果がありません: ${source.directory}（先に、ダッシュボードをビルドしてください）`);
}

const built = JSON.parse(readFileSync(builtConfigPath, "utf8"));
built.assets = {
  // ビルド後の設定ファイルからの、相対パス
  directory: relative(dirname(builtConfigPath), source.directory),
  ...(source.not_found_handling ? { not_found_handling: source.not_found_handling } : {}),
  ...(Array.isArray(source.run_worker_first) ? { run_worker_first: source.run_worker_first.filter(PRODUCTION_ONLY) } : {}),
};
writeFileSync(builtConfigPath, JSON.stringify(built));
console.log(`assets を足しました: ${built.assets.directory}`);
