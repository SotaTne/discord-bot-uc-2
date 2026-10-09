import { verifyDiscordSignature, type Interaction } from "@uc/discord";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

export type InteractionEnv = { Bindings: AppEnv; Variables: { interaction: Interaction } };

/**
 * Discord からのリクエストの認証。署名（Ed25519）を検証できないリクエストは、401 で止める。
 * 通ったら、解析した Interaction を c.var.interaction に入れる（処理は、検証済みのものだけを使う）。
 */
export const verifyDiscordRequest = createMiddleware<InteractionEnv>(async (c, next) => {
  const signature = c.req.header("X-Signature-Ed25519");
  const timestamp = c.req.header("X-Signature-Timestamp");
  // 署名の対象は、JSON に変換する前の生のボディ
  const body = await c.req.text();

  if (!signature || !timestamp) {
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
