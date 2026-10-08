import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { createMockApp } from "./app";
import { loadOrCreateDevKeys } from "./dev-keys";
import { createInteractionClient } from "./interaction-client";
import { defaultSeed } from "./seed";
import { createMockState } from "./state";

const port = Number(process.env.PORT ?? 8788);
const workerUrl = process.env.WORKER_URL ?? "http://localhost:8787";
const applicationId = process.env.DISCORD_APPLICATION_ID ?? "100000000000000001";

const keys = await loadOrCreateDevKeys(fileURLToPath(new URL("../.dev-keys.json", import.meta.url)));
const state = createMockState(defaultSeed());
const mockUrl = process.env.MOCK_URL ?? `http://localhost:${port}`;
const interactions = createInteractionClient({ workerUrl, mockUrl, keys, applicationId }, state);
const app = createMockApp({ state, interactions, publicKeyHex: keys.publicKeyHex, workerUrl });

serve({ fetch: app.fetch, port }, () => {
  console.log(`疑似 Discord: http://localhost:${port}`);
  console.log(`worker の apps/worker/.dev.vars に次の公開鍵を設定してください:`);
  console.log(`DISCORD_PUBLIC_KEY=${keys.publicKeyHex}`);
});
