import { describe, expect, it } from "vitest";
import { CUTOFF_GRACE_MS, RECRUIT_GRACE_MS, isJobDue, jobState, scheduledJobsForDate } from "./schedule";

const jst = (text: string) => new Date(`${text}+09:00`);
const plan = { date: "2026-10-07", recruitHour: 12, cutoffMinutes: 7, slotHours: [23, 21, 22] };

describe("scheduledJobsForDate", () => {
  it("募集開始と、対戦枠ごとの締切を、時刻順に返す（キーは job_runs と同じ形式）", () => {
    const jobs = scheduledJobsForDate(plan);

    expect(jobs.map((j) => [j.key, j.kind, j.slotHour])).toEqual([
      ["recruit:2026-10-07", "recruit", null],
      ["cutoff:2026-10-07:21", "cutoff", 21],
      ["cutoff:2026-10-07:22", "cutoff", 22],
      ["cutoff:2026-10-07:23", "cutoff", 23],
    ]);
  });

  it("募集開始は N 時から1時間、締切は試合の K 分前から試合開始の30分後まで", () => {
    const [recruit, cutoff21] = scheduledJobsForDate(plan);

    expect(recruit?.from).toEqual(jst("2026-10-07T12:00:00"));
    expect(recruit!.until.getTime() - recruit!.from.getTime()).toBe(RECRUIT_GRACE_MS);
    expect(cutoff21?.from).toEqual(jst("2026-10-07T20:53:00"));
    expect(cutoff21?.until).toEqual(new Date(jst("2026-10-07T21:00:00").getTime() + CUTOFF_GRACE_MS));
  });

  it("締切の分数・募集開始の時刻は、設定に従う", () => {
    const jobs = scheduledJobsForDate({ ...plan, recruitHour: 9, cutoffMinutes: 30, slotHours: [21] });

    expect(jobs[0]?.from).toEqual(jst("2026-10-07T09:00:00"));
    expect(jobs[1]?.from).toEqual(jst("2026-10-07T20:30:00"));
  });

  it("対戦枠がなければ、募集開始だけ。渡した配列は書き換えない", () => {
    expect(scheduledJobsForDate({ ...plan, slotHours: [] }).map((j) => j.key)).toEqual(["recruit:2026-10-07"]);
    const hours = [23, 21];
    scheduledJobsForDate({ ...plan, slotHours: hours });
    expect(hours).toEqual([23, 21]);
  });
});

describe("jobState / isJobDue", () => {
  const [, cutoff21] = scheduledJobsForDate(plan);
  const state = (at: string, done = false) => jobState(cutoff21!, jst(at), done);

  it("時刻の前は waiting、時刻から猶予の内は ready、過ぎたら expired", () => {
    expect(state("2026-10-07T20:52:59")).toBe("waiting");
    expect(state("2026-10-07T20:53:00")).toBe("ready");
    expect(state("2026-10-07T21:29:59")).toBe("ready");
    expect(state("2026-10-07T21:30:00")).toBe("expired");
  });

  it("実行済みなら、時刻に関係なく done", () => {
    expect(state("2026-10-07T10:00:00", true)).toBe("done");
    expect(state("2026-10-07T23:00:00", true)).toBe("done");
  });

  it("isJobDue は、ready のときだけ true", () => {
    expect(isJobDue(cutoff21!, jst("2026-10-07T20:53:00"))).toBe(true);
    expect(isJobDue(cutoff21!, jst("2026-10-07T20:52:00"))).toBe(false);
    expect(isJobDue(cutoff21!, jst("2026-10-07T22:00:00"))).toBe(false);
  });
});
