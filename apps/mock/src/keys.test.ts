import { verifyDiscordSignature } from "@uc/discord";
import { signRequest } from "@uc/discord/testing";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateDevKeys } from "./keys";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "uc-mock-keys-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadOrCreateDevKeys", () => {
  it("なければ作成し、2回目以降は同じ鍵を読み込む", async () => {
    const path = join(dir, "keys.json");
    const first = await loadOrCreateDevKeys(path);
    const second = await loadOrCreateDevKeys(path);

    expect(second.publicKeyHex).toBe(first.publicKeyHex);
  });

  it("読み込んだ秘密鍵で署名すると、保存した公開鍵で検証できる", async () => {
    const path = join(dir, "keys.json");
    await loadOrCreateDevKeys(path);
    const reloaded = await loadOrCreateDevKeys(path);

    const body = "{}";
    const timestamp = "1700000000";
    const signature = await signRequest({ privateKey: reloaded.privateKey, timestamp, body });

    await expect(
      verifyDiscordSignature({ publicKey: reloaded.publicKeyHex, signature, timestamp, body }),
    ).resolves.toBe(true);
  });

  it("秘密鍵を含むファイルは、自分だけが読み書きできる権限で作る", async () => {
    const path = join(dir, "keys.json");
    await loadOrCreateDevKeys(path);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
