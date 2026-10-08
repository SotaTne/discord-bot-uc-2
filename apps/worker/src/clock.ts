import type { Clock } from "@uc/core";
import { fixedClock } from "@uc/core";
import type { AppEnv } from "./env";

/**
 * リクエストごとの時計を決める。
 * 開発用の疑似時計が有効（DEV_CLOCK=true）で、X-Dev-Now ヘッダーに正しい日時があれば、その日時に固定する。
 * それ以外は、渡された時計をそのまま使う（本番ではヘッダーを無視する）。
 */
export function resolveClock(base: Clock, env: Pick<AppEnv, "DEV_CLOCK">, devNow: string | null | undefined): Clock {
  if (env.DEV_CLOCK !== "true" || !devNow) return base;
  const at = new Date(devNow);
  return Number.isNaN(at.getTime()) ? base : fixedClock(at);
}
