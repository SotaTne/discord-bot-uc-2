import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// 本番のビルドに、開発専用のコード（疑似時計・/dev/*）が入っていないことを、実際にビルドして確かめる
// （`wrangler deploy --dry-run`。ログインは要らない）。
// 開発専用のコードは、src/dev/ に集め、本番の入口（src/index.ts）は、そこを読み込まない。入口が違うだけで、分岐も、ビルドの設定も、使わない。
// 画面（ダッシュボード）は、ワークスペースのパッケージ（@uc/dashboard）として、Worker に載る。

const root = join(import.meta.dirname, "..");
const outDir = mkdtempSync(join(tmpdir(), "uc-worker-"));

/** 開発専用のコードにだけある文字列（疑似時計・/dev/* のルート） */
const DEV_ONLY = ["invalid_clock", "getDevClockState", "no_guild", "createDevRoutes", "devClock"];
/** 今は、どこにも書かれていない、古い仕組み（環境変数と、ヘッダーによる疑似時計）の名前。もう、入っていないこと */
const REMOVED = ["DEV_CLOCK", "X-Dev-Now"];
/** 本番のコードにある文字列（ビルドが空でないことの確認） */
const PROD = ["invalid request signature", "unauthorized"];

/** Worker をビルドして（デプロイはしない）、できたコードと、ログを返す。entry を渡すと、その入口からビルドする（既定は、wrangler.jsonc の main = 本番の入口） */
function build(name: string, entry?: string): { code: string; log: string } {
  const dir = join(outDir, name);
  const args = ["--filter", "@uc/worker", "exec", "wrangler", "deploy", ...(entry ? [entry] : []), "--env", "production", "--dry-run", "--outdir", dir];
  const log = execFileSync("pnpm", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  // できたコードは、入口のファイル名（index.js / entry.js）で、出る
  const file = readdirSync(dir).find((name) => name.endsWith(".js"))!;
  return { code: readFileSync(join(dir, file), "utf8"), log };
}

describe("本番のビルド（worker と、載せるダッシュボード）", () => {
  beforeAll(() => {
    // 画面のビルド結果（worker が、同じ Worker から配信する）
    execFileSync("pnpm", ["--filter", "@uc/dashboard", "build"], { cwd: root, stdio: "pipe" });
  }, 120_000);

  it("開発の入口（src/dev/entry.ts）からのビルドには、開発専用のコードが入る（この確認が、意味を持つことの確認）", () => {
    const { code } = build("dev", "src/dev/entry.ts");

    for (const text of [...DEV_ONLY, ...PROD]) expect(code, text).toContain(text);
  }, 120_000);

  it("本番の入口（src/index.ts。何も付けない）からのビルドには、開発専用のコードが、1つも入っていない。本番のコードは、入っている", () => {
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
