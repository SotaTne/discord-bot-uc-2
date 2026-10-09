import { verifyDiscordSignature, type Interaction } from "@uc/discord";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

export type InteractionEnv = { Bindings: AppEnv; Variables: { interaction: Interaction } };

/** 署名の時刻（秒）が、いまの時刻から、これ以上ずれているリクエストは、断る（再送攻撃への対策。時計のずれも、この範囲で許す） */
export const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

/** 署名の時刻が、いまの時刻の前後 MAX_SIGNATURE_AGE_SECONDS 秒以内か。判定には、本物の時刻を使う（疑似時計は、使わない） */
export function isFreshTimestamp(timestamp: string, nowMs: number = Date.now()): boolean {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  return Math.abs(nowMs / 1000 - Number(timestamp)) <= MAX_SIGNATURE_AGE_SECONDS;
}

/**
 * Discord からのリクエストの認証。署名（Ed25519）を検証できないリクエストと、署名の時刻が古い（または、先の）リクエストは、401 で止める。
 * 時刻を見ないと、一度でも盗まれた署名つきのリクエストを、あとから何度でも、送り直せてしまう（再送攻撃）。
 * 通ったら、解析した Interaction を c.var.interaction に入れる（処理は、検証済みのものだけを使う）。
 */
export const verifyDiscordRequest = createMiddleware<InteractionEnv>(async (c, next) => {
  const signature = c.req.header("X-Signature-Ed25519");
  const timestamp = c.req.header("X-Signature-Timestamp");
  // 署名の対象は、JSON に変換する前の生のボディ
  const body = await c.req.text();

  if (!signature || !timestamp || !isFreshTimestamp(timestamp)) {
    return c.json({ error: "invalid request signature" }, 401);
  }
  const valid = await verifyDiscordSignature({ publicKey: c.env.DISCORD_PUBLIC_KEY, signature, timestamp, body });
  if (!valid) {
    return c.json({ error: "invalid request signature" }, 401);
  }

  try {
    c.set("interaction", JSON.parse(body) as Interaction);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  await next();
});
