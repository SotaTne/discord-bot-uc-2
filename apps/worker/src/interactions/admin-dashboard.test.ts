import { consumeDashboardLink, createSession, findActiveSession } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../security/tokens";
import {
  ADMIN_USER,
  GUILD_ID,
  adminInteraction,
  commandInteraction,
  commandKit,
  contentOf,
  createSeededDb,
  jst,
} from "../test-helpers";
import { saveGuildSettings, defaultGuildSettings } from "@uc/db";
import { LINK_TTL_MS, adminDashboard } from "./admin-dashboard";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
beforeEach(async () => {
  seeded = await createSeededDb();
});

const NOW = jst("2026-10-07T15:00:00");
const issue = (overrides: Parameters<typeof commandKit>[3] = {}) =>
  adminDashboard(commandKit(seeded.db, adminInteraction({ name: "uc-admin-dashboard" }), NOW, overrides).context);

const tokenIn = (response: { data?: { content?: string } }) => /#token=([A-Za-z0-9_-]+)/.exec(contentOf(response))?.[1] ?? "";

describe("/uc-admin-dashboard", () => {
  it("管理者でなければ、リンクを発行しない", async () => {
    const response = await adminDashboard(
      commandKit(seeded.db, commandInteraction({ name: "uc-admin-dashboard" }), NOW).context,
    );
    expect(contentOf(response)).toBe("管理者権限を持たないユーザーはこのコマンドを使えません");
    expect(tokenIn(response)).toBe("");
  });

  it("本人にだけ見える返信で、URL のプレビューを出さずに、/login#token=... のリンクを渡す", async () => {
    const response = await issue({ origin: "https://uc.example.com" });

    expect(contentOf(response)).toMatch(/https:\/\/uc\.example\.com\/login#token=[A-Za-z0-9_-]{43}/);
    expect(response.data?.flags).toBe(64 | 4);
    expect(response.data?.allowed_mentions).toEqual({ parse: [] });
  });

  it("PUBLIC_URL があればそちらを使う（末尾のスラッシュは取る）", async () => {
    const response = await issue({ origin: "http://localhost:8787", env: { PUBLIC_URL: "https://dash.example.com/" } });
    expect(contentOf(response)).toContain("https://dash.example.com/login#token=");
  });

  it("トークンそのものは保存せず、ハッシュだけを保存する", async () => {
    const response = await issue();
    const token = tokenIn(response);

    const links = await seeded.db.query.dashboardLinks.findMany();
    expect(links).toHaveLength(1);
    expect(links[0]?.tokenHash).toBe(await sha256Hex(token));
    expect(JSON.stringify(links)).not.toContain(token);
    expect(links[0]).toMatchObject({ guildId: GUILD_ID, issuedBy: ADMIN_USER, expiresAt: NOW.getTime() + LINK_TTL_MS });
  });

  it("リンクは1回だけ使え、有効期間は1時間", async () => {
    const token = tokenIn(await issue());
    const hash = await sha256Hex(token);

    expect(LINK_TTL_MS).toBe(60 * 60 * 1000);
    expect(await consumeDashboardLink(seeded.db, hash, NOW.getTime() + LINK_TTL_MS - 1)).toEqual({
      guildId: GUILD_ID,
      issuedBy: ADMIN_USER,
    });
    expect(await consumeDashboardLink(seeded.db, hash, NOW.getTime() + 1)).toBeNull();
  });

  it("発行のたびに、別のトークンになる", async () => {
    expect(tokenIn(await issue())).not.toBe(tokenIn(await issue()));
  });

  describe("リンクを再発行したときの、古いセッション", () => {
    const openSession = () =>
      createSession(seeded.db, {
        sessionHash: "old-session", guildId: GUILD_ID, userId: ADMIN_USER, userAgent: null,
        createdAt: 1, expiresAt: NOW.getTime() + 1_000_000,
      });

    it("設定がオフなら、そのまま残す", async () => {
      await openSession();
      const response = await issue();

      expect(await findActiveSession(seeded.db, "old-session", NOW.getTime())).toBeDefined();
      expect(contentOf(response)).not.toContain("無効にしました");
    });

    it("設定がオンなら、すべて失効させて、その件数を伝える", async () => {
      await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, revokeSessionsOnReissue: true }, 1);
      await openSession();

      const response = await issue();

      expect(await findActiveSession(seeded.db, "old-session", NOW.getTime())).toBeUndefined();
      expect(contentOf(response)).toContain("以前のログイン 1 件は、無効にしました。");
    });
  });
});
