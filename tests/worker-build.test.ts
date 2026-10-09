import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 本番のビルドに、開発専用のコード（疑似時計・/dev/*・モックの Discord への差し替え）が入っていないことを、
// 実際にビルドして確かめる。dist/uc_bot/index.js が、Cloudflare に出す Worker そのもの。

const root = join(import.meta.dirname, "..");
const worker = join(root, "apps/worker");
const bundle = join(worker, "dist/uc_bot/index.js");

/** 開発専用のコードにだけある文字列（疑似時計・/dev/* のルート） */
const DEV_ONLY = ["invalid_clock", "getDevClockState", "no_guild", '"/dev"'];
/** 今は、どこにも書かれていない、古い仕組み（環境変数と、ヘッダーによる疑似時計）の名前。もう、入っていないこと */
const REMOVED = ["DEV_CLOCK", "X-Dev-Now"];
/** 本番のコードにある文字列（ビルドが空でないことの確認） */
const PROD = ["invalid request signature", "unauthorized"];

/** worker をビルドして、できた Worker のコードを返す。mode が development のときだけ、開発専用のコードが入る */
function build(mode: "production" | "development"): string {
  mkdirSync(join(root, "apps/dashboard/dist"), { recursive: true }); // worker が、同じ Worker から配信する、ダッシュボードの置き場
  execFileSync("pnpm", ["--filter", "@uc/worker", "exec", "vite", "build", "--mode", mode], {
    cwd: root,
    env: { ...process.env, NODE_ENV: mode },
    stdio: "pipe",
  });
  return readFileSync(bundle, "utf8");
}

describe("worker のビルド（本番に出すもの）", () => {
  it("開発のビルドには、開発専用のコードが入る（この確認が、意味を持つことの確認）", () => {
    const code = build("development");

    for (const text of [...DEV_ONLY, ...PROD]) {
      expect(code, text).toContain(text);
    }
  }, 120_000);

  it("本番のビルドには、開発専用のコードが、1つも入っていない（疑似時計・/dev/*）。本番のコードは、入っている", () => {
    const code = build("production");

    for (const text of [...DEV_ONLY, ...REMOVED]) expect(code, text).not.toContain(text);
    for (const text of PROD) expect(code, text).toContain(text);
  }, 120_000);

  it("ビルド後の設定に、ダッシュボードの静的配信（assets）を足す。/dev/* は、worker を先に呼ぶ対象から外す", () => {
    build("production");
    execFileSync("node", ["scripts/add-dashboard-assets.mjs"], { cwd: worker, stdio: "pipe" });

    const config = JSON.parse(readFileSync(join(worker, "dist/uc_bot/wrangler.json"), "utf8")) as {
      assets?: { directory: string; not_found_handling?: string; run_worker_first?: string[] };
    };
    expect(config.assets).toEqual({
      directory: "../../../dashboard/dist",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*", "/interactions"],
    });
  }, 120_000);

  it("本番のビルドは、Discord REST の差し替え（DISCORD_API_BASE の環境変数）を、読まない", () => {
    const code = readFileSync(bundle, "utf8"); // 直前の、本番のビルド

    expect(code).not.toContain("env.DISCORD_API_BASE");
  });
});
