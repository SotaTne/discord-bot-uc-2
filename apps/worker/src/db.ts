import * as schema from "@uc/db";
import { drizzle } from "drizzle-orm/d1";

/** D1 を Drizzle 経由で使う。DB へのアクセスは、必ずこの関数が返すクライアントを通す */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
