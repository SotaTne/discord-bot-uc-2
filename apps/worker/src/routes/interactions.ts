import type { Clock } from "@uc/core";
import {
  InteractionType,
  ephemeralMessage,
  pong,
  verifyDiscordSignature,
  type Interaction,
} from "@uc/discord";
import { Hono } from "hono";
import { componentHandlers, commandHandlers, type CommandHandler } from "../commands/registry";
import { resolveClock } from "../clock";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import type { AppEnv } from "../env";

export type InteractionsDeps = {
  clock: Clock;
  /** 応答後に続ける処理の登録先。省略すると、Workers の ExecutionContext.waitUntil を使う */
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
  fetch?: typeof fetch | undefined;
};

/** Discord からの Interactions を受ける。署名を検証できないリクエストは処理しない */
export function createInteractionsRoute(deps: InteractionsDeps) {
  return new Hono<{ Bindings: AppEnv }>().post("/", async (c) => {
    const signature = c.req.header("X-Signature-Ed25519");
    const timestamp = c.req.header("X-Signature-Timestamp");
    // 署名の対象は、JSON に変換する前の生のボディ
    const body = await c.req.text();

    if (!signature || !timestamp) {
      return c.json({ error: "invalid request signature" }, 401);
    }
    const valid = await verifyDiscordSignature({
      publicKey: c.env.DISCORD_PUBLIC_KEY,
      signature,
      timestamp,
      body,
    });
    if (!valid) {
      return c.json({ error: "invalid request signature" }, 401);
    }

    let interaction: Interaction;
    try {
      interaction = JSON.parse(body) as Interaction;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    if (interaction.type === InteractionType.Ping) {
      return c.json(pong());
    }

    let handler: CommandHandler | undefined;
    let label = "";
    if (interaction.type === InteractionType.ApplicationCommand) {
      label = interaction.data?.name ?? "";
      handler = commandHandlers[label];
      if (!handler) return c.json(ephemeralMessage("このコマンドはまだ使えません"));
    } else if (interaction.type === InteractionType.MessageComponent) {
      label = interaction.data?.custom_id ?? "";
      handler = componentHandlers[label.split(":")[0] ?? ""];
      if (!handler) return c.json(ephemeralMessage("この操作は無効です"));
    } else {
      return c.json({ error: "unsupported interaction type" }, 400);
    }

    const waitUntil =
      deps.waitUntil ??
      ((promise: Promise<unknown>) => {
        try {
          c.executionCtx.waitUntil(promise);
        } catch {
          // ExecutionContext がない環境（テストなど）では、完了を待たずに続ける
          promise.catch(() => undefined);
        }
      });

    try {
      return c.json(
        await handler({
          interaction,
          env: c.env,
          // 開発用の疑似時計が有効なときだけ、X-Dev-Now ヘッダーで時刻を固定できる
          clock: resolveClock(deps.clock, c.env, c.req.header("X-Dev-Now")),
          baseClock: deps.clock,
          db: createDb(c.env.DB),
          rest: createRestFromEnv(c.env),
          // グローバルの fetch を、そのままプロパティに入れて呼ぶと、Workers では Illegal invocation になる。関数で包む
          fetch: deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args)),
          sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
          origin: new URL(c.req.url).origin,
          waitUntil,
        }),
      );
    } catch (error) {
      // 予期しないエラーでも、Discord には「失敗しました」と返す（無応答だとユーザーに何も表示されない）
      console.error(`処理に失敗しました: ${label}`, error);
      return c.json(ephemeralMessage("コマンドの処理中にエラーが発生しました"));
    }
  });
}
