import { drizzle } from "drizzle-orm/d1";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import * as schema from "./schema";

const migrationsDir = join(import.meta.dirname, "..", "migrations");

/**
 * テスト用のメモリ上の SQLite を作り、本番と同じマイグレーションを適用する。
 * D1 は SQLite なので、制約やインデックスの振る舞いをそのまま確かめられる。
 */
export function createTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  return db;
}

class TestD1Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new TestD1Statement(this.db, this.sql, params as SQLInputValue[]);
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params);
    return { results, success: true as const, meta: {} };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return {
      results: [],
      success: true as const,
      meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
    };
  }

  async first(column?: string) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (row === undefined) return null;
    return column === undefined ? row : (row[column] ?? null);
  }

  async raw() {
    const statement = this.db.prepare(this.sql);
    statement.setReturnArrays(true);
    return statement.all(...this.params);
  }
}

/**
 * D1 の `prepare().bind().all()/run()/raw()` と `batch()` だけを真似た、テスト用のアダプター。
 * Drizzle（drizzle-orm/d1）から、本番と同じクエリをそのまま実行できる。
 * Workers の型（D1Database）は、使う側で `as unknown as D1Database` として渡す。
 */
export function createTestD1(db: DatabaseSync = createTestDatabase()) {
  return {
    prepare: (sql: string) => new TestD1Statement(db, sql),
    async batch(statements: TestD1Statement[]) {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.all());
      }
      return results;
    },
    /** テストから直接 SQL で確かめたいときに使う、元のデータベース */
    database: db,
  };
}

/** リポジトリのテスト用。本物と同じ Drizzle のクエリを、メモリ上の SQLite に対して実行する */
export function createTestDb() {
  const d1 = createTestD1();
  return drizzle(d1 as unknown as Parameters<typeof drizzle>[0], { schema });
}
