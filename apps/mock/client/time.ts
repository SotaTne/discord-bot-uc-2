/** 時刻の書式（JST）。画面は、サーバーの時計（疑似時計）の値を、そのまま、JST で見せる */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const jstIso = (epochMs: number) => new Date(epochMs + JST_OFFSET_MS).toISOString();

/** 「2026-10-07」 */
export const jstDate = (epochMs: number) => jstIso(epochMs).slice(0, 10);

/** 「20:53」 */
export const jstHm = (epochMs: number) => jstIso(epochMs).slice(11, 16);

/** 「10/07（水）」 */
export const jstMdWeekday = (epochMs: number) =>
  `${jstIso(epochMs).slice(5, 10).replace("-", "/")}（${WEEKDAYS[new Date(epochMs + JST_OFFSET_MS).getUTCDay()]}）`;

/** 「10/07 20:53」 */
export const jstMdHm = (epochMs: number) => `${jstIso(epochMs).slice(5, 10).replace("-", "/")} ${jstHm(epochMs)}`;

/** 「21:00」 */
export const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
