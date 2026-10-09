import { handupDeadline, slotStart } from "./slot-time";

/**
 * cron が遅れても取りこぼさないための猶予。これを過ぎたら、もう実行しない。
 * どちらも 30 分。数えはじめが違う: 募集開始は、募集開始の時刻から。締切のマッチングは、試合開始から（締切の時刻からではない）
 */
export const RECRUIT_GRACE_MS = 30 * 60 * 1000;
export const CUTOFF_GRACE_MS = 30 * 60 * 1000;

/** 対戦枠の締切ジョブのキー。cron と、管理者の手動の確定が、同じキーで「実行する権利」を取り合う */
export const cutoffJobKey = (date: string, hour: number) => `cutoff:${date}:${hour}`;

export type ScheduledJobKind = "recruit" | "cutoff";

export type ScheduledJobSpec = {
  /** job_runs に記録するキー（例: recruit:2026-10-07 / cutoff:2026-10-07:21）。同じキーのジョブは、1回しか実行されない */
  key: string;
  kind: ScheduledJobKind;
  /** cutoff のときの試合時刻。recruit は null */
  slotHour: number | null;
  /** この時刻から実行できる */
  from: Date;
  /** この時刻を過ぎたら、もう実行しない */
  until: Date;
};

/**
 * ある日の、cron が実行するジョブの予定。
 * - 募集開始（N 時から1時間）
 * - 各対戦枠の締切（試合の K 分前から、試合開始の30分後まで）。マッチングの確定と投稿
 * 実行する側（runScheduled）と、画面に出す予定の両方が、この関数を使う。
 */
export function scheduledJobsForDate(input: {
  /** 日付（JST, YYYY-MM-DD） */
  date: string;
  recruitHour: number;
  cutoffMinutes: number;
  slotHours: readonly number[];
}): ScheduledJobSpec[] {
  const recruitFrom = slotStart(input.date, input.recruitHour);
  const jobs: ScheduledJobSpec[] = [
    {
      key: `recruit:${input.date}`,
      kind: "recruit",
      slotHour: null,
      from: recruitFrom,
      until: new Date(recruitFrom.getTime() + RECRUIT_GRACE_MS),
    },
  ];

  for (const hour of [...input.slotHours].sort((a, b) => a - b)) {
    jobs.push({
      key: cutoffJobKey(input.date, hour),
      kind: "cutoff",
      slotHour: hour,
      from: handupDeadline(input.date, hour, input.cutoffMinutes),
      until: new Date(slotStart(input.date, hour).getTime() + CUTOFF_GRACE_MS),
    });
  }
  return jobs;
}

/**
 * - done: 実行済み
 * - ready: いま実行できる（実行する時刻が来ていて、猶予の内）
 * - waiting: まだ時刻が来ていない
 * - expired: 実行されないまま、猶予を過ぎた
 */
export type JobState = "done" | "ready" | "waiting" | "expired";

export function jobState(job: ScheduledJobSpec, now: Date, done: boolean): JobState {
  if (done) return "done";
  const at = now.getTime();
  if (at < job.from.getTime()) return "waiting";
  if (at < job.until.getTime()) return "ready";
  return "expired";
}

/** いま実行すべきジョブか（時刻が来ていて、猶予の内） */
export const isJobDue = (job: ScheduledJobSpec, now: Date): boolean => jobState(job, now, false) === "ready";
