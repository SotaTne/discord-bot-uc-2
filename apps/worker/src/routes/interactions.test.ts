import { fixedClock } from "@uc/core";
import { listTeamHandupsOnDate } from "@uc/db";
import { generateDevKeyPair, signRequest } from "@uc/discord/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { AppEnv } from "../env";
import {
  ALICE,
  GUILD_ID,
  KMU_ROLE,
  commandInteraction,
  createSeededDb,
  jst,
  timeOption,
} from "../test-helpers";

const app = createApp();
let keys: Awaited<ReturnType<typeof generateDevKeyPair>>;
let env: AppEnv;

beforeAll(async () => {
  keys = await generateDevKeyPair();
  // この route は DB を使わないので、バインディングは空のオブジェクトで足りる
  env = {
    DISCORD_PUBLIC_KEY: keys.publicKeyHex,
    DISCORD_BOT_TOKEN: "test-token",
    DISCORD_APPLICATION_ID: "100000000000000001",
  } as AppEnv;
});

// 署名の時刻は、本物の時刻の前後 5 分以内でなければ、断られる。テストの署名の時刻（1700000000）に、本物の時刻を合わせる
const SIGNED_AT = 1_700_000_000;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SIGNED_AT * 1000);
});
afterEach(() => {
  vi.useRealTimers();
});

async function post(body: string, overrides: { signature?: string; timestamp?: string } = {}) {
  const timestamp = overrides.timestamp ?? "1700000000";
  const signature =
    overrides.signature ?? (await signRequest({ privateKey: keys.privateKey, timestamp, body }));
  return app.request(
    "/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": signature,
        "X-Signature-Timestamp": timestamp,
      },
      body,
    },
    env,
  );
}

const command = (name: string) => JSON.stringify({ id: "1", application_id: "1", token: "t", type: 2, data: { name } });

describe("POST /interactions", () => {
  it("Ping に Pong を返す（Discord がエンドポイントを確認するときの応答）", async () => {
    const response = await post(JSON.stringify({ type: 1 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ type: 1 });
  });

  describe("署名の時刻（再送攻撃への対策）", () => {
    const at = (secondsFromNow: number) => String(SIGNED_AT + secondsFromNow);
    const ping = JSON.stringify({ type: 1 });

    it("いまの時刻の前後 5 分以内なら、受ける（ちょうど 5 分も、受ける）", async () => {
      for (const seconds of [0, -299, 299, -300, 300]) {
        expect((await post(ping, { timestamp: at(seconds) })).status, `${seconds}秒`).toBe(200);
      }
    });

    it("5 分より古い、または、先の時刻なら、署名が正しくても、401（盗まれた署名つきのリクエストを、あとから送り直せない）", async () => {
      for (const seconds of [-301, 301, -3600, 86_400]) {
        const response = await post(ping, { timestamp: at(seconds) });
        expect(response.status, `${seconds}秒`).toBe(401);
        expect(await response.json()).toEqual({ error: "invalid request signature" });
      }
    });

    it("数字でない・桁が多すぎる時刻は、401", async () => {
      for (const timestamp of ["abc", "", "1700000000.5", "-1700000000", "17000000000000000"]) {
        expect((await post(ping, { timestamp })).status, timestamp).toBe(401);
      }
    });

    it("時刻を新しくしても、署名は、その時刻に結びついている。古い署名に、新しい時刻を付けても、401", async () => {
      const oldSignature = await signRequest({ privateKey: keys.privateKey, timestamp: at(-3600), body: ping });

      const response = await post(ping, { signature: oldSignature, timestamp: at(0) });

      expect(response.status).toBe(401);
    });
  });

  it("署名のヘッダーがなければ 401", async () => {
    const response = await app.request(
      "/interactions",
      { method: "POST", body: JSON.stringify({ type: 1 }) },
      env,
    );
    expect(response.status).toBe(401);
  });

  it("署名が正しくなければ 401", async () => {
    const response = await post(JSON.stringify({ type: 1 }), { signature: "00".repeat(64) });
    expect(response.status).toBe(401);
  });

  it("別の鍵で署名されたリクエストは 401", async () => {
    const attacker = await generateDevKeyPair();
    const body = JSON.stringify({ type: 1 });
    const signature = await signRequest({
      privateKey: attacker.privateKey,
      timestamp: "1700000000",
      body,
    });
    const response = await post(body, { signature });
    expect(response.status).toBe(401);
  });

  it("署名後にボディを書き換えられたら 401", async () => {
    const original = JSON.stringify({ type: 1 });
    const signature = await signRequest({
      privateKey: keys.privateKey,
      timestamp: "1700000000",
      body: original,
    });
    const response = await post(JSON.stringify({ type: 2 }), { signature });
    expect(response.status).toBe(401);
  });

  it("署名は正しいが JSON でないボディは 400", async () => {
    const response = await post("not json");
    expect(response.status).toBe(400);
  });

  it("未実装のコマンドには、本人にだけ見える返信をする", async () => {
    const response = await post(command("uc-unknown"));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { type: number; data: { flags: number; content: string } };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(json.data.content).toContain("まだ使えません");
  });

  it("対応していない種類のインタラクションは 400", async () => {
    const response = await post(JSON.stringify({ type: 5 }));
    expect(response.status).toBe(400);
  });
});

describe("コマンドの実行（署名 → ハンドラー → DB）", () => {
  const sendCommand = async (
    target: { app: ReturnType<typeof createApp>; env: AppEnv },
    input: Parameters<typeof commandInteraction>[0],
  ) => {
    const body = JSON.stringify(commandInteraction(input));
    const timestamp = "1700000000";
    const signature = await signRequest({ privateKey: keys.privateKey, timestamp, body });
    return target.app.request(
      "/interactions",
      {
        method: "POST",
        headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp },
        body,
      },
      target.env,
    );
  };

  it("/uc-handup で挙手でき、返信は本人にだけ見え、挙手が DB に残る", async () => {
    const seeded = await createSeededDb();
    const target = {
      app: createApp({ clock: fixedClock(jst("2026-10-07T15:00:00")) }),
      env: { ...env, DB: seeded.db.$client } as AppEnv,
    };

    const response = await sendCommand(target, { name: "uc-handup", options: [timeOption(21)] });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { type: number; data: { content: string; flags: number } };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(json.data.content).toBe(`<@&${KMU_ROLE}> 21時の試合に挙手しました`);

    const rows = await listTeamHandupsOnDate(seeded.db, {
      guildId: GUILD_ID,
      slotDate: "2026-10-07",
      teamId: seeded.kmuId,
    });
    expect(rows).toMatchObject([{ slotHour: 21, raisedBy: ALICE }]);
  });

  it("受付時間外の時計では、挙手できない（時計が注入されている）", async () => {
    const seeded = await createSeededDb();
    const target = {
      app: createApp({ clock: fixedClock(jst("2026-10-07T23:00:00")) }),
      env: { ...env, DB: seeded.db.$client } as AppEnv,
    };

    const response = await sendCommand(target, { name: "uc-handup", options: [timeOption(21)] });

    const json = (await response.json()) as { data: { content: string } };
    expect(json.data.content).toBe("受付は終了しました（試合開始の7分前までです）");
  });

  it("ハンドラーが予期しないエラーになっても、ユーザーには失敗を返す（無応答にしない）", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = {
      app: createApp({ clock: fixedClock(jst("2026-10-07T15:00:00")) }),
      // DB がまともに使えない状態
      env: { ...env, DB: {} } as unknown as AppEnv,
    };

    const response = await sendCommand(target, { name: "uc-handup", options: [timeOption(21)] });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { content: string; flags: number } };
    expect(json.data.content).toBe("コマンドの処理中にエラーが発生しました");
    expect(json.data.flags).toBe(64);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
