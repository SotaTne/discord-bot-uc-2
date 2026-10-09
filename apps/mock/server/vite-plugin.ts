import { getRequestListener } from "@hono/node-server";
import type { Plugin, ViteDevServer } from "vite";
import type { MockEnv } from "./index";

/** サーバーを担当するパス。それ以外（画面）は、Vite がそのまま返す */
const SERVER_PATHS = /^\/(api\/v10|attachments|mock-api)(\/|\?|$)/;

type Persisted = { state?: unknown; keys?: unknown };
/** コードを変えて読み込み直されても、状態（メッセージなど）と鍵を保つための入れ物 */
const persisted = ((globalThis as { __ucMock?: Persisted }).__ucMock ??= {});

/**
 * 疑似 Discord のサーバー（Discord のサーバー役 + 画面用の API）を、Vite の開発サーバーに載せる。
 * サーバーのコード（server/）を変えると、次のリクエストから、新しいコードで動く。メッセージなどの状態は、消えない。
 */
export function mockServerPlugin(options: { env?: MockEnv } = {}): Plugin {
  let cache: { module: unknown; handler: ReturnType<typeof getRequestListener> } | undefined;

  async function handlerFor(server: ViteDevServer) {
    const module = (await server.ssrLoadModule("/server/index.ts")) as typeof import("./index");
    persisted.keys ??= await module.loadKeys();
    persisted.state ??= module.createState();
    if (cache?.module !== module) {
      const app = module.buildMockApp({ state: persisted.state as never, keys: persisted.keys as never, env: options.env ?? {} });
      cache = { module, handler: getRequestListener(app.fetch) };
    }
    return cache.handler;
  }

  return {
    name: "uc-mock-server",
    apply: "serve",
    async configureServer(server) {
      const module = (await server.ssrLoadModule("/server/index.ts")) as typeof import("./index");
      persisted.keys ??= await module.loadKeys();
      const publicKey = (persisted.keys as { publicKeyHex: string }).publicKeyHex;
      server.httpServer?.once("listening", () => {
        console.log("worker の apps/worker/.dev.vars に、次の公開鍵を設定してください（`pnpm dev` なら、自動で設定されます）:");
        console.log(`DISCORD_PUBLIC_KEY=${publicKey}`);
      });

      server.middlewares.use(async (request, response, next) => {
        if (!SERVER_PATHS.test(request.url ?? "")) return next();
        try {
          return (await handlerFor(server))(request, response);
        } catch (error) {
          server.ssrFixStacktrace(error as Error);
          return next(error);
        }
      });
    },
  };
}
