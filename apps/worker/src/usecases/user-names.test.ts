import { describe, expect, it } from "vitest";
import { nameOrId, userNames } from "./user-names";

const member = (nick: string | null, global_name: string | null, username: string) => ({ nick, user: { id: "x", username, global_name } });
const rest = (members: Record<string, ReturnType<typeof member>>, calls: string[] = []) => ({
  getGuildMember: async (_guildId: string, userId: string) => {
    calls.push(userId);
    const found = members[userId];
    if (!found) throw new Error("Unknown Member");
    return found;
  },
});

describe("userNames（Discord での表示名）", () => {
  it("サーバーのニックネーム → アカウントの表示名 → ユーザー名の順に使う", async () => {
    const names = await userNames(
      rest({ "1": member("さんぷる", "表示名", "user1"), "2": member(null, "表示名", "user2"), "3": member(null, null, "user3") }),
      "g",
      ["1", "2", "3"],
    );

    expect([...names]).toEqual([["1", "さんぷる"], ["2", "表示名"], ["3", "user3"]]);
  });

  it("同じ人は、1回だけ問い合わせる。空・null は無視する", async () => {
    const calls: string[] = [];
    await userNames(rest({ "1": member(null, null, "a") }, calls), "g", ["1", "1", null, undefined, ""]);

    expect(calls).toEqual(["1"]);
  });

  it("取れなかった人（サーバーを抜けた人など）は、結果に含めない。ほかの人には影響しない", async () => {
    const names = await userNames(rest({ "1": member(null, null, "a") }), "g", ["1", "2"]);

    expect([...names.keys()]).toEqual(["1"]);
    expect(nameOrId(names, "2")).toBe("2");
    expect(nameOrId(names, "1")).toBe("a");
    expect(nameOrId(names, null)).toBeNull();
  });

  it("問い合わせは、25人までにする", async () => {
    const calls: string[] = [];
    await userNames(rest({}, calls), "g", Array.from({ length: 40 }, (_, i) => String(i)));

    expect(calls).toHaveLength(25);
  });
});
