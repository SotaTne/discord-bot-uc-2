import type { Clock } from "@uc/core";
import {
  InteractionType,
  ephemeralMessage,
  pong,
} from "@uc/discord";
import { Hono } from "hono";
import { componentHandlers, commandHandlers, type CommandHandler } from "../commands/registry";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { verifyDiscordRequest, type InteractionEnv } from "../middleware/discord-signature";

export type InteractionsDeps = {
  clock: Clock;
  /** 応答後に続ける処理の登録先。省略すると、Workers の ExecutionContext.waitUntil を使う */
  waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
  fetch?: typeof fetch | undefined;
};

/** Discord からの Interactions を受ける。署名の検証は、middleware（verifyDiscordRequest）で済んでいる */
export function createInteractionsRoute(deps: InteractionsDeps) {
  return new Hono<InteractionEnv>().use(verifyDiscordRequest).post("/", async (c) => {
    const interaction = c.get("interaction");

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
          clock: deps.clock,
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
