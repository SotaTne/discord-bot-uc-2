import { describe, expect, it } from "vitest";
import { commands } from "./commands";
import { registerAllCommands } from "./register";

type Call = { url: string; method: string; auth: string | undefined; body: unknown };

function fakeDiscord(status = 200) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      auth: (init?.headers as Record<string, string>)?.Authorization,
      body: JSON.parse(String(init?.body ?? "null")),
    });
    const body = commands.map((command) => ({ name: command.name }));
    return new Response(status === 200 ? JSON.stringify(body) : "error", { status });
  };
  return { calls, fetchImpl };
}

const env = { DISCORD_BOT_TOKEN: "bot-token", DISCORD_APPLICATION_ID: "100" };

describe("registerAllCommands", () => {
  it("サーバーを指定しなければ、全サーバー向けに、すべてのコマンドを PUT する", async () => {
    const { calls, fetchImpl } = fakeDiscord();

    const result = await registerAllCommands(env, { fetch: fetchImpl });

    expect(calls).toEqual([
      { url: "https://discord.com/api/v10/applications/100/commands", method: "PUT", auth: "Bot bot-token", body: commands },
    ]);
    expect(result).toMatchObject({ count: commands.length, scope: "global" });
    expect(result.names).toContain("uc-handup");
  });

  it("DISCORD_GUILD_ID があれば、そのサーバーだけに登録する（空文字は、指定なしと同じ）", async () => {
    const guild = fakeDiscord();
    const result = await registerAllCommands({ ...env, DISCORD_GUILD_ID: "200" }, { fetch: guild.fetchImpl });
    expect(guild.calls[0]?.url).toBe("https://discord.com/api/v10/applications/100/guilds/200/commands");
    expect(result.scope).toBe("guild");

    const empty = fakeDiscord();
    expect((await registerAllCommands({ ...env, DISCORD_GUILD_ID: "" }, { fetch: empty.fetchImpl })).scope).toBe("global");
  });

  it("DISCORD_API_BASE があれば、その URL（モック）に登録する", async () => {
    const { calls, fetchImpl } = fakeDiscord();
    await registerAllCommands({ ...env, DISCORD_API_BASE: "http://localhost:8788/api/v10" }, { fetch: fetchImpl });
    expect(calls[0]?.url).toBe("http://localhost:8788/api/v10/applications/100/commands");
  });

  it("トークンやアプリケーション ID がなければ、何も送らずに、理由つきで失敗する", async () => {
    const { calls, fetchImpl } = fakeDiscord();

    await expect(registerAllCommands({ DISCORD_APPLICATION_ID: "100" }, { fetch: fetchImpl })).rejects.toThrow("DISCORD_BOT_TOKEN");
    await expect(registerAllCommands({ DISCORD_BOT_TOKEN: "t" }, { fetch: fetchImpl })).rejects.toThrow("DISCORD_APPLICATION_ID");
    expect(calls).toEqual([]);
  });

  it("Discord がエラーを返したら、失敗する", async () => {
    await expect(registerAllCommands(env, { fetch: fakeDiscord(401).fetchImpl })).rejects.toThrow("401");
  });
});
