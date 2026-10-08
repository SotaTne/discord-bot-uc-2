import { generateDevKeyPair, type DevKeyPair } from "@uc/discord/testing";
import type { webcrypto } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type StoredKeys = { publicKeyHex: string; privateKeyJwk: webcrypto.JsonWebKey };

/**
 * 開発用の署名鍵を、ファイルに保存して使い回す。
 * 再起動するたびに鍵が変わると、worker の DISCORD_PUBLIC_KEY を毎回直すことになるため。
 */
export async function loadOrCreateDevKeys(path: string): Promise<DevKeyPair> {
  if (existsSync(path)) {
    const stored = JSON.parse(readFileSync(path, "utf8")) as StoredKeys;
    const privateKey = await crypto.subtle.importKey(
      "jwk",
      stored.privateKeyJwk,
      { name: "Ed25519" },
      true,
      ["sign"],
    );
    return { publicKeyHex: stored.publicKeyHex, privateKey };
  }

  const keys = await generateDevKeyPair();
  const stored: StoredKeys = {
    publicKeyHex: keys.publicKeyHex,
    privateKeyJwk: await crypto.subtle.exportKey("jwk", keys.privateKey),
  };
  // 秘密鍵を含むので、自分だけが読めるようにする
  writeFileSync(path, JSON.stringify(stored, null, 2), { mode: 0o600 });
  return keys;
}
