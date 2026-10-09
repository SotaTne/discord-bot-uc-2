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

/**
 * 本物の時刻からのずれ。「+8時間12分」「−1日3時間」。進めた分が「+」、戻した分が「−」。
 * 分に丸める。1 分に満たなければ、空（ずれなし）
 */
export function formatOffset(offsetMs: number): string {
  const minutes = Math.round(Math.abs(offsetMs) / 60_000);
  if (minutes === 0) return "";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const text = [days > 0 ? `${days}日` : "", hours > 0 ? `${hours}時間` : "", rest > 0 ? `${rest}分` : ""].join("");
  return `${offsetMs < 0 ? "−" : "+"}${text}`;
}
