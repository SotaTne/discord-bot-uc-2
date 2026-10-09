import { fixedClock } from "@uc/core";
import { listWins, saveMatchResult } from "@uc/db";
import { generateDevKeyPair, signRequest } from "@uc/discord/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { devClock, setDevClockState } from "../dev/clock";
import type { AppEnv } from "../env";
import {
  GUILD_ID,
  adminInteraction,
  commandInteraction,
  createFakeR2,
  createSeededDb,
  insertWinInSlot,
  jst,
  timeOption,
} from "../test-helpers";

let keys: Awaited<ReturnType<typeof generateDevKeyPair>>;
beforeAll(async () => {
  keys = await generateDevKeyPair();
});

// 署名の時刻は、本物の時刻の前後 5 分以内でなければ、断られる。テストの署名の時刻（1700000000）に、本物の時刻を合わせる
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_700_000_000 * 1000);
});
afterEach(() => {
  vi.useRealTimers();
});

async function send(
  app: ReturnType<typeof createApp>,
  env: Partial<AppEnv>,
  interaction: unknown,
  headers: Record<string, string> = {},
) {
  const body = JSON.stringify(interaction);
  const timestamp = "1700000000";
  const signature = await signRequest({ privateKey: keys.privateKey, timestamp, body });
  const response = await app.request(
    "/interactions",
    {
      method: "POST",
      headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp, ...headers },
      body,
    },
    { DISCORD_PUBLIC_KEY: keys.publicKeyHex, ...env } as AppEnv,
  );
  return (await response.json()) as { type: number; data?: { content?: string } };
}

describe("疑似時計（開発のときだけ。worker の時計に従う）", () => {
  const handup = commandInteraction({ name: "uc-handup", options: [timeOption(21)] });

  afterEach(() => setDevClockState({ offsetMs: 0 }));

  it("コマンドは、worker の時計（疑似時計）で動く。時計を進めて（本物 + ずれ）、受付時間の中にできる", async () => {
    const seeded = await createSeededDb();
    // 本物の時計は、受付時間外（23 時）。9 時間戻すと、14 時（受付中）
    const app = createApp({ clock: devClock(fixedClock(jst("2026-10-07T23:00:00"))) });
    setDevClockState({ offsetMs: -9 * 3_600_000 });

    const json = await send(app, { DB: seeded.db.$client }, handup);

    expect(json.data?.content).toContain("21時の試合に挙手しました");
  });

  it("ヘッダー（X-Dev-Now）は、もう使わない。付けても、無視される", async () => {
    const seeded = await createSeededDb();
    const app = createApp({ clock: fixedClock(jst("2026-10-07T23:00:00")) });

    const json = await send(app, { DB: seeded.db.$client }, handup, { "X-Dev-Now": "2026-10-07T15:00:00+09:00" });

    expect(json.data?.content).toBe("受付は終了しました（試合開始の7分前までです）");
  });
});

describe("ボタン（コンポーネント）の経路", () => {
  const app = () => createApp({ clock: fixedClock(jst("2026-10-07T15:00:00")) });

  it("custom_id の接頭辞で処理を選び、メッセージを置き換える", async () => {
    const seeded = await createSeededDb();
    await insertWinInSlot(seeded.db, { guildId: GUILD_ID, teamId: seeded.kmuId, slotDate: "2026-10-06", slotHour: 21, points: 1, screenshotKey: null, recordedBy: "a", createdAt: 1 });
    const json = await send(app(), { DB: seeded.db.$client, SCREENSHOTS: createFakeR2().bucket }, adminInteraction({ customId: "score-clear:confirm" }));

    expect(json.type).toBe(7);
    expect(json.data?.content).toBe("すべてのチームの得点と、勝利の履歴・組分けを削除しました");
    expect(await listWins(seeded.db, GUILD_ID)).toHaveLength(0);
  });

  it("知らない接頭辞のボタンは、無効として本人にだけ返す", async () => {
    const seeded = await createSeededDb();
    const json = await send(app(), { DB: seeded.db.$client }, adminInteraction({ customId: "unknown:x" }));

    expect(json.type).toBe(4);
    expect(json.data?.content).toBe("この操作は無効です");
  });
});

describe("Workers の fetch の制約（this が違うと Illegal invocation になる）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("グローバルの fetch を、そのままプロパティに入れて呼ばなくても、画像つきの勝利の記録が最後まで通る", async () => {
    const calls: string[] = [];
    // Workers の fetch と同じく、this が undefined（または globalThis）以外で呼ばれたら例外にする
    const strictFetch = function (this: unknown, input: RequestInfo | URL): Promise<Response> {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      const url = String(input);
      calls.push(url);
      return Promise.resolve(
        url.includes("/webhooks/")
          ? new Response("{}")
          : new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } }),
      );
    };
    vi.stubGlobal("fetch", strictFetch);

    const seeded = await createSeededDb();
    await saveMatchResult(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, seeded.utId]], now: 1 });
    const pending: Promise<unknown>[] = [];
    const r2 = createFakeR2();
    const app = createApp({
      clock: fixedClock(jst("2026-10-07T22:30:00")),
      waitUntil: (promise) => void pending.push(promise),
    });
    const env = {
      DB: seeded.db.$client,
      SCREENSHOTS: r2.bucket,
      DISCORD_BOT_TOKEN: "t",
      DISCORD_API_BASE: "http://discord.mock/api/v10",
    };

    const json = await send(
      app,
      env,
      adminInteraction({
        name: "uc-admin-win",
        options: [
          timeOption(21),
          { name: "team-role", type: 8, value: "400000000000000001" },
          { name: "point", type: 4, value: 80 },
          { name: "image", type: 11, value: "900" },
        ],
        attachments: { "900": { id: "900", url: "https://cdn.example/a.png", filename: "a.png", content_type: "image/png", size: 3 } },
      }),
    );
    await Promise.all(pending);

    expect(json.type).toBe(5);
    expect(calls).toEqual(["https://cdn.example/a.png", "http://discord.mock/api/v10/webhooks/100000000000000001/test-token/messages/@original"]);
    expect(await listWins(seeded.db, GUILD_ID)).toHaveLength(1);
    expect(r2.objects.size).toBe(1);
  });
});
