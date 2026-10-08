import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

/**
 * リポジトリが受け取る Drizzle のデータベース。
 * 本番の D1（drizzle-orm/d1）も、テスト用のアダプター（createTestDb）も、この型として渡せる。
 */
export type Db = BaseSQLiteDatabase<"async", unknown, typeof schema>;
