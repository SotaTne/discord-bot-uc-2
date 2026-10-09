/** 時刻の書式（JST）。画面用の API が、時計とログの表示に使う */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const jstIso = (epochMs: number) => new Date(epochMs + JST_OFFSET_MS).toISOString();

/** 「20:53」 */
export const jstHm = (epochMs: number) => jstIso(epochMs).slice(11, 16);

/** JST の日時（"2026-10-07T20:53" または秒つき）を、epoch ミリ秒にする。読めなければ null */
export function parseJstDateTime(value: string): number | null {
  const text = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  const at = Date.parse(`${text}+09:00`);
  return Number.isNaN(at) ? null : at;
}
