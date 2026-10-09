import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = new URL("../.github/scripts/write-secrets.sh", import.meta.url).pathname;
let dir: string;
let output: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "write-secrets-"));
  output = join(dir, "secrets.env");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (args: string[], env: Record<string, string>) =>
  spawnSync("bash", [script, output, ...args], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

describe(".github/scripts/write-secrets.sh（wrangler の --secrets-file を作る）", () => {
  it("必須と任意の秘密を、NAME=value の行で書く。値の記号（% や \\）は、そのまま", () => {
    const result = run(["--required", "A_TOKEN", "--optional", "B_SECRET"], { A_TOKEN: "a%b\\c", B_SECRET: "bbb" });

    expect(result.status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("A_TOKEN=a%b\\c\nB_SECRET=bbb\n");
  });

  it("任意の秘密が空・未設定なら、書かない", () => {
    expect(run(["--required", "A_TOKEN", "--optional", "B_SECRET"], { A_TOKEN: "a", B_SECRET: "" }).status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("A_TOKEN=a\n");

    expect(run(["--required", "A_TOKEN", "--optional", "B_SECRET"], { A_TOKEN: "a" }).status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("A_TOKEN=a\n");
  });

  it("必須の秘密が空・未設定なら、名前つきのエラーで止まる", () => {
    const result = run(["--required", "A_TOKEN"], { A_TOKEN: "" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("::error::A_TOKEN");
  });

  it("使い方を間違えたとき（知らないオプション・名前がない）は、止まる", () => {
    expect(run(["--mandatory", "A"], { A: "x" }).status).toBe(2);
    expect(run(["--required"], {}).status).toBe(2);
  });

  it("出力ファイルは、自分だけが読める（600）。値は、標準出力・標準エラーに出さない", () => {
    const result = run(["--required", "A_TOKEN"], { A_TOKEN: "secret-value" });

    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(result.stdout + result.stderr).not.toContain("secret-value");
  });
});
