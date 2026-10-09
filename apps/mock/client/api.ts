import { hc } from "hono/client";
import type { MockApiType } from "../server/api";

/** 画面用の API（/mock-api）を、型付きで呼ぶクライアント。呼ぶたびに、いまの fetch を使う（テストで差し替えられる） */
export const mockApi = hc<MockApiType>("/mock-api", {
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});

/** 操作の結果。ok が false なら、notice を、通知に出す */
export type ActionResult = { ok: boolean; notice: string };
