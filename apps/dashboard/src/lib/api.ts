import type { ApiType } from "@uc/worker/api";
import { hc, type ClientRequestOptions } from "hono/client";

/**
 * worker の API を、型付きで呼ぶクライアント（Hono RPC）。
 * `@uc/worker/api` は型だけを参照する（worker のコードはバンドルされない）。
 */
export function createApiClient(baseUrl = "/api", options: ClientRequestOptions = {}) {
  return hc<ApiType>(baseUrl, options);
}

/** 呼び出しのたびに、グローバルの fetch を使う（テストで差し替えられるようにしてある） */
export const api = createApiClient("/api", {
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
});
