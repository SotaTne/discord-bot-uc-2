import type { ActionRow } from "@uc/discord";
import { Hono } from "hono";
import type { MockState } from "./state";

/**
 * Discord REST の、worker が使う部分だけを真似たもの。
 * worker は DISCORD_API_BASE をこの URL に向けるだけで、本物と同じコードのまま動く。
 */
export function createDiscordRestRoutes(state: MockState) {
  return new Hono()
    // チャンネルへの投稿（Bot トークンが必要）
    .post("/channels/:channelId/messages", async (c) => {
      if (!c.req.header("Authorization")?.startsWith("Bot ")) {
        return c.json({ message: "401: Unauthorized", code: 0 }, 401);
      }
      const body = (await c.req.json()) as { content?: string; components?: ActionRow[] };
      const message = state.addMessage({
        channelId: c.req.param("channelId"),
        content: body.content ?? "",
        components: body.components,
      });
      return c.json({ id: message.id, channel_id: message.channelId, content: message.content });
    })

    // チャンネルのメッセージの編集（Bot トークンが必要）。ボタンは、空の配列を渡すと消える
    .patch("/channels/:channelId/messages/:messageId", async (c) => {
      if (!c.req.header("Authorization")?.startsWith("Bot ")) {
        return c.json({ message: "401: Unauthorized", code: 0 }, 401);
      }
      const body = (await c.req.json()) as { content?: string; components?: ActionRow[] };
      const current = state.messages.find((m) => m.id === c.req.param("messageId"));
      if (!current) return c.json({ message: "Unknown Message", code: 10008 }, 404);
      state.replaceMessage(current.id, {
        content: body.content ?? current.content,
        components: body.components ?? current.components,
      });
      return c.json({ id: current.id, channel_id: current.channelId, content: body.content ?? current.content });
    })

    // deferred で返した応答の編集（インタラクションのトークンで認証する）
    .patch("/webhooks/:appId/:token/messages/@original", async (c) => {
      const pending = state.getPending(c.req.param("token"));
      if (!pending) {
        return c.json({ message: "Unknown Webhook", code: 10015 }, 404);
      }
      const body = (await c.req.json()) as { content?: string };
      const message = state.addMessage({
        channelId: pending.channelId,
        content: body.content ?? "",
        visibleTo: pending.ephemeral ? pending.userId : null,
      });
      return c.json({ id: message.id, content: message.content });
    })

    .get("/guilds/:guildId/roles", (c) => {
      if (!c.req.header("Authorization")?.startsWith("Bot ")) {
        return c.json({ message: "401: Unauthorized", code: 0 }, 401);
      }
      return c.json(state.roles);
    })

    // メンバー1人（表示名を取るため）。サーバーにいない人は 404
    .get("/guilds/:guildId/members/:userId", (c) => {
      if (!c.req.header("Authorization")?.startsWith("Bot ")) {
        return c.json({ message: "401: Unauthorized", code: 0 }, 401);
      }
      const user = state.userById(c.req.param("userId"));
      if (!user) return c.json({ message: "Unknown Member", code: 10007 }, 404);
      return c.json({ nick: null, user: { id: user.id, username: user.username, global_name: null } });
    });
}
