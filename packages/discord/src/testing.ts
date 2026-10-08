import { bytesToHex } from "./verify";

/**
 * テストと開発用モックのための、署名の生成側。
 * 本番の Discord の代わりに、同じ形式で署名したリクエストを作る。
 */
// CryptoKey の型名は Node と Workers の型定義で扱いが違うので、関数の引数の型から導く
type SigningKey = Parameters<typeof crypto.subtle.sign>[1];

export type DevKeyPair = {
  /** worker の DISCORD_PUBLIC_KEY に設定する公開鍵（16進数） */
  publicKeyHex: string;
  privateKey: SigningKey;
};

export async function generateDevKeyPair(): Promise<DevKeyPair> {
  // Ed25519 は鍵ペアを返す。型定義上は鍵単体との union になるので、受け直す
  const generated: unknown = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  const pair = generated as {
    publicKey: Parameters<typeof crypto.subtle.exportKey>[1];
    privateKey: SigningKey;
  };
  // "raw" 形式なら ArrayBuffer が返る（型定義によっては JsonWebKey との union になる）
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  return { publicKeyHex: bytesToHex(raw), privateKey: pair.privateKey };
}

export async function signRequest(input: {
  privateKey: SigningKey;
  timestamp: string;
  body: string;
}): Promise<string> {
  const signature = await crypto.subtle.sign(
    "Ed25519",
    input.privateKey,
    new TextEncoder().encode(input.timestamp + input.body),
  );
  return bytesToHex(signature);
}
