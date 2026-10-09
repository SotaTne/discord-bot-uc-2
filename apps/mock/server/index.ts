import { fileURLToPath } from "node:url";
import { createMockApp } from "./app";
import { createWorkerDev } from "./api/worker-dev";
import { createDiscordServer, createMockState } from "./discord";
import { loadOrCreateDevKeys } from "./keys";
import { defaultSeed } from "./seed";

export type MockEnv = Partial<Record<"PORT" | "WORKER_URL" | "MOCK_URL" | "DISCORD_APPLICATION_ID", string>>;

/**
 * 疑似 Discord の、いまのサーバーを作る（鍵の読み込みがあるので、async）。
 * 世界の状態（メッセージなど）は、プロセスの中のメモリにだけ持つ。
 * 開発サーバー（Vite）が、コードの変更で、このファイルを読み直しても、状態を失わないように、呼び出す側（vite.config.ts）が、結果を使い回す。
 */
export async function createMockServer(env: MockEnv = {}) {
  const port = Number(env.PORT ?? 8788);
  const workerUrl = env.WORKER_URL ?? "http://localhost:8787";
  const mockUrl = env.MOCK_URL ?? `http://localhost:${port}`;
  const applicationId = env.DISCORD_APPLICATION_ID ?? "100000000000000001";

  const keys = await loadOrCreateDevKeys(fileURLToPath(new URL("../.dev-keys.json", import.meta.url)));
  const state = createMockState(defaultSeed());
  const discord = createDiscordServer({ workerUrl, mockUrl, keys, applicationId }, state);
  const workerDev = createWorkerDev({ workerUrl }, state);
  const app = createMockApp({ state, interactions: discord.interactions, workerDev, discord });
  return { app, state, keys, workerUrl, mockUrl, port };
}
