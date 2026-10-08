import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

/** セッションの有効期間（発行から7日。使っても延びない） */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * https のときは `__Host-` プレフィックスつきの名前と Secure を使う（別のサブドメインから上書きされない）。
 * 開発中の http://localhost では、Secure が使えないので、プレフィックスなしにする。
 */
const isSecure = (c: Context) => new URL(c.req.url).protocol === "https:";
const cookieName = (secure: boolean) => (secure ? "__Host-uc_session" : "uc_session");

export function readSessionToken(c: Context): string | undefined {
  return getCookie(c, cookieName(isSecure(c)));
}

export function writeSessionCookie(c: Context, token: string): void {
  const secure = isSecure(c);
  setCookie(c, cookieName(secure), token, {
    httpOnly: true,
    secure,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context): void {
  const secure = isSecure(c);
  deleteCookie(c, cookieName(secure), { path: "/", secure });
}
