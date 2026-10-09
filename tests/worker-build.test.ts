import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// 本番のビルドに、開発専用のコード（疑似時計・/dev/*・モックの Discord への差し替え）が入っていないことを、
// 実際にビルドして確かめる（`wrangler deploy --dry-run`。ログインは要らない）。
// 開発専用のコードは、wrangler.jsonc の define（import.meta.env.DEV = false。既定）で、コードごと消える。
// 画面（ダッシュボード）は、ワークスペースのパッケージ（@uc/dashboard）として、Worker に載る。

const root = join(import.meta.dirname, "..");
const outDir = mkdtempSync(join(tmpdir(), "uc-worker-"));

/** 開発専用のコードにだけある文字列（疑似時計・/dev/* のルート） */
const DEV_ONLY = ["invalid_clock", "getDevClockState", "no_guild", '"/dev"', "createDevRoutes", "devClock", "env.DISCORD_API_BASE"];
/** 今は、どこにも書かれていない、古い仕組み（環境変数と、ヘッダーによる疑似時計）の名前。もう、入っていないこと */
const REMOVED = ["DEV_CLOCK", "X-Dev-Now"];
/** 本番のコードにある文字列（ビルドが空でないことの確認） */
const PROD = ["invalid request signature", "unauthorized"];

/** Worker をビルドして（デプロイはしない）、できたコードと、ログを返す。defineDev を渡すと、開発のビルドになる */
function build(name: string, defineDev?: boolean): { code: string; log: string } {
  const dir = join(outDir, name);
  const args = ["--filter", "@uc/worker", "exec", "wrangler", "deploy", "--dry-run", "--outdir", dir];
  if (defineDev !== undefined) args.push("--define", `import.meta.env.DEV:${defineDev}`);
  const log = execFileSync("pnpm", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  return { code: readFileSync(join(dir, "index.js"), "utf8"), log };
}

describe("本番のビルド（worker と、載せるダッシュボード）", () => {
  beforeAll(() => {
    // 画面のビルド結果（worker が、同じ Worker から配信する）
    execFileSync("pnpm", ["--filter", "@uc/dashboard", "build"], { cwd: root, stdio: "pipe" });
  }, 120_000);

  it("開発のビルド（define で、DEV を true にする）には、開発専用のコードが入る（この確認が、意味を持つことの確認）", () => {
    const { code } = build("dev", true);

    for (const text of [...DEV_ONLY.filter((text) => text !== "env.DISCORD_API_BASE"), ...PROD]) expect(code, text).toContain(text);
  }, 120_000);

  it("本番のビルド（何も付けない）には、開発専用のコードが、1つも入っていない。本番のコードは、入っている", () => {
    const { code } = build("prod");

    for (const text of [...DEV_ONLY, ...REMOVED]) expect(code, text).not.toContain(text);
    for (const text of PROD) expect(code, text).toContain(text);
  }, 120_000);

  it("ダッシュボード（画面）が、静的ファイルとして、同じ Worker に載る（ワークスペースのパッケージ @uc/dashboard の dist）", () => {
    const { log } = build("assets");

    expect(log).toMatch(/Read \d+ files from the assets directory .*@uc\/dashboard\/dist/);
    expect(log).not.toMatch(/Read 0 files/);
  }, 120_000);
});
