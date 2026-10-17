import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// worker のコードの層（SPEC.md「worker のコードの構成」）を、ソースを読んで確かめる。
//   入口: interactions/（Discord）・api/（ダッシュボード）・scheduled/（cron）
//   意図: usecases/（状態の変更と、あとの片付け）
//   文面と投稿: messages/
// 依存の向きは、入口 → usecase → messages。逆向きや、入口どうしの依存を、禁じる。
// （入口どうしが依存すると、片付けを、入口ごとに書き直す形に、戻ってしまう）

const srcDir = join(import.meta.dirname, "../apps/worker/src");

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

/** 本番のコード。テスト（*.test.ts）と、テスト用の道具は、含めない */
const production = walk(srcDir).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith("test-helpers.ts") && !file.endsWith(".d.ts"));

const inDir = (dir: string) => production.filter((file) => file.startsWith(join(srcDir, dir) + "/"));

/** そのファイルが読み込んでいるもの: 相対パスは、実際の場所（src からの相対）に直し、パッケージは、そのままの名前 */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]!);
  return specifiers.map((specifier) => (specifier.startsWith(".") ? relative(srcDir, join(file, "..", specifier)) : specifier));
}

const offenders = (dir: string, forbidden: (target: string) => boolean) =>
  inDir(dir).flatMap((file) =>
    importsOf(file)
      .filter(forbidden)
      .map((target) => `${relative(srcDir, file)} → ${target}`),
  );

const ENTRY_DIRS = ["interactions", "api", "scheduled"];
const isEntry = (target: string) => ENTRY_DIRS.some((dir) => target === dir || target.startsWith(`${dir}/`));

describe("worker のコードの層", () => {
  it("各層を、見つけられている（空ではない）", () => {
    for (const dir of [...ENTRY_DIRS, "usecases", "messages"]) expect(inDir(dir).length, dir).toBeGreaterThan(0);
  });

  it("usecases/ は、入口（interactions・api・scheduled）を、読み込まない", () => {
    expect(offenders("usecases", isEntry)).toEqual([]);
  });

  it("usecases/ は、Hono（ダッシュボードの入口の道具）を、読み込まない。Discord の Interaction（入口の型）も、読み込まない", () => {
    const interactionImports = inDir("usecases").flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /^import .*\bInteraction\b/.test(line) || /from "hono/.test(line))
        .map((line) => `${relative(srcDir, file)}: ${line.trim()}`),
    );

    expect(interactionImports).toEqual([]);
  });

  it("messages/ は、usecases・入口を、読み込まない（文面と投稿は、いちばん下の層）", () => {
    expect(offenders("messages", (target) => isEntry(target) || target === "usecases" || target.startsWith("usecases/"))).toEqual([]);
  });

  it("入口どうしは、読み込み合わない（interactions・api・scheduled は、それぞれ、usecase を呼ぶ）。共通の道具（caller・registry）は、同じ入口の中だけ", () => {
    const crossing = ENTRY_DIRS.flatMap((dir) => offenders(dir, (target) => isEntry(target) && !(target === dir || target.startsWith(`${dir}/`))));

    expect(crossing).toEqual([]);
  });
});
