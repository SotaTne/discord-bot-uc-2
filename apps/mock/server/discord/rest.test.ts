import { createDiscordRest } from "@uc/discord";
import { beforeEach, describe, expect, it } from "vitest";
import { createDiscordRestRoutes } from "./rest";
import { defaultSeed } from "../seed";
import { createMockState, type MockState } from "./state";

let state: MockState;

beforeEach(() => {
  state = createMockState(defaultSeed());
});

const bot = { Authorization: "Bot dev-token", "Content-Type": "application/json" };

describe("Discord REST のモック", () => {
  it("チャンネルへの投稿が、公開メッセージとして保存される", async () => {
    const app = createDiscordRestRoutes(state);
    const response = await app.request("/channels/c1/messages", {
      method: "POST",
      headers: bot,
      body: JSON.stringify({ content: "募集を開始します" }),
    });

    expect(response.status).toBe(200);
    expect(state.messages).toMatchObject([{ channelId: "c1", content: "募集を開始します", visibleTo: null }]);
  });

  it("Bot トークンがなければ 401", async () => {
    const app = createDiscordRestRoutes(state);
    const response = await app.request("/channels/c1/messages", {
      method: "POST",
      body: JSON.stringify({ content: "x" }),
    });
    expect(response.status).toBe(401);
    expect(state.messages).toHaveLength(0);
  });

  it("deferred の応答を編集すると、実行したユーザーにだけ見えるメッセージになる", async () => {
    const alice = state.users[0]!;
    state.markPending("tok", { userId: alice.id, channelId: state.channelId, ephemeral: true });

    const app = createDiscordRestRoutes(state);
    const response = await app.request("/webhooks/app1/tok/messages/@original", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "挙手を受け付けました" }),
    });

    expect(response.status).toBe(200);
    expect(state.messages).toMatchObject([{ content: "挙手を受け付けました", visibleTo: alice.id }]);
  });

  it("知らないインタラクションのトークンは 404", async () => {
    const app = createDiscordRestRoutes(state);
    const response = await app.request("/webhooks/app1/unknown/messages/@original", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x" }),
    });
    expect(response.status).toBe(404);
  });

  it("ロール一覧を返す", async () => {
    const app = createDiscordRestRoutes(state);
    const response = await app.request(`/guilds/${state.guildId}/roles`, { headers: bot });
    const roles = (await response.json()) as { name: string }[];
    expect(roles.map((r) => r.name)).toContain("KMU");
  });

  it("worker が使う @uc/discord の REST クライアントから、そのまま呼べる", async () => {
    const mock = createDiscordRestRoutes(state);
    const baseUrl = "http://mock.local/api/v10";
    const rest = createDiscordRest({
      token: "dev-token",
      baseUrl,
      // ネットワークを使わず、モックのアプリに直接渡す（本番の mock サーバーは /api/v10 に載せている）
      fetch: async (input, init) => mock.request(String(input).replace(baseUrl, ""), init),
    });

    await rest.createMessage("c1", { content: "締切です" });
    const roles = await rest.getGuildRoles(state.guildId);

    expect(state.messages.map((m) => m.content)).toEqual(["締切です"]);
    expect(roles.length).toBeGreaterThan(0);
  });
});
