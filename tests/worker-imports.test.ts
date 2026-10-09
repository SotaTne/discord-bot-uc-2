import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// 開発専用のコード（疑似時計・/dev/*）は、apps/worker/src/dev/ に集める。
// 本番のコードが、そこを読み込んでいないことを、ソースを読んで確かめる（読み込むと、本番のビルドに入ってしまう）。
// ビルドの結果を確かめるテスト（worker-build.test.ts）と、二重に守る。

const srcDir = join(import.meta.dirname, "../apps/worker/src");
const devDir = join(srcDir, "dev");

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

/** 本番のコード。テスト（*.test.ts）と、テスト用の道具（test-helpers.ts）は、含めない */
const production = walk(srcDir).filter(
  (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith("test-helpers.ts") && !file.endsWith(".d.ts") && !file.startsWith(devDir),
);

/** そのファイルが、src/dev/ のファイルを import しているか（相対パスを、実際の場所に直して、調べる） */
function importsDev(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g)].map((match) => match[1]!);
  return specifiers.filter((specifier) => {
    const target = join(file, "..", specifier);
    return target === devDir || target.startsWith(`${devDir}/`);
  });
}

describe("開発専用のコード（apps/worker/src/dev/）は、本番のコードから、読み込まない", () => {
  it("本番のコードを、見つけられている（空ではない）", () => {
    expect(production.length).toBeGreaterThan(30);
    expect(production.map((file) => relative(srcDir, file))).toEqual(expect.arrayContaining(["index.ts", "app.ts", "worker.ts"]));
  });

  it("本番のコードは、src/dev/ を、1 つも import しない", () => {
    const offenders = production.map((file) => ({ file: relative(srcDir, file), imports: importsDev(file) })).filter((entry) => entry.imports.length > 0);

    expect(offenders).toEqual([]);
  });

  it("検出が働く: 開発の入口（src/dev/entry.ts）は、src/dev/ を読み込む（検出できなければ、このテストは、何も見ていない）。本番の入口は、読み込まない", () => {
    expect(importsDev(join(devDir, "entry.ts"))).toEqual(expect.arrayContaining(["./app", "./clock"]));
    expect(importsDev(join(srcDir, "index.ts"))).toEqual([]);
  });
});
