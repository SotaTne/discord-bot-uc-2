import { fixedClock } from "@uc/core";
import { generateDevKeyPair, signRequest } from "@uc/discord/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { devClock, setDevClockState } from "../dev/clock";
import type { AppEnv } from "../env";
import {
  GUILD_ID,
  adminInteraction,
  commandInteraction,
  createSeededDb,
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

  it("知らない接頭辞のボタンは、無効として本人にだけ返す", async () => {
    const seeded = await createSeededDb();
    const json = await send(app(), { DB: seeded.db.$client }, adminInteraction({ customId: "unknown:x" }));

    expect(json.type).toBe(4);
    expect(json.data?.content).toBe("この操作は無効です");
  });
});
