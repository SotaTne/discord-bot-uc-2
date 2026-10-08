import { formatJstTime, jstDateOf } from "@uc/core";

/** 今日の日付（JST, YYYY-MM-DD） */
export const todayJst = () => jstDateOf(new Date());

/** 日時（JST）を、例えば「10/07 14:05」の形にする */
export function formatJstDateTime(epochMs: number): string {
  const at = new Date(epochMs);
  return `${jstDateOf(at).slice(5).replace("-", "/")} ${formatJstTime(at)}`;
}

/** 試合枠の時刻（例: 21 → 21:00） */
export const formatHour = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** 日付（YYYY-MM-DD）を、days 日ずらす（JST の暦の上で。月・年をまたぐ） */
export function shiftDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 日付（YYYY-MM-DD）を、「10/08（木）」の形にする */
export function formatDateWithWeekday(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  return `${date.slice(5).replace("-", "/")}（${WEEKDAYS[at.getUTCDay()]}）`;
}
