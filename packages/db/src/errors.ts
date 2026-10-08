/**
 * UNIQUE 制約の違反かどうか。
 * Drizzle はエラーを包んで投げるので、cause をたどって元のエラーの文言を確かめる。
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}
