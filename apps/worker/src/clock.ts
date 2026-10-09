import { systemClock, type Clock } from "@uc/core";
import { devClock } from "./dev/clock";

/**
 * アプリが使う時計。本番は、本物の時計そのもの。
 * 開発のとき（`import.meta.env.DEV`）だけ、疑似時計（本物の時刻 + ずれ）にする。
 * 本番のビルドでは、`import.meta.env.DEV` が false に置き換わり、疑似時計のコードごと消える。
 */
export function appClock(base: Clock = systemClock): Clock {
  return import.meta.env.DEV ? devClock(base) : base;
}
