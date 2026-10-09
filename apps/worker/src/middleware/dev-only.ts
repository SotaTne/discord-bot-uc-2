import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

/** 開発専用のルートの入口。DEV_CLOCK=true のときだけ通し、それ以外は 404（本番では使えない）。認証は、ない */
export const devOnly = createMiddleware<{ Bindings: AppEnv }>(async (c, next) => {
  if (c.env.DEV_CLOCK !== "true") return c.json({ error: "not found" }, 404);
  await next();
});
