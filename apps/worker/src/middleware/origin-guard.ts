import { createMiddleware } from "hono/factory";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 状態を変える操作（POST / PUT / PATCH / DELETE）は、同じオリジンからのリクエストだけを受け付ける。
 * SameSite=Strict の Cookie と合わせて、CSRF を防ぐ。
 */
export const originGuard = createMiddleware(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin !== new URL(c.req.url).origin) {
      return c.json({ error: "forbidden" }, 403);
    }
  }
  await next();
});
