import type { Clock } from "@uc/core";
import type { AppEnv } from "../env";

/** ログイン済みのセッションから分かること。認証を通ったリクエストだけが持つ */
export type AuthContext = { guildId: string; userId: string; sessionId: number };

export type ApiEnv = { Bindings: AppEnv; Variables: { auth: AuthContext } };

export type ApiDeps = {
  /** 現在時刻。セッションの期限などの判定に使う */
  clock: Clock;
};

/** パスの ID（正の整数）を取り出す。不正なら null */
export function parseId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
