const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 日本は夏時間がないので、UTC+9 の固定オフセットで扱える */
const JST_OFFSET_MS = 9 * HOUR_MS;

/** 時刻が属する JST の日付（YYYY-MM-DD） */
export function jstDateOf(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST の「日付 + 時」の開始時刻 */
export function slotStart(slotDate: string, slotHour: number): Date {
  assertHour(slotHour);
  return new Date(Date.parse(`${slotDate}T00:00:00Z`) + slotHour * HOUR_MS - JST_OFFSET_MS);
}

/** 挙手を打ち切る時刻（試合開始の K 分前） */
export function handupDeadline(slotDate: string, slotHour: number, cutoffMinutes: number): Date {
  return new Date(slotStart(slotDate, slotHour).getTime() - cutoffMinutes * MINUTE_MS);
}

/**
 * `/uc-admin-win` で日付を省略したときの日付。
 * 「今より前で、一番直近のその時刻の枠」の日付（JST）を返す。
 */
export function resolveRecentSlotDate(now: Date, slotHour: number): string {
  const today = jstDateOf(now);
  if (slotStart(today, slotHour).getTime() <= now.getTime()) {
    return today;
  }
  return jstDateOf(new Date(slotStart(today, slotHour).getTime() - DAY_MS));
}

export type HandupWindow = {
  /** 募集を開始する時刻（時） */
  recruitHour: number;
  /** 試合開始の何分前に打ち切るか */
  cutoffMinutes: number;
};

/** 挙手の受付の段階。募集開始前 → 受付中 → 締切後 */
export type HandupPhase = "before-open" | "open" | "closed";

/**
 * 指定した日の枠の挙手が、今どの段階か。
 * その日の募集開始時刻から、試合開始の K 分前までが受付時間。
 * 枠は、募集開始時刻より後の同じ日の時刻であることを前提にする。
 * 過去の日の枠は、いつも「締切後」、未来の日の枠は、いつも「募集開始前」。
 */
export function slotPhase(now: Date, slotDate: string, slotHour: number, window: HandupWindow): HandupPhase {
  assertHour(window.recruitHour);
  const opensAt = slotStart(slotDate, window.recruitHour);
  const closesAt = handupDeadline(slotDate, slotHour, window.cutoffMinutes);

  if (now.getTime() < opensAt.getTime()) return "before-open";
  if (now.getTime() < closesAt.getTime()) return "open";
  return "closed";
}

/** 今日の枠の挙手が、今どの段階か（slotPhase の、日付が今日のとき） */
export function handupPhase(now: Date, slotHour: number, window: HandupWindow): HandupPhase {
  return slotPhase(now, jstDateOf(now), slotHour, window);
}

/** 今、その枠の挙手を受け付けているか */
export function isAcceptingHandups(now: Date, slotHour: number, window: HandupWindow): boolean {
  return handupPhase(now, slotHour, window) === "open";
}

/** JST の時刻を HH:MM で表す（例: 14:05） */
export function formatJstTime(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(11, 16);
}

function assertHour(hour: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`時は 0〜23 の整数で指定してください: ${hour}`);
  }
}
