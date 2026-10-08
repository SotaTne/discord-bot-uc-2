import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// リポジトリの規約を、vitest 自身で守らせるためのテスト。
// 規約を破ると CI（pnpm test）が落ちる。

const root = join(import.meta.dirname, "..");

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const workspaces = ["apps", "packages"].flatMap((group) =>
  readdirSync(join(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      dir: join(group, entry.name),
      group,
      pkg: JSON.parse(
        readFileSync(join(root, group, entry.name, "package.json"), "utf8"),
      ) as PackageJson,
    })),
);

describe("ワークスペースの規約", () => {
  it("パッケージが1つ以上ある", () => {
    expect(workspaces.length).toBeGreaterThan(0);
  });

  describe.each(workspaces)("$dir", ({ dir, pkg }) => {
    it("名前が @uc/ で始まる", () => {
      expect(pkg.name).toMatch(/^@uc\//);
    });

    it("vitest でテストする（test スクリプトと vitest.config.ts がある）", () => {
      expect(pkg.scripts?.test).toMatch(/^vitest /);
      expect(existsSync(join(root, dir, "vitest.config.ts"))).toBe(true);
    });

    it("typecheck スクリプトがある", () => {
      expect(pkg.scripts?.typecheck).toBeTruthy();
    });

    it("依存のバージョンは catalog: か workspace: で指定する", () => {
      const all = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, version] of Object.entries(all)) {
        expect(version, `${dir}: ${name}`).toMatch(/^(catalog:|workspace:)/);
      }
    });
  });

  it("packages/ は apps/ に依存しない", () => {
    const appNames = new Set(
      workspaces.filter((w) => w.group === "apps").map((w) => w.pkg.name),
    );
    for (const { dir, pkg } of workspaces.filter((w) => w.group === "packages")) {
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      for (const dep of deps) {
        expect(appNames.has(dep), `${dir} が ${dep} に依存している`).toBe(false);
      }
    }
  });

  it("@uc/core は実行時の依存を持たない（純粋なドメイン規則だけ）", () => {
    const core = workspaces.find((w) => w.pkg.name === "@uc/core");
    expect(core).toBeDefined();
    expect(core?.pkg.dependencies ?? {}).toEqual({});
  });
});
