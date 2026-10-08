import { describe, expect, it } from "vitest";
import { generateDevKeyPair, signRequest } from "./testing";
import { bytesToHex, hexToBytes, verifyDiscordSignature } from "./verify";

const timestamp = "1700000000";
const body = JSON.stringify({ type: 1 });

describe("verifyDiscordSignature", () => {
  it("正しい署名なら true", async () => {
    const keys = await generateDevKeyPair();
    const signature = await signRequest({ privateKey: keys.privateKey, timestamp, body });

    await expect(
      verifyDiscordSignature({ publicKey: keys.publicKeyHex, signature, timestamp, body }),
    ).resolves.toBe(true);
  });

  it("ボディが書き換えられていたら false", async () => {
    const keys = await generateDevKeyPair();
    const signature = await signRequest({ privateKey: keys.privateKey, timestamp, body });

    await expect(
      verifyDiscordSignature({
        publicKey: keys.publicKeyHex,
        signature,
        timestamp,
        body: JSON.stringify({ type: 2 }),
      }),
    ).resolves.toBe(false);
  });

  it("タイムスタンプが違えば false", async () => {
    const keys = await generateDevKeyPair();
    const signature = await signRequest({ privateKey: keys.privateKey, timestamp, body });

    await expect(
      verifyDiscordSignature({
        publicKey: keys.publicKeyHex,
        signature,
        timestamp: "1700000001",
        body,
      }),
    ).resolves.toBe(false);
  });

  it("別の鍵で署名されていたら false", async () => {
    const real = await generateDevKeyPair();
    const attacker = await generateDevKeyPair();
    const signature = await signRequest({ privateKey: attacker.privateKey, timestamp, body });

    await expect(
      verifyDiscordSignature({ publicKey: real.publicKeyHex, signature, timestamp, body }),
    ).resolves.toBe(false);
  });

  it("署名や鍵の形式が不正でも、例外ではなく false を返す", async () => {
    const keys = await generateDevKeyPair();
    await expect(
      verifyDiscordSignature({ publicKey: keys.publicKeyHex, signature: "zz", timestamp, body }),
    ).resolves.toBe(false);
    await expect(
      verifyDiscordSignature({ publicKey: "abc", signature: "00", timestamp, body }),
    ).resolves.toBe(false);
    await expect(
      verifyDiscordSignature({ publicKey: "", signature: "", timestamp, body }),
    ).resolves.toBe(false);
  });
});

describe("hexToBytes / bytesToHex", () => {
  it("相互に変換できる", () => {
    expect(bytesToHex(hexToBytes("00ff10ab"))).toBe("00ff10ab");
  });

  it("奇数桁や16進数以外は拒否する", () => {
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("xy")).toThrow();
  });
});
