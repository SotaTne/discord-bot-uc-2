const KEY = "DISCORD_PUBLIC_KEY";

export type ApplyResult = {
  text: string;
  /**
   * - set: 公開鍵を書き込んだ
   * - unchanged: すでに同じ値だった
   * - kept-existing: 別の値（本物の Discord の公開鍵など）が入っているので、そのまま残した
   */
  status: "set" | "unchanged" | "kept-existing";
};

/**
 * `.dev.vars` のテキストに、モックの公開鍵を設定する。
 * 本物の Discord の公開鍵を使っているときに上書きしないよう、別の値が入っていれば残す（force なら上書き）。
 * 他の行（コメントや別の変数）はそのまま保つ。
 */
export function applyPublicKey(text: string, publicKeyHex: string, force = false): ApplyResult {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`${KEY}=`));

  if (index === -1) {
    const withNewline = text === "" || text.endsWith("\n") ? text : `${text}\n`;
    return { text: `${withNewline}${KEY}=${publicKeyHex}\n`, status: "set" };
  }

  const current = (lines[index] ?? "").slice(KEY.length + 1).trim();
  if (current === publicKeyHex) {
    return { text, status: "unchanged" };
  }
  if (current !== "" && !force) {
    return { text, status: "kept-existing" };
  }

  lines[index] = `${KEY}=${publicKeyHex}`;
  return { text: lines.join("\n"), status: "set" };
}

/**
 * `.dev.vars` に、変数がなければ追加する（すでにあれば、値が何であっても変えない）。
 * 開発用の既定値（DEV_CLOCK や PUBLIC_URL）を足すのに使う。
 */
export function ensureEnvVar(text: string, key: string, value: string): { text: string; added: boolean } {
  if (text.split("\n").some((line) => line.startsWith(`${key}=`))) {
    return { text, added: false };
  }
  const withNewline = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return { text: `${withNewline}${key}=${value}\n`, added: true };
}
