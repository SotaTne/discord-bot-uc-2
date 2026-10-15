const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 日本は夏時間がないので、UTC+9 の固定オフセットで扱える */
const JST_OFFSET_MS = 9 * HOUR_MS;

/** 時刻が属する JST の日付（YYYY-MM-DD） */
export function jstDateOf(at: Date): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 試合時刻（登録）の、削除の状態。deletedAt は、削除した時刻（epoch ms）。削除していなければ null */
export type SlotHourEntry = { hour: number; deletedAt: number | null };

/**
 * その日の、対戦枠にする試合時刻。削除していない時刻は、いつでも出す。
 * 削除した時刻は、削除した日までの対戦枠を出す（deleted: true）。それ以降の日付には出さない。
 * 記録の有無には、よらない（削除した日までは、記録がなくても出る）。追加し直すと（deletedAt が null に戻ると）、全部の日付に出る。
 */
export function slotHoursOnDate(entries: readonly SlotHourEntry[], date: string): { hour: number; deleted: boolean }[] {
  return entries
    .filter((entry) => entry.deletedAt === null || date <= jstDateOf(new Date(entry.deletedAt)))
    .map((entry) => ({ hour: entry.hour, deleted: entry.deletedAt !== null }))
    .sort((a, b) => a.hour - b.hour);
}

/**
 * 継続募集中か（奇数で組まれなかったチームが「待機する」を押し、その対戦枠の開始前で、別のチームの挙手を待っている）。
 * 保存せず、対戦枠の状態と、時刻から、毎回、計算する。試合開始を過ぎれば、何も保存し直さなくても、終わる。
 */
export function isContinuedRecruit(
  slot: { status: "open" | "matched"; excludedTeamId: number | null; waitingSince: number | null; slotDate: string; slotHour: number },
  now: Date,
): boolean {
  return (
    slot.status === "matched" &&
    slot.excludedTeamId !== null &&
    slot.waitingSince !== null &&
    now.getTime() < slotStart(slot.slotDate, slot.slotHour).getTime()
  );
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

export type HandupWindow = {
  /** 募集を開始する時刻（時） */
  recruitHour: number;
  /** 試合開始の何分前に打ち切るか */
  cutoffMinutes: number;
};

/** 挙手の受付の段階。募集開始前 → 受付中 → 締切後 */
export type HandupPhase = "before-open" | "open" | "closed";

/**
 * 指定した日の対戦枠の挙手が、今どの段階か。
 * その日の募集開始時刻から、試合開始の K 分前までが受付時間。
 * 対戦枠は、募集開始時刻より後の同じ日の時刻であることを前提にする。
 * 過去の日の対戦枠は、いつも「締切後」、未来の日の対戦枠は、いつも「募集開始前」。
 */
export function slotPhase(now: Date, slotDate: string, slotHour: number, window: HandupWindow): HandupPhase {
  assertHour(window.recruitHour);
  const opensAt = slotStart(slotDate, window.recruitHour);
  const closesAt = handupDeadline(slotDate, slotHour, window.cutoffMinutes);

  if (now.getTime() < opensAt.getTime()) return "before-open";
  if (now.getTime() < closesAt.getTime()) return "open";
  return "closed";
}

/** 今日の対戦枠の挙手が、今どの段階か（slotPhase の、日付が今日のとき） */
export function handupPhase(now: Date, slotHour: number, window: HandupWindow): HandupPhase {
  return slotPhase(now, jstDateOf(now), slotHour, window);
}

/** 今、その対戦枠の挙手を受け付けているか */
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
