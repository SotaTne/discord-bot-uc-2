// `.env` ファイルの中身（KEY=value の行）を、読む・書き換える部品。apps/cron の push（デプロイの ID の記録）と、ルートの update-cron-secret（合言葉）が、使う。

/** KEY の値を読む。ない・空は、null。前方一致だけの別の名前は、読まない */
export function readEnvValue(text: string, key: string): string | null {
  const line = text.split("\n").find((current) => current.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim();
  return value ? value : null;
}

/** KEY=value の行を、書き換える（なければ、末尾に足す）。ほかの行・コメントは、そのまま */
export function upsertEnvLine(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const lines = text.split("\n");
  const index = lines.findIndex((current) => current.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = line;
    return lines.join("\n");
  }
  const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${body}${line}\n`;
}
