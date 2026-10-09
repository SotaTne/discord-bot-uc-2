import { fileURLToPath } from "node:url";
import { createMockApp } from "./app";
import { createWorkerDev } from "./api/worker-dev";
import { createDiscordServer, createMockState, type MockState } from "./discord";
import { loadOrCreateDevKeys } from "./keys";
import { defaultSeed } from "./seed";
import type { DevKeyPair } from "@uc/discord/testing";

export type MockEnv = Partial<Record<"PORT" | "WORKER_URL" | "MOCK_URL" | "DISCORD_APPLICATION_ID", string | undefined>>;

/** 鍵（.dev-keys.json に保存される）を読む。なければ作る */
export const loadKeys = () => loadOrCreateDevKeys(fileURLToPath(new URL("../.dev-keys.json", import.meta.url)));

/** 世界の状態（メッセージなど）は、プロセスの中のメモリにだけ持つ。再起動すると、消える */
export const createState = () => createMockState(defaultSeed());

/**
 * 疑似 Discord のサーバー（Hono のアプリ）を、状態と鍵から作る。
 * 状態と鍵は、呼び出す側が持ち回る（Vite の開発サーバーは、コードの変更のたびに、これを呼び直すが、状態は保つため）。
 */
export function buildMockApp(input: { state: MockState; keys: DevKeyPair; env?: MockEnv }) {
  const { state, keys, env = {} } = input;
  const port = Number(env.PORT ?? 8788);
  const workerUrl = env.WORKER_URL ?? "http://localhost:8787";
  const mockUrl = env.MOCK_URL ?? `http://localhost:${port}`;
  const applicationId = env.DISCORD_APPLICATION_ID ?? "100000000000000001";

  const discord = createDiscordServer({ workerUrl, mockUrl, keys, applicationId }, state);
  const workerDev = createWorkerDev({ workerUrl }, state);
  // 実際の開発サーバーでは、時計が動いている間、cron（毎分）を、自動で実行する
  return createMockApp({ state, interactions: discord.interactions, workerDev, discord, autoTick: true });
}
