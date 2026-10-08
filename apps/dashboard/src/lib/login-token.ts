import { loginInputSchema } from "@uc/api";

/**
 * ログインリンク（/login#token=...）のフラグメントからトークンを取り出す。
 * フラグメントはサーバーに送られないので、ログやリファラーにトークンが残らない。
 * 形式が正しくなければ null。
 */
export function parseLoginToken(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const result = loginInputSchema.safeParse({ token: params.get("token") });
  return result.success ? result.data.token : null;
}
