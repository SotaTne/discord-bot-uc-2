import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPublicKey, ensureEnvVar } from "./dev-vars";
import { loadOrCreateDevKeys } from "../server/keys";
import { defaultSeed } from "../server/seed";
import { buildSeedSql } from "./seed-sql";

/**
 * ローカル開発の準備。モックの鍵を用意して、worker の .dev.vars に公開鍵を設定する。
 * 本物の Discord の公開鍵が入っているときは、そのまま残す（--force で上書き）。
 */
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

const keys = await loadOrCreateDevKeys(path("../.dev-keys.json"));

const varsPath = path("../../worker/.dev.vars");
const examplePath = path("../../worker/.dev.vars.example");
const current = readFileSync(existsSync(varsPath) ? varsPath : examplePath, "utf8");

const result = applyPublicKey(current, keys.publicKeyHex, process.argv.includes("--force"));

if (result.status === "kept-existing") {
  console.log("apps/worker/.dev.vars の DISCORD_PUBLIC_KEY は、すでに別の値が入っているのでそのまま残しました。");
  console.log("（本物の Discord を使うならこのままで良い。モックを使うなら: pnpm --filter @uc/mock run setup-dev --force）");
}

// 開発用の既定値を、なければ追加する（あれば、利用者が変えた値を尊重して残す）
//  - DEV_CLOCK: 疑似時計（X-Dev-Now ヘッダーと /dev/tick）を有効にする。本番では設定しない
//  - PUBLIC_URL: ログインリンクの先。開発中は Vite のダッシュボードに向ける
let text = result.text;
for (const [key, value] of [
  ["DEV_CLOCK", "true"],
  ["PUBLIC_URL", "http://localhost:5173"],
] as const) {
  text = ensureEnvVar(text, key, value).text;
}

if (text !== current || !existsSync(varsPath)) {
  writeFileSync(varsPath, text);
  console.log("apps/worker/.dev.vars を更新しました。");
} else {
  console.log("apps/worker/.dev.vars は、すでに最新です。");
}

// ローカルの D1 に投入する開発用データ（チーム・試合時刻・設定）を、wrangler が読める SQL として書き出す。
// 投入は worker 側の `db:seed` が行う。
const seedPath = path("../../worker/.wrangler/dev-seed.sql");
mkdirSync(dirname(seedPath), { recursive: true });
writeFileSync(seedPath, buildSeedSql(defaultSeed(), { slotHours: [21, 22, 23], now: Date.now() }));
console.log("開発用のシード（チーム・試合時刻）を apps/worker/.wrangler/dev-seed.sql に書き出しました。");
