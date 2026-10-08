import type { DevSnapshot } from "@uc/api";
import { jstHm } from "./format";

/** 予定のキーから、短い名前（募集開始 / 21時の締切）を作る */
export function shortJobName(key: string): string {
  if (key.startsWith("recruit:")) return "募集開始";
  return `${key.split(":").at(-1)}時の締切`;
}

export type ClockStep = { at: number; label: string };

/**
 * 時計を移せるイベント。画面に出している日の、募集開始・各対戦枠の締切・各対戦枠の試合開始。時刻順。
 * 別の日は、日付の前後ボタンで移る（その日のイベントが、あとから出る）。
 */
export function clockSteps(snapshot: DevSnapshot | null): ClockStep[] {
  if (!snapshot) return [];

  const jobs = snapshot.schedule.map((job) => {
    const at = new Date(job.from).getTime();
    return { at, label: `${jstHm(at)} ${shortJobName(job.key)}` };
  });
  const starts = snapshot.slots.map((hour) => {
    const at = Date.parse(`${snapshot.today}T${String(hour).padStart(2, "0")}:00:00+09:00`);
    return { at, label: `${jstHm(at)} ${hour}時の試合開始` };
  });

  return [...jobs, ...starts].sort((a, b) => a.at - b.at);
}
