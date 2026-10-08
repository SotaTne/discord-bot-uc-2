/**
 * Discord が Interactions に付ける署名（Ed25519）を検証する。
 * 署名の対象は `timestamp + 生のリクエストボディ`。ボディは JSON に変換する前の文字列を渡すこと。
 */
export async function verifyDiscordSignature(input: {
  /** アプリの公開鍵（16進数） */
  publicKey: string;
  /** X-Signature-Ed25519 ヘッダー（16進数） */
  signature: string;
  /** X-Signature-Timestamp ヘッダー */
  timestamp: string;
  body: string;
}): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(input.publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(input.signature),
      new TextEncoder().encode(input.timestamp + input.body),
    );
  } catch {
    // 鍵や署名の形式が不正な場合は、検証失敗として扱う
    return false;
  }
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("不正な16進数です");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
