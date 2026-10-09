import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

const encoder = new TextEncoder();

/** 2 つの文字列が同じか。長さや、どこまで合っているかが、時間に出ないように、ハッシュにして、全部のバイトを比べる */
async function sameSecret(actual: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([actual, expected].map(async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))));
  let difference = 0;
  for (let index = 0; index < a!.length; index++) difference |= a![index]! ^ b![index]!;
  return difference === 0;
}

/**
 * cron を外から起こすリクエスト（apps/cron の Google Apps Script）の認証。
 * `Authorization: Bearer <CRON_SECRET>` が合わないリクエストは、401 で止める。
 * CRON_SECRET が未設定（または空）のときは、何を送られても、断る（設定を忘れたときに、誰でも呼べる状態にならない）。
 */
export const requireCronSecret = createMiddleware<{ Bindings: AppEnv }>(async (c, next) => {
  const expected = c.env.CRON_SECRET;
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!expected || !token || !(await sameSecret(token, expected))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});
