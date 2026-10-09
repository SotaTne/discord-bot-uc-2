import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 本番のビルドに、開発専用のコード（疑似時計・/dev/*・モックの Discord への差し替え）が入っていないことを、
// 実際にビルドして確かめる。ダッシュボードの Vite が、worker も、いっしょにビルドする。
// dist/uc_bot/index.js が、Cloudflare に出す Worker そのもの。dist/client が、同じ Worker から配信する、ダッシュボード。

const root = join(import.meta.dirname, "..");
const dashboard = join(root, "apps/dashboard");
const bundle = join(dashboard, "dist/uc_bot/index.js");
const builtConfig = join(dashboard, "dist/uc_bot/wrangler.json");

/** 開発専用のコードにだけある文字列（疑似時計・/dev/* のルート） */
const DEV_ONLY = ["invalid_clock", "getDevClockState", "no_guild", '"/dev"'];
/** 今は、どこにも書かれていない、古い仕組み（環境変数と、ヘッダーによる疑似時計）の名前。もう、入っていないこと */
const REMOVED = ["DEV_CLOCK", "X-Dev-Now"];
/** 本番のコードにある文字列（ビルドが空でないことの確認） */
const PROD = ["invalid request signature", "unauthorized"];

/** worker をビルドして、できた Worker のコードを返す。mode が development のときだけ、開発専用のコードが入る */
function build(mode: "production" | "development"): string {
  execFileSync("pnpm", ["--filter", "@uc/dashboard", "exec", "vite", "build", "--mode", mode], {
    cwd: root,
    env: { ...process.env, NODE_ENV: mode },
    stdio: "pipe",
  });
  return readFileSync(bundle, "utf8");
}

describe("本番のビルド（ダッシュボードと worker）", () => {
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

  it("ビルド後の設定に、ダッシュボードの静的配信（assets）が、自動で入る。配信するファイルが、実際にある", () => {
    build("production");

    const config = JSON.parse(readFileSync(builtConfig, "utf8")) as {
      assets?: { directory: string; not_found_handling?: string; run_worker_first?: string[] };
      triggers?: { crons?: string[] };
    };
    expect(config.assets).toMatchObject({ directory: "../client", not_found_handling: "single-page-application" });
    // API と Discord は、静的ファイルより先に、worker が処理する
    expect(config.assets?.run_worker_first).toEqual(expect.arrayContaining(["/api/*", "/interactions"]));
    expect(existsSync(join(dashboard, "dist/client/index.html"))).toBe(true);
    // cron は、設定のとおり
    expect(config.triggers?.crons).toEqual(["* * * * *"]);
  }, 120_000);

  it("本番のビルドは、Discord REST の差し替え（DISCORD_API_BASE の環境変数）を、読まない", () => {
    const code = readFileSync(bundle, "utf8"); // 直前の、本番のビルド

    expect(code).not.toContain("env.DISCORD_API_BASE");
  });
});
