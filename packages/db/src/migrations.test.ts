import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

// マイグレーションの規則を、テストで守らせる。
// - いちど出した（適用した）マイグレーションは、書き換えない。DB を変えるときは、差分（0001、0002…）を足す
// - 差分を足しても、すでにあるデータが、失われない
// - schema.ts と、マイグレーションが、合っている（schema.ts だけを変えて、マイグレーションを作り忘れない）

const packageDir = join(import.meta.dirname, "..");
const migrationsDir = join(packageDir, "migrations");
const migrationFiles = () => readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();

/**
 * 出した（本番の DB に適用した）マイグレーションの、内容の記録（SHA-256）。書き換えると、すでに適用した DB と、食い違う。
 * 本番に適用したら、そのファイルを、ここに足す。DB を変えるときは、既存のファイルを直さずに、差分（次の番号）を足す。
 */
const RELEASED: Record<string, string> = {
  "0000_dazzling_adam_destine.sql": "5c27cc65707745e94ece62ec338ca0054d09d72c3242f5584f538da3bb09a2c4",
};

describe("マイグレーションは、差分で積む", () => {
  it("出したマイグレーションは、書き換えられていない（内容の記録と、同じ）", () => {
    for (const [file, hash] of Object.entries(RELEASED)) {
      const actual = createHash("sha256").update(readFileSync(join(migrationsDir, file))).digest("hex");
      expect(actual, `${file} を書き換えました。出したあとは、差分（次の番号）を足してください`).toBe(hash);
    }
  });

  it("番号が、0000 から、欠けずに並ぶ（途中を消したり、番号を飛ばしたりしない）", () => {
    const numbers = migrationFiles().map((name) => Number(name.slice(0, 4)));

    expect(numbers).toEqual(numbers.map((_, index) => index));
    expect(numbers.length).toBeGreaterThanOrEqual(2);
  });

  it("試合時刻の表の名前の変更（slots → slot_hours）は、すでにあるデータを、残したまま適用できる", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const [baseline, ...rest] = migrationFiles();
    db.exec(readFileSync(join(migrationsDir, baseline!), "utf8")); // すでに出した状態（0000）
    db.prepare("INSERT INTO slots (guild_id, hour, created_at, deleted_at) VALUES (?, ?, ?, ?)").run("g1", 21, 1, null);
    db.prepare("INSERT INTO slots (guild_id, hour, created_at, deleted_at) VALUES (?, ?, ?, ?)").run("g1", 22, 2, 99);

    for (const file of rest) db.exec(readFileSync(join(migrationsDir, file), "utf8")); // 差分を適用

    expect(db.prepare("SELECT hour, deleted_at AS deletedAt FROM slot_hours ORDER BY hour").all()).toEqual([
      { hour: 21, deletedAt: null },
      { hour: 22, deletedAt: 99 },
    ]);
    expect(() => db.prepare("SELECT * FROM slots").all()).toThrow(/no such table/);
    // 制約も、新しい名前で働く（同じ時刻の二重登録・範囲外の時）
    expect(() => db.prepare("INSERT INTO slot_hours (guild_id, hour, created_at) VALUES ('g1', 21, 3)").run()).toThrow(/UNIQUE/);
    expect(() => db.prepare("INSERT INTO slot_hours (guild_id, hour, created_at) VALUES ('g1', 24, 3)").run()).toThrow(/CHECK/);
  });

  it("schema.ts と、マイグレーションが、合っている（schema.ts を変えたら、`pnpm --filter @uc/db exec drizzle-kit generate` で、差分を作る）", () => {
    // マイグレーションのコピーに対して、差分を作らせる。差分があれば、新しいファイルができる（元は、変えない）
    const work = mkdtempSync(join(tmpdir(), "uc-migrations-"));
    const copy = join(work, "migrations");
    cpSync(migrationsDir, copy, { recursive: true });
    const config = join(work, "drizzle.config.mjs");
    writeFileSync(config, `export default ${JSON.stringify({ dialect: "sqlite", schema: "./src/schema.ts", out: relative(packageDir, copy) })};`);
    const before = readdirSync(copy).filter((name) => name.endsWith(".sql"));

    const output = execFileSync("pnpm", ["exec", "drizzle-kit", "generate", "--config", config], { cwd: packageDir, encoding: "utf8", stdio: "pipe" });

    expect(readdirSync(copy).filter((name) => name.endsWith(".sql"))).toEqual(before);
    expect(output).toContain("No schema changes");
  }, 60_000);
});
