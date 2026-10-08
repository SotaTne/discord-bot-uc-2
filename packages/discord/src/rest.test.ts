import { describe, expect, it } from "vitest";
import { DiscordApiError, createDiscordRest, memberDisplayName } from "./rest";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond();
  };
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("createDiscordRest", () => {
  it("createMessage は Bot トークン付きで POST する", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ id: "m1" }));
    const rest = createDiscordRest({ token: "secret", fetch: fetchImpl });

    const result = await rest.createMessage("c1", {
      content: "募集を開始します",
      allowed_mentions: { parse: [] },
    });

    expect(result).toEqual({ id: "m1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://discord.com/api/v10/channels/c1/messages");
    expect(calls[0]?.init.method).toBe("POST");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bot secret");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      content: "募集を開始します",
      allowed_mentions: { parse: [] },
    });
  });

  it("baseUrl を差し替えると、モックに向けられる（末尾のスラッシュは無視する）", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ id: "m1" }));
    const rest = createDiscordRest({
      token: "t",
      baseUrl: "http://localhost:8788/api/v10/",
      fetch: fetchImpl,
    });

    await rest.createMessage("c1", { content: "x" });

    expect(calls[0]?.url).toBe("http://localhost:8788/api/v10/channels/c1/messages");
  });

  it("editOriginalResponse は Bot トークンを付けず、インタラクションのトークンで PATCH する", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({}));
    const rest = createDiscordRest({ token: "secret", fetch: fetchImpl });

    await rest.editOriginalResponse("app1", "itoken", { content: "完了" });

    expect(calls[0]?.url).toBe("https://discord.com/api/v10/webhooks/app1/itoken/messages/@original");
    expect(calls[0]?.init.method).toBe("PATCH");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("getGuildRoles はロール一覧を返す", async () => {
    const roles = [{ id: "r1", name: "KMU", position: 1 }];
    const { fetchImpl, calls } = fakeFetch(() => json(roles));
    const rest = createDiscordRest({ token: "t", fetch: fetchImpl });

    await expect(rest.getGuildRoles("g1")).resolves.toEqual(roles);
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("getGuildMember はメンバーを返す。表示名は、ニックネーム → 表示名 → ユーザー名の順", async () => {
    const member = { nick: null, user: { id: "u1", username: "taro", global_name: "太郎" } };
    const { fetchImpl, calls } = fakeFetch(() => json(member));
    const rest = createDiscordRest({ token: "t", fetch: fetchImpl });

    const got = await rest.getGuildMember("g1", "u1");

    expect(got).toEqual(member);
    expect(calls[0]?.url).toContain("/guilds/g1/members/u1");
    expect(memberDisplayName(got)).toBe("太郎");
    expect(memberDisplayName({ ...got, nick: "たろちゃん" })).toBe("たろちゃん");
    expect(memberDisplayName({ nick: null, user: { id: "u1", username: "taro" } })).toBe("taro");
  });

  it("エラー応答は DiscordApiError にして、ステータスと本文を持たせる", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("Missing Access", { status: 403 }));
    const rest = createDiscordRest({ token: "t", fetch: fetchImpl });

    const error = await rest.createMessage("c1", { content: "x" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DiscordApiError);
    expect(error).toMatchObject({ status: 403, body: "Missing Access", path: "/channels/c1/messages" });
  });
});
